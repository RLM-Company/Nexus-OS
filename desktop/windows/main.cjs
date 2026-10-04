"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  safeStorage,
  session,
  shell
} = require("electron");
const { CredentialStore } = require("./credential-store.cjs");
const {
  CONNECTION_STATES,
  connectionTitleSuffix,
  transitionConnectionState
} = require("./connection-state.cjs");
const { serializeSupportBundle } = require("./support-bundle.cjs");
const { createSmokePayload, isSmokeMode, writeSmokeMarker } = require("./smoke-mode.cjs");
const {
  MAX_MANIFEST_BYTES,
  updateManifestUrl,
  validateUpdateManifest
} = require("./update-policy.cjs");
const {
  isAllowedCredentialChallenge,
  isAllowedRemoteNavigation,
  nextAvailableDownloadPath,
  normalizeServerOrigin,
  retryDelayMs,
  safeExternalNavigationUrl,
  safeLogUrl
} = require("./connection-policy.cjs");

const DEFAULT_ORIGIN = "https://13.141.51.16";
const SESSION_PARTITION = "persist:cosmora";
const CONNECTION_FILE = "connection.json";
const CREDENTIAL_FILE = "credentials.bin";
const DIAGNOSTIC_FILE = "cosmora-desktop.log";
const HEALTH_TIMEOUT_MS = 6000;
const UPDATE_CHECK_TIMEOUT_MS = 8000;
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
let connectionState = CONNECTION_STATES.DISCONNECTED;
let lastNetworkOnline = null;
let updateCheckInFlight = false;

const smokeMode = isSmokeMode(process.argv);
const ownsSingleInstance = smokeMode ? true : app.requestSingleInstanceLock();
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

function isTrustedMainWindowEvent(event) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender &&
    event.sender.id === mainWindow.webContents.id
  );
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

function transitionState(event, details = {}) {
  const previous = connectionState;
  const next = transitionConnectionState(previous, event);
  connectionState = next;
  setConnectionTitle(connectionTitleSuffix(next));

  if (previous !== next) {
    appendDiagnostic("connection_state_changed", {
      from: previous,
      to: next,
      trigger: event,
      ...details
    });
  }

  return next;
}

async function showConnection(message, stateEvent = "manual_disconnect") {
  stopHeartbeat();
  cancelRecovery();
  currentOrigin = null;
  runtimeCredentials = null;
  lastRemoteUrl = null;
  transitionState(stateEvent);

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
    if (!isAllowedRemoteNavigation(item.getURL(), currentOrigin)) {
      event.preventDefault();
      appendDiagnostic("download_blocked", { reason: "untrusted_url" });
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
    } else {
      const externalUrl = safeExternalNavigationUrl(url);
      if (externalUrl) void shell.openExternal(externalUrl);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url === localConnectionUrl() || isAllowedRemoteNavigation(url, currentOrigin)) return;
    event.preventDefault();
    appendDiagnostic("navigation_blocked", { url: safeLogUrl(url) });
    const externalUrl = safeExternalNavigationUrl(url);
    if (externalUrl) void shell.openExternal(externalUrl);
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
    transitionState("renderer_unresponsive");
  });

  window.webContents.on("responsive", () => {
    appendDiagnostic("renderer_responsive");
    if (currentOrigin && heartbeatFailures === 0) transitionState("renderer_responsive");
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
      transitionState("recovery_success");
      return;
    }

    heartbeatFailures += 1;
    appendDiagnostic("heartbeat_failed", {
      code: result.code,
      failures: heartbeatFailures
    });
    transitionState("heartbeat_failed", {
      code: result.code,
      failures: heartbeatFailures
    });

    if (result.code === "auth" || result.code === "forbidden") {
      if (result.code === "auth") credentialStore().clear();
      await showConnection(result.message, "auth_failed");
      return;
    }
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
  transitionState("recovery_started", { reason });
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
  if (recoveryInFlight || !currentOrigin || !mainWindow || mainWindow.isDestroyed()) {
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
        await showConnection(probe.message, "auth_failed");
        return;
      }

      retry = true;
      return;
    }

    await mainWindow.loadURL(target);
    recoveryAttempt = 0;
    heartbeatFailures = 0;
    transitionState("recovery_success");
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

