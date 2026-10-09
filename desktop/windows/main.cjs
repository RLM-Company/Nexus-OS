"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  screen,
  session,
  shell,
  Tray
} = require("electron");
const {
  cleanRoute,
  createPreferenceStore,
  deepLinkFromArgv,
  restoredBounds
} = require("./desktop-state.cjs");
const { createUpdateService } = require("./update-service.cjs");
const updateTrust = require("./update-trust.json");
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

// Keep the existing profile and Chromium partition across the product rename.
const profileDirectory = path.join(app.getPath("appData"), "cosmora-windows-desktop");
fs.mkdirSync(profileDirectory, { recursive: true });
app.setPath("userData", profileDirectory);
app.setPath("sessionData", profileDirectory);
app.setName("Kosmora");

const preferences = createPreferenceStore(profileDirectory);
let mainWindow = null;
let tray = null;
let saveWindowTimer = null;
let pendingDeepLink = deepLinkFromArgv(process.argv);
let updates = null;
let currentOrigin = null;
let connectionMessage = "";
let restoringInitialPage = false;
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

function saveWindowState() {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.isMinimized() ||
    mainWindow.isFullScreen()
  )
    return;
  try {
    preferences.update({
      bounds: mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds(),
      maximized: mainWindow.isMaximized()
    });
  } catch {
    /* never block a window close because of profile I/O */
  }
}

function deferWindowState() {
  clearTimeout(saveWindowTimer);
  saveWindowTimer = setTimeout(saveWindowState, 350);
}

function persistRoute(url) {
  if (restoringInitialPage || !currentOrigin || !isAllowedRemoteNavigation(url, currentOrigin))
    return;
  try {
    const parsed = new URL(url);
    const route = cleanRoute(parsed.pathname);
    if (route && !parsed.search && !parsed.hash && route !== preferences.get().lastPath) {
      preferences.update({ lastPath: route });
    }
  } catch {
    /* ignore invalid/temporary navigation */
  }
}

function revealWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function openRoute(route) {
  const safe = cleanRoute(route);
  if (!safe || !currentOrigin || !mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.webContents.getURL() === localConnectionUrl()) {
    pendingDeepLink = safe;
    return false;
  }
  await mainWindow.loadURL(currentOrigin + safe);
  return true;
}

function refreshTray() {
  if (!preferences.get().trayEnabled) {
    if (tray) {
      tray.destroy();
      tray = null;
    }
    return;
  }
  if (!tray) {
    tray = new Tray(path.join(__dirname, "build", "icon.ico"));
    tray.setToolTip("Kosmora");
    tray.on("double-click", revealWindow);
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Открыть Kosmora", click: revealWindow },
      {
        label: "Выход",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

function notifyUpdate(version) {
  if (!preferences.get().notifyUpdates || !Notification.isSupported()) return;
  new Notification({
    title: "Kosmora",
    body: `Доступна проверенная версия ${version}. Установка только вручную.`
  }).show();
}

async function checkUpdates({ interactive = false } = {}) {
  if (!updates) return;
  try {
    const result = await updates.check();
    if (result.status === "available") {
      if (interactive) {
        const choice = await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Обновление Kosmora",
          message: `Версия ${result.version} имеет действительную подпись манифеста.`,
          detail:
            "Установщик будет только скачан и проверен по SHA-256. Автоматического запуска или установки нет. Windows Authenticode этим не подтверждается.",
          buttons: ["Скачать и проверить", "Отмена"],
          cancelId: 1,
          defaultId: 1,
          noLink: true
        });
        if (choice.response === 0) {
          const staged = await updates.stage();
          await dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Kosmora",
            message: `Версия ${staged.version} сохранена.`,
            detail:
              "Файл проверен по подписанному SHA-256. Перед установкой вручную проверьте издателя в Windows. Текущая версия остаётся установленной."
          });
          shell.showItemInFolder(staged.file);
        }
      } else notifyUpdate(result.version);
    } else if (interactive) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Обновления Kosmora",
        message:
          result.status === "current"
            ? "Установлена актуальная версия."
            : result.message || "Обновления недоступны."
      });
    }
  } catch (error) {
    if (interactive)
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Обновление не подтверждено",
        message: error instanceof Error ? error.message : "Проверка обновления не удалась."
      });
  }
}

