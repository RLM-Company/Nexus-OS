"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  safeStorage,
  session,
  shell
} = require("electron");
const { CredentialStore } = require("./credential-store.cjs");
const {
  isAllowedRemoteNavigation,
  nextAvailableDownloadPath,
  normalizeServerOrigin,
  retryDelayMs,
  safeLogUrl
} = require("./connection-policy.cjs");

const DEFAULT_ORIGIN = "https://13.141.51.16";
const SESSION_PARTITION = "persist:cosmora";
const CONNECTION_FILE = "connection.json";
const CREDENTIAL_FILE = "credentials.bin";
const DIAGNOSTIC_FILE = "cosmora-desktop.log";
const HEALTH_TIMEOUT_MS = 6000;
const HEARTBEAT_INTERVAL_MS = 30000;
const MAX_DIAGNOSTIC_BYTES = 1024 * 1024;
const KEEP_DIAGNOSTIC_BYTES = 512 * 1024;

let mainWindow = null;
let currentOrigin = null;
let runtimeCredentials = null;
let lastRemoteUrl = null;
let heartbeatTimer = null;
let heartbeatInFlight = false;
let heartbeatFailures = 0;
let recoveryTimer = null;
let recoveryAttempt = 0;
let recoveryInFlight = false;
let connectionInFlight = false;

const ownsSingleInstance = app.requestSingleInstanceLock();
if (!ownsSingleInstance) {
  app.quit();
}

function connectionPath() {
  return path.join(app.getPath("userData"), CONNECTION_FILE);
}

function credentialPath() {
  return path.join(app.getPath("userData"), CREDENTIAL_FILE);
}

function diagnosticPath() {
  return path.join(app.getPath("logs"), DIAGNOSTIC_FILE);
}

function credentialStore() {
  return new CredentialStore({
    filePath: credentialPath(),
    safeStorage
  });
}

function readSavedOrigin() {
  try {
    const parsed = JSON.parse(fs.readFileSync(connectionPath(), "utf8"));
    return normalizeServerOrigin(parsed.origin);
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function saveOrigin(origin) {
  const target = connectionPath();
  const temporary = target + ".tmp";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify({ origin }, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
  fs.rmSync(target, { force: true });
  fs.renameSync(temporary, target);
}

function rotateDiagnosticLog(target) {
  try {
    const stats = fs.statSync(target);
    if (stats.size <= MAX_DIAGNOSTIC_BYTES) return;

    const source = fs.readFileSync(target);
    const tail = source.subarray(Math.max(0, source.length - KEEP_DIAGNOSTIC_BYTES));
    const firstNewline = tail.indexOf(0x0a);
    fs.writeFileSync(target, firstNewline >= 0 ? tail.subarray(firstNewline + 1) : tail);
  } catch {
    // Rotation is best effort only.
  }
}

function appendDiagnostic(event, details = {}) {
  if (!app.isReady()) return;

  try {
    const target = diagnosticPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    rotateDiagnosticLog(target);
    fs.appendFileSync(
      target,
      JSON.stringify({
        at: new Date().toISOString(),
        event,
        ...details
      }) + "\n",
      "utf8"
    );
  } catch {
    // Diagnostics must never break the application.
  }
}

function localConnectionUrl() {
  return pathToFileURL(path.join(__dirname, "connection.html")).toString();
}

function isTrustedConnectionEvent(event) {
  return Boolean(event.senderFrame && event.senderFrame.url === localConnectionUrl());
}

function credentialHeader(username, password) {
  if (!username && !password) return {};
  return {
    authorization:
      "Basic " + Buffer.from(String(username) + ":" + String(password), "utf8").toString("base64")
  };
}

async function probeServer(browserSession, origin, username, password) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const response = await browserSession.fetch(origin + "/api/v1/health", {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      headers: credentialHeader(username, password),
      signal: controller.signal
    });

    if (response.status === 401) {
      return {
        ok: false,
        code: "auth",
        message:
          username || password
            ? "Сервер отклонил логин или пароль."
            : "Сервер требует логин и пароль."
      };
    }
    if (response.status === 403) {
      return {
        ok: false,
        code: "forbidden",
        message: "Доступ к этому серверу Cosmora запрещён."
      };
    }
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        code: "redirect",
        message: "Сервер перенаправил health-check. Проверьте адрес Cosmora."
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        code: "http",
        message: "Cosmora ответила ошибкой HTTP " + response.status + ". Повторите попытку позже."
      };
    }

    return { ok: true, code: "ok" };
  } catch (cause) {
    if (cause && cause.name === "AbortError") {
      return {
        ok: false,
        code: "timeout",
        message: "Сервер Cosmora не ответил за 6 секунд."
      };
    }
    return {
      ok: false,
      code: "network",
      message: "Не удалось подключиться к Cosmora. Проверьте адрес, сеть и TLS-сертификат."
    };
  } finally {
    clearTimeout(timeout);
  }
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  heartbeatInFlight = false;
  heartbeatFailures = 0;
}