function readDiagnosticTail() {
  try {
    const source = fs.readFileSync(diagnosticPath());
    return source.subarray(Math.max(0, source.length - KEEP_DIAGNOSTIC_BYTES)).toString("utf8");
  } catch {
    return "";
  }
}

function supportBundleDefaultName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return "Cosmora-Support-" + stamp + ".json";
}

async function exportSupportBundle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Экспорт пакета поддержки Cosmora",
    defaultPath: path.join(app.getPath("documents"), supportBundleDefaultName()),
    filters: [{ name: "JSON", extensions: ["json"] }]
  });

  if (result.canceled || !result.filePath) return;

  const origin = currentOrigin || readSavedOrigin();
  const payload = serializeSupportBundle({
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron || "",
    chromeVersion: process.versions.chrome || "",
    nodeVersion: process.versions.node || "",
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    origin,
    connectionState,
    lastRoute: lastRemoteUrl ? safeLogUrl(lastRemoteUrl) : null,
    rememberedCredentials: credentialStore().has(origin),
    diagnosticText: readDiagnosticTail()
  });

  try {
    fs.writeFileSync(result.filePath, payload, {
      encoding: "utf8",
      mode: 0o600
    });
    appendDiagnostic("support_bundle_exported", {
      filename: path.basename(result.filePath)
    });
  } catch {
    appendDiagnostic("support_bundle_export_failed");
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Cosmora",
      message: "Не удалось сохранить пакет поддержки.",
      detail: "Выберите другой файл или проверьте права на запись."
    });
  }
}

async function readResponseTextWithLimit(response, maxBytes) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength) {
    const declaredBytes = Number(declaredLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new Error("Update manifest exceeds the allowed size.");
    }
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error("Update manifest exceeds the allowed size.");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Best effort cancellation after the size limit is exceeded.
        }
        throw new Error("Update manifest exceeds the allowed size.");
      }
      chunks.push(chunk);
    }
  } finally {
    if (typeof reader.releaseLock === "function") reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function fetchDesktopUpdate(origin) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  const credentials =
    runtimeCredentials && runtimeCredentials.origin === origin
      ? runtimeCredentials
      : { username: "", password: "" };

  try {
    const browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
    const response = await browserSession.fetch(updateManifestUrl(origin), {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      redirect: "manual",
      headers: credentialHeader(credentials.username, credentials.password),
      signal: controller.signal
    });

    if (response.status === 404) {
      return {
        ok: false,
        code: "not_configured",
        message: "Канал обновлений пока не настроен на этом сервере Cosmora."
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: "auth",
        message: "Сервер не разрешил проверить обновления для текущей сессии."
      };
    }
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        code: "redirect",
        message: "Сервер попытался перенаправить запрос обновлений."
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        code: "http",
        message: "Проверка обновлений завершилась ошибкой HTTP " + response.status + "."
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!/application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(contentType)) {
      return {
        ok: false,
        code: "format",
        message: "Сервер обновлений вернул неожиданный формат данных."
      };
    }

    let raw;
    try {
      raw = await readResponseTextWithLimit(response, MAX_MANIFEST_BYTES);
    } catch (cause) {
      return {
        ok: false,
        code: "too_large",
        message:
          cause instanceof Error
            ? cause.message
            : "Манифест обновления превышает допустимый размер."
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        code: "invalid_json",
        message: "Сервер обновлений вернул повреждённый JSON."
      };
    }

    try {
      return {
        ok: true,
        manifest: validateUpdateManifest(parsed, app.getVersion())
      };
    } catch (cause) {
      appendDiagnostic("update_manifest_rejected", {
        reason: cause instanceof Error ? cause.message.slice(0, 160) : "invalid"
      });
      return {
        ok: false,
        code: "invalid_manifest",
        message: "Манифест обновления не прошёл проверку безопасности."
      };
    }
  } catch (cause) {
    if (cause && cause.name === "AbortError") {
      return {
        ok: false,
        code: "timeout",
        message: "Сервер обновлений не ответил за 8 секунд."
      };
    }
    return {
      ok: false,
      code: "network",
      message: "Не удалось проверить обновления. Проверьте сеть и подключение к Cosmora."
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function showAboutDialog() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "О Cosmora",
    message: "Cosmora for Windows " + app.getVersion(),
    detail:
      "Electron " +
      (process.versions.electron || "unknown") +
      "\nСостояние соединения: " +
      connectionState +
      "\nОбновления: только ручная проверка; автоматическая установка отключена."
  });
}