async function showRollbackCandidate() {
  try {
    const candidate = await updates.previousVerified();
    if (!candidate) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Откат Kosmora",
        message: "Ранее проверенного установщика старой версии нет.",
        detail: "Первоначальный установщик 0.10.0 автоматически не архивировался."
      });
      return;
    }
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Откат Kosmora",
      message: `Найдена проверенная версия ${candidate.version}.`,
      detail:
        "Автоматического отката нет. Переустановка выполняется владельцем вручную после проверки подписи Windows."
    });
    shell.showItemInFolder(candidate.file);
  } catch {
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      message: "Не удалось проверить предыдущий установщик."
    });
  }
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
    const requestOptions = {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal
    };
    let response = await browserSession.fetch(origin + "/api/v1/health", requestOptions);
    // The owner gateway protects the health route before the first sign-in.
    // Confirm its public login page is reachable, then let ordinary login proceed.
    if (response.status === 401) {
      response = await browserSession.fetch(origin + "/login", requestOptions);
    }
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        message: "Сервер перенаправил проверку подключения. Проверьте адрес Kosmora."
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        message: `Kosmora ответила ошибкой HTTP ${response.status}. Повторите попытку позже.`
      };
    }
    return { ok: true };
  } catch (cause) {
    if (cause && cause.name === "AbortError") {
      return { ok: false, message: "Сервер Kosmora не ответил за 6 секунд." };
    }
    return {
      ok: false,
      message: "Не удалось подключиться к Kosmora. Проверьте сеть и TLS-сертификат."
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

    const previousOrigin = currentOrigin;
    const requestedRoute =
      pendingDeepLink ||
      (preferences.get().restorePage && previousOrigin === origin
        ? preferences.get().lastPath
        : "/");
    currentOrigin = origin;
    restoringInitialPage = true;
    try {
      await mainWindow.loadURL(origin);
      if (!connectionAttemptGate.isCurrent(generation)) {
        return { ok: false, stale: true, message: "Эта попытка подключения уже заменена новой." };
      }
      if (persist) {
        saveOrigin(origin);
        if (previousOrigin !== origin) preferences.update({ lastPath: "/" });
      }
      connectionMessage = "";
      pendingDeepLink = null;
      if (requestedRoute !== "/") {
        const opened = await openRoute(requestedRoute).catch(() => false);
        if (opened && preferences.get().lastPath !== requestedRoute)
          preferences.update({ lastPath: requestedRoute });
      }
      return { ok: true };
    } catch {
      if (connectionAttemptGate.isCurrent(generation)) {
        currentOrigin = previousOrigin;
        await showConnection(
          "Сервер доступен, но интерфейс Kosmora не открылся. Повторите попытку."
        );
      }
      return { ok: false, message: "Сервер доступен, но интерфейс Kosmora не открылся." };
    }
  } finally {
    if (connectionAttemptGate.isCurrent(generation)) restoringInitialPage = false;
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

  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("did-navigate", (_event, url) => persistRoute(url));
  window.webContents.on("did-navigate-in-page", (_event, url) => persistRoute(url));

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
        void showConnection("Соединение с Kosmora потеряно. Сохранённый адрес не изменён.");
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

  browserSession.on("will-download", (event, item, sourceContents) => {
    const chain = item.getURLChain();
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      sourceContents !== mainWindow.webContents ||
      !isAllowedRemoteNavigation(sourceContents.getURL(), currentOrigin) ||
      !isAllowedDownload(chain.length ? chain : [item.getURL()], currentOrigin)
    ) {
      event.preventDefault();
      return;
    }
    const prefs = preferences.get();
    const directory =
      prefs.downloadDirectory &&
      fs.existsSync(prefs.downloadDirectory) &&
      fs.statSync(prefs.downloadDirectory).isDirectory()
        ? prefs.downloadDirectory
        : app.getPath("downloads");
    const target = nextAvailableDownloadPath(directory, item.getFilename(), fs.existsSync);
    if (prefs.askWhereToSave) {
      item.setSaveDialogOptions({ title: "Сохранить файл Kosmora", defaultPath: target });
    } else {
      item.setSavePath(target);
    }
  });
}