function cancelRecovery() {
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = null;
  recoveryAttempt = 0;
}

function setConnectionTitle(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setTitle(status ? "Cosmora — " + status : "Cosmora");
}

async function showConnection(message) {
  stopHeartbeat();
  cancelRecovery();
  currentOrigin = null;
  runtimeCredentials = null;
  lastRemoteUrl = null;
  setConnectionTitle("");

  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    await mainWindow.loadURL(localConnectionUrl());
    if (message) {
      await mainWindow.webContents.executeJavaScript(
        'document.querySelector("#error").textContent = ' + JSON.stringify(message) + ";",
        true
      );
    }
  } catch {
    appendDiagnostic("connection_screen_failed");
  }
}

async function hashFileSha256(filePath) {
  return await new Promise((resolve, reject) => {
    const digest = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("end", () => resolve(digest.digest("hex")));
  });
}

function installDownloadPolicy(browserSession) {
  browserSession.on("will-download", (event, item) => {
    let downloadOrigin;
    try {
      downloadOrigin = new URL(item.getURL()).origin;
    } catch {
      event.preventDefault();
      appendDiagnostic("download_blocked", { reason: "invalid_url" });
      return;
    }

    if (!currentOrigin || downloadOrigin !== currentOrigin) {
      event.preventDefault();
      appendDiagnostic("download_blocked", { reason: "cross_origin" });
      return;
    }

    const target = nextAvailableDownloadPath(
      app.getPath("downloads"),
      item.getFilename(),
      fs.existsSync
    );
    item.setSavePath(target);

    item.once("done", async (_doneEvent, state) => {
      if (state !== "completed") {
        appendDiagnostic("download_finished", {
          filename: path.basename(target),
          state
        });
        return;
      }

      try {
        const sha256 = await hashFileSha256(target);
        appendDiagnostic("download_completed", {
          filename: path.basename(target),
          bytes: item.getTotalBytes(),
          sha256
        });
      } catch {
        appendDiagnostic("download_completed", {
          filename: path.basename(target),
          bytes: item.getTotalBytes(),
          sha256: "unavailable"
        });
      }
    });
  });
}

function rememberRemoteUrl(url) {
  if (currentOrigin && isAllowedRemoteNavigation(url, currentOrigin)) {
    lastRemoteUrl = url;
  }
}

function installNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedRemoteNavigation(url, currentOrigin)) {
      void window.loadURL(url);
    } else if (/^https?:/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url === localConnectionUrl() || isAllowedRemoteNavigation(url, currentOrigin)) return;
    event.preventDefault();
    appendDiagnostic("navigation_blocked", { url: safeLogUrl(url) });
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  window.webContents.on("will-redirect", (event, url) => {
    if (isAllowedRemoteNavigation(url, currentOrigin)) return;
    event.preventDefault();
    appendDiagnostic("redirect_blocked", { url: safeLogUrl(url) });
    void showConnection("Cosmora попыталась перенаправить приложение на другой сервер.");
  });

  window.webContents.on("did-navigate", (_event, url) => rememberRemoteUrl(url));
  window.webContents.on("did-navigate-in-page", (_event, url) => rememberRemoteUrl(url));

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || !currentOrigin) return;
      if (validatedURL && !isAllowedRemoteNavigation(validatedURL, currentOrigin)) return;

      appendDiagnostic("remote_load_failed", {
        code: errorCode,
        description: String(errorDescription || "").slice(0, 160),
        url: validatedURL ? safeLogUrl(validatedURL) : currentOrigin
      });
      scheduleRecovery("load_failed");
    }
  );

  window.webContents.on("render-process-gone", (_event, details) => {
    appendDiagnostic("renderer_gone", {
      reason: details.reason,
      exitCode: details.exitCode
    });
    if (currentOrigin) scheduleRecovery("renderer_gone");
  });

  window.webContents.on("unresponsive", () => {
    appendDiagnostic("renderer_unresponsive");
    setConnectionTitle("интерфейс не отвечает");
  });

  window.webContents.on("responsive", () => {
    appendDiagnostic("renderer_responsive");
    if (currentOrigin && heartbeatFailures === 0) setConnectionTitle("");
  });
}

async function heartbeatTick() {
  if (
    heartbeatInFlight ||
    recoveryInFlight ||
    !currentOrigin ||
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    return;
  }

  heartbeatInFlight = true;
  const origin = currentOrigin;
  const credentials =
    runtimeCredentials && runtimeCredentials.origin === origin
      ? runtimeCredentials
      : { username: "", password: "" };

  try {
    const browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
    const result = await probeServer(
      browserSession,
      origin,
      credentials.username,
      credentials.password
    );

    if (result.ok) {
      if (heartbeatFailures > 0) {
        appendDiagnostic("connection_recovered", { failures: heartbeatFailures });
      }
      heartbeatFailures = 0;
      cancelRecovery();
      setConnectionTitle("");
      return;
    }

    heartbeatFailures += 1;
    appendDiagnostic("heartbeat_failed", {
      code: result.code,
      failures: heartbeatFailures
    });

    if (result.code === "auth" || result.code === "forbidden") {
      if (result.code === "auth") credentialStore().clear();
      await showConnection(result.message);
      return;
    }

    setConnectionTitle("нет соединения");
    if (heartbeatFailures >= 3) scheduleRecovery("heartbeat");
  } finally {
    heartbeatInFlight = false;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    void heartbeatTick();
  }, HEARTBEAT_INTERVAL_MS);
}

function scheduleRecovery(reason) {
  if (
    recoveryTimer ||
    recoveryInFlight ||
    !currentOrigin ||
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    return;
  }

  const delay = retryDelayMs(recoveryAttempt);
  recoveryAttempt += 1;
  setConnectionTitle("переподключение…");
  appendDiagnostic("recovery_scheduled", {
    reason,
    attempt: recoveryAttempt,
    delayMs: delay
  });

  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    void runRecovery(reason);
  }, delay);
}

async function runRecovery(reason) {
  if (
    recoveryInFlight ||
    !currentOrigin ||
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    return;
  }

  recoveryInFlight = true;
  const origin = currentOrigin;
  const target =
    lastRemoteUrl && isAllowedRemoteNavigation(lastRemoteUrl, origin) ? lastRemoteUrl : origin;
  const credentials =
    runtimeCredentials && runtimeCredentials.origin === origin
      ? runtimeCredentials
      : { username: "", password: "" };
  let retry = false;

  try {
    const browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
    const probe = await probeServer(
      browserSession,
      origin,
      credentials.username,
      credentials.password
    );

    if (!probe.ok) {
      appendDiagnostic("recovery_probe_failed", {
        reason,
        code: probe.code
      });

      if (probe.code === "auth" || probe.code === "forbidden") {
        if (probe.code === "auth") credentialStore().clear();
        await showConnection(probe.message);
        return;
      }

      retry = true;
      return;
    }

    await mainWindow.loadURL(target);
    recoveryAttempt = 0;
    heartbeatFailures = 0;
    setConnectionTitle("");
    startHeartbeat();
    appendDiagnostic("recovery_succeeded", {
      url: safeLogUrl(target)
    });
  } catch {
    appendDiagnostic("recovery_load_failed", {
      url: safeLogUrl(target)
    });
    retry = true;
  } finally {
    recoveryInFlight = false;
    if (retry && currentOrigin) scheduleRecovery(reason);
  }
}

