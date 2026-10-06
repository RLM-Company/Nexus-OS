"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain, Menu, session, shell } = require("electron");
const { createSmokePayload, isSmokeMode, writeSmokeMarker } = require("./smoke-mode.cjs");
const {
  connectionViewState,
  createLatestAttemptGate,
  isAllowedDownload,
  isAllowedRemoteNavigation,
  isSafeExternalUrl,
  nextAvailableDownloadPath,
  normalizeServerOrigin
} = require("./connection-policy.cjs");

const DEFAULT_ORIGIN = "https://13.141.51.16";
const SESSION_PARTITION = "persist:cosmora";
const CONNECTION_FILE = "connection.json";
const HEALTH_TIMEOUT_MS = 6000;

let mainWindow = null;
let currentOrigin = null;
let connectionMessage = "";
let isQuitting = false;
let downloadPolicyInstalled = false;
const connectionAttemptGate = createLatestAttemptGate();

const smokeMode = isSmokeMode(process.argv);
const gotSingleInstanceLock = smokeMode ? true : app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function connectionPath() {
  return path.join(app.getPath("userData"), CONNECTION_FILE);
}

function readSavedOrigin() {
  try {
    const parsed = JSON.parse(fs.readFileSync(connectionPath(), "utf8"));
    return { origin: normalizeServerOrigin(parsed.origin), saved: true };
  } catch {
    return { origin: DEFAULT_ORIGIN, saved: false };
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
  fs.renameSync(temporary, target);
}

function localConnectionUrl() {
  return pathToFileURL(path.join(__dirname, "connection.html")).toString();
}

function isTrustedConnectionEvent(event) {
  return Boolean(event?.senderFrame && event.senderFrame.url === localConnectionUrl());
}

async function showConnection(message = "") {
  connectionMessage = message;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.getURL() !== localConnectionUrl()) {
    await mainWindow.loadURL(localConnectionUrl());
  } else {
    mainWindow.webContents.send("cosmora:connection-state-changed");
  }
}

async function probeServer(browserSession, origin) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await browserSession.fetch(origin + "/api/v1/health", {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        message: "Сервер перенаправил проверку подключения. Проверьте адрес Cosmora."
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        message: `Cosmora ответила ошибкой HTTP ${response.status}. Повторите попытку позже.`
      };
    }
    return { ok: true };
  } catch (cause) {
    if (cause && cause.name === "AbortError") {
      return { ok: false, message: "Сервер Cosmora не ответил за 6 секунд." };
    }
    return {
      ok: false,
      message: "Не удалось подключиться к Cosmora. Проверьте сеть и TLS-сертификат."
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function openOrigin(origin, { persist = false } = {}) {
  const generation = connectionAttemptGate.begin();
  const browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
  try {
    const probe = await probeServer(browserSession, origin);
    if (!connectionAttemptGate.isCurrent(generation)) {
      return { ok: false, stale: true, message: "Эта попытка подключения уже заменена новой." };
    }
    if (!probe.ok) {
      await showConnection(probe.message);
      return probe;
    }

    currentOrigin = origin;
    try {
      await mainWindow.loadURL(origin);
      if (!connectionAttemptGate.isCurrent(generation)) {
        return { ok: false, stale: true, message: "Эта попытка подключения уже заменена новой." };
      }
      if (persist) saveOrigin(origin);
      connectionMessage = "";
      return { ok: true };
    } catch {
      if (connectionAttemptGate.isCurrent(generation)) {
        await showConnection(
          "Сервер доступен, но интерфейс Cosmora не открылся. Повторите попытку."
        );
      }
      return { ok: false, message: "Сервер доступен, но интерфейс Cosmora не открылся." };
    }
  } finally {
    connectionAttemptGate.finish(generation);
  }
}

function installNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedRemoteNavigation(url, currentOrigin)) {
      void window.loadURL(url);
    } else if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url === localConnectionUrl() || isAllowedRemoteNavigation(url, currentOrigin)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  window.webContents.on("will-redirect", (event, url) => {
    if (isAllowedRemoteNavigation(url, currentOrigin)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, _description, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || !currentOrigin) return;
      if (isAllowedRemoteNavigation(validatedURL, currentOrigin)) {
        void showConnection("Соединение с Cosmora потеряно. Сохранённый адрес не изменён.");
      }
    }
  );
}

function installSessionPolicy(browserSession) {
  if (downloadPolicyInstalled) return;
  downloadPolicyInstalled = true;

  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  );
  browserSession.setPermissionCheckHandler(() => false);

  browserSession.on("will-download", (event, item) => {
    const chain = item.getURLChain();
    if (!isAllowedDownload(chain.length ? chain : [item.getURL()], currentOrigin)) {
      event.preventDefault();
      return;
    }
    const target = nextAvailableDownloadPath(
      app.getPath("downloads"),
      item.getFilename(),
      fs.existsSync
    );
    item.setSavePath(target);
  });
}

function createMenu() {
  const template = [
    {
      label: "Cosmora",
      submenu: [
        { label: "Сменить сервер…", accelerator: "Ctrl+Shift+K", click: () => showConnection() },
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
  installSessionPolicy(browserSession);

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
      spellcheck: true
    }
  });

  installNavigationGuards(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const saved = readSavedOrigin();
  currentOrigin = saved.saved ? saved.origin : null;
  if (!saved.saved) {
    await showConnection();
    return;
  }
  await openOrigin(saved.origin);
}

ipcMain.handle("cosmora:connection-state", (event) => {
  if (!isTrustedConnectionEvent(event)) throw new Error("Untrusted desktop IPC caller.");
  const saved = readSavedOrigin();
  return {
    origin: saved.origin,
    ...connectionViewState({
      hasSavedOrigin: saved.saved,
      message: connectionMessage,
      connecting: connectionAttemptGate.isInFlight()
    })
  };
});

ipcMain.handle("cosmora:connect", async (event, payload) => {
  if (!isTrustedConnectionEvent(event))
    return { ok: false, message: "Недоверенный источник запроса." };
  let origin;
  try {
    origin = normalizeServerOrigin(payload?.origin);
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Адрес Cosmora имеет неверный формат."
    };
  }
  return openOrigin(origin, { persist: true });
});

ipcMain.handle("cosmora:retry", async (event) => {
  if (!isTrustedConnectionEvent(event))
    return { ok: false, message: "Недоверенный источник запроса." };
  const saved = readSavedOrigin();
  if (!saved.saved) return { ok: false, message: "Сначала укажите сервер Cosmora." };
  currentOrigin = saved.origin;
  return openOrigin(saved.origin);
});

if (gotSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

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
          tempDir: app.getPath("temp"),
          payload
        });
        app.quit();
        return;
      } catch (cause) {
        console.error(cause instanceof Error ? cause.message : cause);
        app.exit(1);
        return;
      }
    }

    createMenu();
    await createMainWindow();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !isQuitting) app.quit();
  });
}