function createMenu() {
  const pref = preferences.get();
  const toggle = (key, value) => {
    preferences.update({ [key]: value });
    if (key === "trayEnabled") refreshTray();
    createMenu();
  };
  const template = [
    {
      label: "Kosmora",
      submenu: [
        {
          label: "Сменить сервер…",
          accelerator: "Ctrl+Shift+K",
          click: () => void showConnection()
        },
        { type: "separator" },
        {
          label: "Выход",
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: "Файлы",
      submenu: [
        {
          label: "Выбрать папку загрузок…",
          click: async () => {
            const choice = await dialog.showOpenDialog(mainWindow, {
              title: "Папка загрузок Kosmora",
              properties: ["openDirectory", "createDirectory"],
              defaultPath: pref.downloadDirectory || app.getPath("downloads")
            });
            if (!choice.canceled && choice.filePaths[0])
              preferences.update({ downloadDirectory: choice.filePaths[0] });
          }
        },
        {
          label: "Вернуть стандартную папку загрузок",
          click: () => preferences.update({ downloadDirectory: null })
        },
        {
          label: "Спрашивать, куда сохранить",
          type: "checkbox",
          checked: pref.askWhereToSave,
          click: (item) => toggle("askWhereToSave", item.checked)
        },
        { type: "separator" },
        {
          label: "Открыть папку загрузок",
          click: () =>
            shell.openPath(preferences.get().downloadDirectory || app.getPath("downloads"))
        }
      ]
    },
    {
      label: "Настройки",
      submenu: [
        {
          label: "Восстанавливать последнюю страницу",
          type: "checkbox",
          checked: pref.restorePage,
          click: (item) => toggle("restorePage", item.checked)
        },
        {
          label: "Оставлять Kosmora в трее при закрытии",
          type: "checkbox",
          checked: pref.trayEnabled,
          click: (item) => toggle("trayEnabled", item.checked)
        },
        {
          label: "Проверять обновления при запуске",
          type: "checkbox",
          checked: pref.checkUpdatesOnStart,
          click: (item) => toggle("checkUpdatesOnStart", item.checked)
        },
        {
          label: "Уведомлять об обновлениях",
          type: "checkbox",
          checked: pref.notifyUpdates,
          click: (item) => toggle("notifyUpdates", item.checked)
        }
      ]
    },
    {
      label: "Обновления",
      submenu: [
        { label: `Версия ${app.getVersion()}`, enabled: false },
        {
          label: "Проверить подписанный релиз…",
          click: () => void checkUpdates({ interactive: true })
        },
        {
          label: "Показать предыдущий проверенный установщик…",
          click: () => void showRollbackCandidate()
        }
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

  const savedWindow = preferences.get();
  const windowBounds = restoredBounds(savedWindow.bounds, screen.getAllDisplays());
  mainWindow = new BrowserWindow({
    ...(windowBounds || { width: 1440, height: 900 }),
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#ffffff",
    show: false,
    title: "Kosmora",
    webPreferences: {
      partition: SESSION_PARTITION,
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: true
    }
  });

  installNavigationGuards(mainWindow);
  if (savedWindow.maximized) mainWindow.maximize();
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("resize", deferWindowState);
  mainWindow.on("move", deferWindowState);
  mainWindow.on("close", (event) => {
    clearTimeout(saveWindowTimer);
    saveWindowState();
    if (preferences.get().trayEnabled && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
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
      message: cause instanceof Error ? cause.message : "Адрес Kosmora имеет неверный формат."
    };
  }
  return openOrigin(origin, { persist: true });
});

ipcMain.handle("cosmora:retry", async (event) => {
  if (!isTrustedConnectionEvent(event))
    return { ok: false, message: "Недоверенный источник запроса." };
  const saved = readSavedOrigin();
  if (!saved.saved) return { ok: false, message: "Сначала укажите сервер Kosmora." };
  currentOrigin = saved.origin;
  return openOrigin(saved.origin);
});

if (gotSingleInstanceLock) {
  app.on("second-instance", (_event, commandLine) => {
    const route = deepLinkFromArgv(commandLine);
    if (route) {
      pendingDeepLink = route;
      void openRoute(route)
        .then((opened) => {
          if (opened) pendingDeepLink = null;
        })
        .catch(() => {});
    }
    revealWindow();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const route = deepLinkFromArgv([url]);
    if (route) {
      pendingDeepLink = route;
      void openRoute(route)
        .then((opened) => {
          if (opened) pendingDeepLink = null;
        })
        .catch(() => {});
    }
    revealWindow();
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

    if (app.isPackaged) app.setAsDefaultProtocolClient("kosmora");
    const browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
    updates = createUpdateService({
      fetcher: (url, options) => browserSession.fetch(url, options),
      origin: () => currentOrigin,
      currentVersion: () => app.getVersion(),
      userData: app.getPath("userData"),
      publicKeyPem: updateTrust.publicKeyPem
    });
    createMenu();
    refreshTray();
    await createMainWindow();
    if (preferences.get().checkUpdatesOnStart && currentOrigin) void checkUpdates();
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