function createMenu() {
  const template = [
    {
      label: "Cosmora",
      submenu: [
        {
          label: "Подключение…",
          accelerator: "Ctrl+Shift+K",
          click: () => {
            void showConnection();
          }
        },
        {
          label: "Открыть папку диагностики",
          click: () => {
            const directory = app.getPath("logs");
            fs.mkdirSync(directory, { recursive: true });
            void shell.openPath(directory);
          }
        },
        { type: "separator" },
        { role: "quit", label: "Выход" }
      ]
    },
    {
      label: "Вид",
      submenu: [
        { role: "reload", label: "Обновить" },
        { role: "forceReload", label: "Обновить без кэша" },
        { type: "separator" },
        { role: "resetZoom", label: "Масштаб 100%" },
        { role: "zoomIn", label: "Увеличить" },
        { role: "zoomOut", label: "Уменьшить" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Полный экран" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createMainWindow() {
  const browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
  installDownloadPolicy(browserSession);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#ffffff",
    show: false,
    title: "Cosmora",
    webPreferences: {
      partition: SESSION_PARTITION,
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  installNavigationGuards(mainWindow);
  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.on("closed", () => {
    stopHeartbeat();
    cancelRecovery();
    mainWindow = null;
  });

  await mainWindow.loadURL(localConnectionUrl());
}

function resolveConnectionCredentials(payload, origin) {
  let username = typeof payload?.username === "string" ? payload.username.slice(0, 256) : "";
  let password = typeof payload?.password === "string" ? payload.password.slice(0, 2048) : "";
  const rememberCredentials = payload?.rememberCredentials === true;

  if (payload?.useStoredCredentials === true && password === "") {
    const saved = credentialStore().load(origin);
    if (saved && (!username || username === saved.username)) {
      username = saved.username;
      password = saved.password;
    }
  }

  return {
    username,
    password,
    rememberCredentials
  };
}

function persistCredentialChoice(origin, username, password, rememberCredentials) {
  const store = credentialStore();

  if (rememberCredentials && (username || password)) {
    if (!store.isAvailable()) {
      return {
        ok: false,
        code: "storage",
        message:
          "Защищённое хранилище Windows недоступно. Снимите флажок запоминания и повторите попытку."
      };
    }

    try {
      store.save({ origin, username, password });
    } catch {
      return {
        ok: false,
        code: "storage",
        message: "Не удалось безопасно сохранить учётные данные на этом устройстве."
      };
    }
  } else {
    store.clear();
  }

  return { ok: true };
}

async function connectAndLoad({
  origin,
  username,
  password,
  rememberCredentials,
  source
}) {
  const browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
  const probe = await probeServer(browserSession, origin, username, password);

  if (!probe.ok) {
    appendDiagnostic("connection_failed", {
      source,
      code: probe.code,
      origin
    });
    return probe;
  }

  const persisted = persistCredentialChoice(
    origin,
    username,
    password,
    rememberCredentials
  );
  if (!persisted.ok) return persisted;

  currentOrigin = origin;
  runtimeCredentials = username || password ? { origin, username, password } : null;
  lastRemoteUrl = origin;
  saveOrigin(origin);

  try {
    await mainWindow.loadURL(origin);
    recoveryAttempt = 0;
    heartbeatFailures = 0;
    startHeartbeat();
    appendDiagnostic("connection_opened", {
      source,
      origin,
      rememberedCredentials: Boolean(rememberCredentials && (username || password))
    });
    return { ok: true };
  } catch {
    appendDiagnostic("connection_ui_load_failed", {
      source,
      origin
    });
    await showConnection("Сервер доступен, но интерфейс Cosmora не открылся.");
    return {
      ok: false,
      code: "load",
      message: "Сервер доступен, но интерфейс Cosmora не открылся."
    };
  }
}

async function tryStartupConnection() {
  if (connectionInFlight) return;
  connectionInFlight = true;

  try {
    const origin = readSavedOrigin();
    const saved = credentialStore().load(origin);
    const result = await connectAndLoad({
      origin,
      username: saved?.username || "",
      password: saved?.password || "",
      rememberCredentials: Boolean(saved),
      source: "startup"
    });

    if (!result.ok) {
      if (result.code === "auth" && saved) credentialStore().clear();
      await showConnection(result.message);
    }
  } finally {
    connectionInFlight = false;
  }
}

ipcMain.handle("cosmora:connection-defaults", (event) => {
  if (!isTrustedConnectionEvent(event)) {
    throw new Error("Untrusted connection settings request.");
  }

  const origin = readSavedOrigin();
  const store = credentialStore();
  const saved = store.load(origin);

  return {
    origin,
    username: saved?.username || "",
    rememberCredentials: Boolean(saved),
    protectedStorageAvailable: store.isAvailable()
  };
});

ipcMain.handle("cosmora:connect", async (event, payload) => {
  if (!isTrustedConnectionEvent(event)) {
    return {
      ok: false,
      code: "untrusted",
      message: "Запрос подключения пришёл из недоверенного интерфейса."
    };
  }

  if (connectionInFlight) {
    return {
      ok: false,
      code: "busy",
      message: "Подключение уже выполняется."
    };
  }

  let origin;
  try {
    origin = normalizeServerOrigin(payload?.origin);
  } catch (cause) {
    return {
      ok: false,
      code: "validation",
      message: cause instanceof Error ? cause.message : "Адрес Cosmora имеет неверный формат."
    };
  }

  const credentials = resolveConnectionCredentials(payload, origin);
  connectionInFlight = true;

  try {
    return await connectAndLoad({
      origin,
      ...credentials,
      source: "manual"
    });
  } finally {
    connectionInFlight = false;
  }
});

app.on("login", (event, webContents, details, _authInfo, callback) => {
  if (!webContents || !currentOrigin) return;

  let requestOrigin;
  try {
    requestOrigin = new URL(details.url).origin;
  } catch {
    return;
  }

  if (requestOrigin !== currentOrigin) return;

  event.preventDefault();
  if (
    runtimeCredentials &&
    runtimeCredentials.origin === currentOrigin &&
    details.firstAuthAttempt
  ) {
    callback(runtimeCredentials.username, runtimeCredentials.password);
    return;
  }

  callback();
  credentialStore().clear();
  setImmediate(() => {
    void showConnection(
      runtimeCredentials
        ? "Сервер повторно запросил авторизацию. Проверьте логин и пароль."
        : "Сервер требует логин и пароль."
    );
  });
});

app.on("certificate-error", (event, _webContents, url, error, _certificate, callback) => {
  event.preventDefault();
  appendDiagnostic("certificate_rejected", {
    url: safeLogUrl(url),
    error: String(error || "").slice(0, 160)
  });
  callback(false);
});

app.on("child-process-gone", (_event, details) => {
  appendDiagnostic("child_process_gone", {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode
  });
});

if (ownsSingleInstance) {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.cosmora.desktop");
  createMenu();
  await createMainWindow();
  await tryStartupConnection();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void (async () => {
      await createMainWindow();
      await tryStartupConnection();
    })();
  }
});

app.on("before-quit", () => {
  stopHeartbeat();
  cancelRecovery();
  appendDiagnostic("application_stopping");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