async function checkForDesktopUpdate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (updateCheckInFlight) {
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Cosmora",
      message: "Проверка обновлений уже выполняется."
    });
    return;
  }

  if (!currentOrigin) {
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Cosmora",
      message: "Сначала подключитесь к серверу Cosmora."
    });
    return;
  }

  if (connectionInFlight || recoveryInFlight) {
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Cosmora",
      message: "Дождитесь завершения подключения или восстановления соединения."
    });
    return;
  }

  updateCheckInFlight = true;
  const origin = currentOrigin;
  appendDiagnostic("update_check_started", {
    currentVersion: app.getVersion()
  });

  try {
    const result = await fetchDesktopUpdate(origin);
    if (currentOrigin !== origin) {
      appendDiagnostic("update_check_discarded", { reason: "connection_changed" });
      return;
    }

    if (!result.ok) {
      appendDiagnostic("update_check_failed", { code: result.code });
      await dialog.showMessageBox(mainWindow, {
        type: result.code === "not_configured" ? "info" : "warning",
        title: "Обновления Cosmora",
        message: result.message
      });
      return;
    }

    const manifest = result.manifest;
    if (!manifest.updateAvailable) {
      appendDiagnostic("update_check_current", {
        currentVersion: app.getVersion(),
        manifestVersion: manifest.version
      });
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Обновления Cosmora",
        message: "Установлена актуальная версия Cosmora.",
        detail: "Текущая версия: " + app.getVersion()
      });
      return;
    }

    appendDiagnostic("update_available", {
      currentVersion: app.getVersion(),
      availableVersion: manifest.version,
      installerMetadataPresent: Boolean(manifest.downloadUrl)
    });

    const detail = [
      "Текущая версия: " + app.getVersion(),
      "Доступна версия: " + manifest.version,
      "Опубликована: " + manifest.publishedAt.slice(0, 10),
      manifest.notes ? "\n" + manifest.notes : "",
      "\nCosmora не скачивает и не запускает обновление автоматически."
    ]
      .filter(Boolean)
      .join("\n");

    const choice = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Обновление Cosmora",
      message: "Доступна новая версия.",
      detail,
      buttons: ["Позже", "Открыть страницу релиза"],
      defaultId: 0,
      cancelId: 0
    });

    if (choice.response === 1) {
      const releasePage = safeExternalNavigationUrl(manifest.releasePageUrl);
      if (releasePage && releasePage.startsWith("https://")) {
        appendDiagnostic("update_release_page_opened", {
          availableVersion: manifest.version
        });
        void shell.openExternal(releasePage);
      }
    }
  } finally {
    updateCheckInFlight = false;
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
          label: "Проверить обновления…",
          click: () => {
            void checkForDesktopUpdate();
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
        {
          label: "Экспортировать пакет поддержки…",
          click: () => {
            void exportSupportBundle();
          }
        },
        { type: "separator" },
        {
          label: "О Cosmora",
          click: () => {
            void showAboutDialog();
          }
        },
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

async function connectAndLoad({ origin, username, password, rememberCredentials, source }) {
  transitionState("connect_started", { source });
  const browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
  const probe = await probeServer(browserSession, origin, username, password);

  if (!probe.ok) {
    appendDiagnostic("connection_failed", {
      source,
      code: probe.code,
      origin
    });
    transitionState(
      probe.code === "auth" || probe.code === "forbidden" ? "auth_failed" : "manual_disconnect"
    );
    return probe;
  }

  const persisted = persistCredentialChoice(origin, username, password, rememberCredentials);
  if (!persisted.ok) return persisted;

  currentOrigin = origin;
  runtimeCredentials = username || password ? { origin, username, password } : null;
  lastRemoteUrl = origin;
  saveOrigin(origin);

  try {
    await mainWindow.loadURL(origin);
    recoveryAttempt = 0;
    heartbeatFailures = 0;
    transitionState("connect_success", { source });
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
    await showConnection("Сервер доступен, но интерфейс Cosmora не открылся.", "manual_disconnect");
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
      await showConnection(
        result.message,
        result.code === "auth" || result.code === "forbidden" ? "auth_failed" : "manual_disconnect"
      );
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

ipcMain.on("cosmora:network-status", (event, payload) => {
  if (!isTrustedMainWindowEvent(event)) return;
  const online = payload?.online === true;
  if (online === lastNetworkOnline) return;
  lastNetworkOnline = online;
  appendDiagnostic("network_status", { online });

  if (!currentOrigin || connectionInFlight) return;

  if (!online) {
    stopHeartbeat();
    cancelRecovery();
    transitionState("network_offline");
    return;
  }

  cancelRecovery();
  recoveryAttempt = 0;
  transitionState("network_online");
  void runRecovery("network_online");
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

app.on("login", (event, webContents, details, authInfo, callback) => {
  if (!webContents || !currentOrigin) return;
  if (!mainWindow || mainWindow.isDestroyed() || webContents.id !== mainWindow.webContents.id) {
    return;
  }

  if (authInfo?.isProxy) {
    event.preventDefault();
    appendDiagnostic("proxy_auth_declined");
    callback();
    return;
  }

  if (!isAllowedCredentialChallenge(details.url, currentOrigin, false)) return;

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
        : "Сервер требует логин и пароль.",
      "auth_failed"
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

if (ownsSingleInstance && !smokeMode) {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function installPowerLifecycle() {
  powerMonitor.on("suspend", () => {
    appendDiagnostic("system_suspend");
    stopHeartbeat();
    cancelRecovery();
  });

  powerMonitor.on("resume", () => {
    appendDiagnostic("system_resume");
    if (!currentOrigin || connectionInFlight) return;
    cancelRecovery();
    recoveryAttempt = 0;
    transitionState("resume");
    void runRecovery("resume");
  });

  powerMonitor.on("unlock-screen", () => {
    appendDiagnostic("screen_unlocked");
    if (currentOrigin && !connectionInFlight) void heartbeatTick();
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.cosmora.desktop");

  if (smokeMode) {
    try {
      const payload = createSmokePayload({
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        execPath: process.execPath,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath("userData"),
        platform: process.platform,
        arch: process.arch
      });
      writeSmokeMarker({
        outputPath: process.env.COSMORA_SMOKE_OUTPUT,
        tempDir: os.tmpdir(),
        payload
      });
      app.exit(0);
    } catch (cause) {
      process.stderr.write(
        "Cosmora installer smoke mode failed: " +
          (cause instanceof Error ? cause.message : String(cause)) +
          "\n"
      );
      app.exit(2);
    }
    return;
  }

  installPowerLifecycle();
  createMenu();
  await createMainWindow();
  await tryStartupConnection();
});

app.on("activate", () => {
  if (smokeMode) return;
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
  if (!smokeMode) appendDiagnostic("application_stopping");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
