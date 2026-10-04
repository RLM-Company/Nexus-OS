"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain, Menu, session, shell } = require("electron");
const {
  isAllowedRemoteNavigation,
  nextAvailableDownloadPath,
  normalizeServerOrigin
} = require("./connection-policy.cjs");

const DEFAULT_ORIGIN = "https://13.141.51.16";
const SESSION_PARTITION = "persist:cosmora";
const CONNECTION_FILE = "connection.json";
const HEALTH_TIMEOUT_MS = 6000;

let mainWindow = null;
let currentOrigin = null;
let runtimeCredentials = null;

function connectionPath() {
  return path.join(app.getPath("userData"), CONNECTION_FILE);
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
  fs.renameSync(temporary, target);
}

function localConnectionUrl() {
  return pathToFileURL(path.join(__dirname, "connection.html")).toString();
}

function showConnection(message) {
  currentOrigin = null;
  runtimeCredentials = null;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void mainWindow.loadURL(localConnectionUrl()).then(() => {
    if (!message) return;
    void mainWindow.webContents.executeJavaScript(
      `document.querySelector("#error").textContent = ${JSON.stringify(message)};`,
      true
    );
  });
}

function credentialHeader(username, password) {
  if (!username && !password) return {};
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`
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
        message:
          username || password
            ? "Сервер отклонил логин или пароль."
            : "Сервер требует логин и пароль."
      };
    }
    if (response.status === 403) {
      return { ok: false, message: "Доступ к этому серверу Cosmora запрещён." };
    }
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        message: "Сервер перенаправил health-check. Проверьте адрес Cosmora."
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
      message: "Не удалось подключиться к Cosmora. Проверьте адрес, сеть и TLS-сертификат."
    };
  } finally {
    clearTimeout(timeout);
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
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
}

function installDownloadPolicy(browserSession) {
  browserSession.on("will-download", (event, item) => {
    let downloadOrigin;
    try {
      downloadOrigin = new URL(item.getURL()).origin;
    } catch {
      event.preventDefault();
      return;
    }

    if (!currentOrigin || downloadOrigin !== currentOrigin) {
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
        {
          label: "Подключение…",
          accelerator: "Ctrl+Shift+K",
          click: () => showConnection()
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

function createMainWindow() {
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
      spellcheck: true
    }
  });

  installNavigationGuards(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  showConnection();
}

ipcMain.handle("cosmora:connection-defaults", () => ({
  origin: readSavedOrigin()
}));

ipcMain.handle("cosmora:connect", async (_event, payload) => {
  let origin;
  try {
    origin = normalizeServerOrigin(payload?.origin);
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Адрес Cosmora имеет неверный формат."
    };
  }

  const username = typeof payload?.username === "string" ? payload.username.slice(0, 256) : "";
  const password = typeof payload?.password === "string" ? payload.password.slice(0, 2048) : "";
  const browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
  const probe = await probeServer(browserSession, origin, username, password);
  if (!probe.ok) return probe;

  currentOrigin = origin;
  runtimeCredentials = username || password ? { origin, username, password } : null;
  saveOrigin(origin);

  try {
    await mainWindow.loadURL(origin);
    return { ok: true };
  } catch {
    showConnection("Сервер доступен, но интерфейс Cosmora не открылся.");
    return { ok: false, message: "Сервер доступен, но интерфейс Cosmora не открылся." };
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
  setImmediate(() => {
    showConnection(
      runtimeCredentials
        ? "Сервер повторно запросил авторизацию. Проверьте логин и пароль."
        : "Сервер требует логин и пароль."
    );
  });
});

app.whenReady().then(() => {
  app.setAppUserModelId("com.cosmora.desktop");
  createMenu();
  createMainWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
