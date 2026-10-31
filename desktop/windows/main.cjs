"use strict";

const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  WebContentsView,
  dialog,
  ipcMain,
  Menu,
  Notification,
  screen,
  session,
  shell,
  Tray,
  safeStorage,
  desktopCapturer,
  globalShortcut
} = require("electron");
const { createKosworkBrowser } = require("./browser/shell.cjs");
const { createBrowserProfiles } = require("./browser/profiles.cjs");
const { createTaskGate } = require("./browser/policy.cjs");
const { createComputerConsole } = require("./computer-console.cjs");
const { createPreferenceStore, deepLinkFromArgv, restoredBounds } = require("./desktop-state.cjs");
const { createUpdateService } = require("./update-service.cjs");
const { createDraftStore } = require("./draft-store.cjs");
const { createComputerWorkspace } = require("./computer-workspace.cjs");
const { createComputerHistory } = require("./computer-history.cjs");
const { fetchElectronOwner } = require("./owner-session.cjs");
const { createDraftSessionGate } = require("./draft-session-gate.cjs");
const { createDownloadCenter } = require("./download-center.cjs");
const { createVaultConsole } = require("./vault-console.cjs");
const { safeWorkspaceRoute, isLoginOrLogout, isExplicitLogout } = require("./desktop-recovery.cjs");
const updateTrust = require("./update-trust.json");
const { createSmokePayload, isSmokeMode, writeSmokeMarker } = require("./smoke-mode.cjs");
const {
  isGuiAcceptanceMode,
  assertGuiAcceptanceEnvironment,
  runPackagedGuiAcceptance
} = require("./gui-acceptance.cjs");
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
const guiAcceptanceMode = isGuiAcceptanceMode(process.argv);
if (guiAcceptanceMode) assertGuiAcceptanceEnvironment({ isPackaged: app.isPackaged });

// Keep the existing profile and Chromium partition across the product rename.
const profileDirectory = path.join(app.getPath("appData"), "cosmora-windows-desktop");
fs.mkdirSync(profileDirectory, { recursive: true });
app.setPath("userData", profileDirectory);
app.setPath("sessionData", profileDirectory);
app.setName("Kosmora");

const preferences = createPreferenceStore(profileDirectory);
const localTextCodec = {
  seal(text) {
    if (process.platform !== "win32" || !safeStorage.isEncryptionAvailable())
      throw new Error("Защищённое сохранение Windows сейчас недоступно.");
    return safeStorage.encryptString(text).toString("base64");
  },
  open(sealed) {
    if (
      process.platform !== "win32" ||
      !safeStorage.isEncryptionAvailable() ||
      typeof sealed !== "string" ||
      !/^[a-zA-Z0-9+/]+=*$/.test(sealed)
    )
      throw new Error("Не удалось открыть защищённый черновик.");
    return safeStorage.decryptString(Buffer.from(sealed, "base64"));
  }
};
const textDrafts = createDraftStore(profileDirectory, { codec: localTextCodec });
const computerHistory = createComputerHistory(profileDirectory, { codec: localTextCodec });
const workCycleHistory = createComputerHistory(profileDirectory, {
  codec: localTextCodec,
  namespace: "work"
});
const computerWorkspace = createComputerWorkspace({
  userDataPath: profileDirectory,
  codec: localTextCodec,
  pickDirectory: async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Выберите рабочую папку Koswork",
      properties: ["openDirectory", "dontAddToRecent"]
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }
});
const activeDownloads = new Map();
const draftSessionGate = createDraftSessionGate();
let ownerCache = null;
let identityEpoch = 0;
let connectivityProbeInFlight = false;
let deferredRoute = null;
let connectivityTimer = null;
let loginRouteInProgress = false;
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
// Recovery writes must never run in a second instance or the installer smoke process.
const downloadCenter =
  gotSingleInstanceLock && !smokeMode
    ? createDownloadCenter({
        BrowserWindow,
        ipcMain,
        shell,
        dialog,
        profileDirectory,
        activeDownloads,
        getOrigin: () => currentOrigin,
        getIdentityEpoch: () => identityEpoch,
        verifiedOwner,
        getMainWindow: () => mainWindow,
        onChange: createMenu
      })
    : null;

const vaultConsole =
  gotSingleInstanceLock && !smokeMode && !guiAcceptanceMode
    ? createVaultConsole({
        BrowserWindow,
        ipcMain,
        dialog,
        profileDirectory,
        codec: localTextCodec,
        getEpoch: () => identityEpoch,
        getMainWindow: () => mainWindow,
        getSession: () => session.fromPartition(SESSION_PARTITION, { cache: true }),
        identity: async () => {
          const owner = await verifiedOwner({ allowCachedWrite: true });
          return owner && currentOrigin ? { owner, origin: currentOrigin } : null;
        }
      })
    : null;
const taskGate = createTaskGate();
const browserWorkspace = createComputerWorkspace({
  userDataPath: profileDirectory,
  codec: localTextCodec,
  scopeNamespace: "browser",
  pickDirectory: async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Рабочая папка браузера Koswork",
      properties: ["openDirectory", "dontAddToRecent"]
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }
});
const managedBrowserProfiles = createBrowserProfiles({ userData: profileDirectory, session });
const kosworkBrowser =
  gotSingleInstanceLock && !smokeMode && !guiAcceptanceMode
    ? createKosworkBrowser({
        BrowserWindow,
        WebContentsView,
        Menu,
        ipcMain,
        dialog,
        globalShortcut,
        taskGate,
        history: computerHistory,
        workspace: browserWorkspace,
        profiles: managedBrowserProfiles,
        identity: async () => {
          const owner = await verifiedOwner();
          return owner && currentOrigin ? { owner, origin: currentOrigin } : null;
        },
        getSession: () => session.fromPartition(SESSION_PARTITION, { cache: true })
      })
    : null;
const workCycleWorkspace = createComputerWorkspace({
  userDataPath: profileDirectory,
  codec: localTextCodec,
  scopeNamespace: "work-cycle",
  pickDirectory: async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Рабочая папка задачи Koswork",
      properties: ["openDirectory", "dontAddToRecent"]
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }
});
const kosworkWorkCycle =
  gotSingleInstanceLock && !smokeMode && !guiAcceptanceMode
    ? createKosworkBrowser({
        BrowserWindow,
        WebContentsView,
        Menu,
        ipcMain,
        dialog,
        globalShortcut,
        taskGate,
        executionMode: "work",
        history: workCycleHistory,
        workspace: workCycleWorkspace,
        profiles: managedBrowserProfiles,
        createComputer: () =>
          require("./computer-driver.cjs").createComputerDriver({ desktopCapturer, screen, shell }),
        identity: async () => {
          const owner = await verifiedOwner();
          return owner && currentOrigin ? { owner, origin: currentOrigin } : null;
        },
        getSession: () => session.fromPartition(SESSION_PARTITION, { cache: true })
      })
    : null;
const computerConsole =
  gotSingleInstanceLock && !smokeMode && !guiAcceptanceMode
    ? createComputerConsole({
        BrowserWindow,
        ipcMain,
        dialog,
        desktopCapturer,
        screen,
        shell,
        globalShortcut,
        history: computerHistory,
        workspace: computerWorkspace,
        taskGate,
        openBrowser: () => kosworkBrowser?.show(),
        identity: async () => {
          const owner = await verifiedOwner();
          return owner && currentOrigin ? { owner, origin: currentOrigin } : null;
        },
        getSession: () => session.fromPartition(SESSION_PARTITION, { cache: true })
      })
    : null;
app.on("before-quit", () => {
  computerConsole?.stop();
  kosworkBrowser?.stop();
  kosworkWorkCycle?.stop();
});

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
  if (
    restoringInitialPage ||
    loginRouteInProgress ||
    !currentOrigin ||
    !isAllowedRemoteNavigation(url, currentOrigin)
  )
    return;
  try {
    const parsed = new URL(url);
    const route = safeWorkspaceRoute(parsed.pathname + parsed.search);
    if (route === "/" && deferredRoute && deferredRoute !== "/") return;
    if (route && !parsed.hash && route !== preferences.get().lastPath) {
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
  const safe = safeWorkspaceRoute(route);
  if (!safe || !currentOrigin || !mainWindow || mainWindow.isDestroyed()) return false;
  if (
    mainWindow.webContents.getURL() === localConnectionUrl() ||
    isLoginOrLogout(mainWindow.webContents.getURL(), currentOrigin)
  ) {
    deferredRoute = safe;
    return false;
  }
  if (!(await verifiedOwner())) {
    deferredRoute = safe;
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
    if (persist && previousOrigin && previousOrigin !== origin) {
      // Switching origins is an explicit trust-boundary change, not a page navigation.
      identityEpoch++;
      computerConsole?.invalidate();
      kosworkWorkCycle?.invalidate();
      kosworkBrowser?.invalidate();
      draftSessionGate.reset();
      vaultConsole?.invalidate();
      downloadCenter.invalidate({ forget: true, origin: previousOrigin, owner: ownerCache?.owner });
      ownerCache = null;
      deferredRoute = null;
      pendingDeepLink = null;
      for (const item of activeDownloads.values()) item.cancel();
      try {
        textDrafts.clearAll();
        workCycleHistory.clearAll();
        computerHistory.clearAll();
        computerWorkspace.forget();
        await kosworkWorkCycle?.forget();
        await kosworkBrowser?.forget();
        await browserSession.clearStorageData();
        await browserSession.clearCache();
      } catch {
        await showConnection(
          "Смена сервера отменена: невозможно очистить локальные данные предыдущего сервера."
        );
        return { ok: false, message: "Не удалось очистить локальные данные при смене сервера." };
      }
      if (!connectionAttemptGate.isCurrent(generation)) return { ok: false, stale: true };
    }
    const requestedRoute =
      previousOrigin && previousOrigin !== origin
        ? "/"
        : pendingDeepLink ||
          deferredRoute ||
          (preferences.get().restorePage ? preferences.get().lastPath : "/");
    if (requestedRoute !== "/") deferredRoute = requestedRoute;
    currentOrigin = origin;
    restoringInitialPage = true;
    try {
      await mainWindow.loadURL(origin);
      if (!connectionAttemptGate.isCurrent(generation)) {
        return { ok: false, stale: true, message: "Эта попытка подключения уже заменена новой." };
      }
      if (persist) {
        saveOrigin(origin);
        if (previousOrigin !== origin) {
          preferences.update({ lastPath: "/" });
          deferredRoute = null;
          ownerCache = null;
        }
      }
      connectionMessage = "";
      pendingDeepLink = null;
      if (requestedRoute !== "/") {
        deferredRoute = requestedRoute;
        restoringInitialPage = false;
        void restoreAfterAuthentication();
      }
      return { ok: true };
    } catch {
      if (connectionAttemptGate.isCurrent(generation)) {
        currentOrigin = previousOrigin;
        if (requestedRoute !== "/") deferredRoute = requestedRoute;
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

async function verifiedOwner({ allowCachedWrite = false } = {}) {
  const origin = currentOrigin;
  const epoch = identityEpoch;
  if (!origin) return null;
  const browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
  const result = await fetchElectronOwner(browserSession, origin);
  if (origin !== currentOrigin || epoch !== identityEpoch) return null;
  if (result.state === "verified") {
    if (ownerCache?.origin === origin && ownerCache.owner !== result.owner) {
      identityEpoch++;
      computerConsole?.invalidate();
      kosworkWorkCycle?.invalidate();
      kosworkBrowser?.invalidate();
      draftSessionGate.reset();
      vaultConsole?.invalidate();
      downloadCenter.invalidate();
      for (const item of activeDownloads.values()) item.cancel();
    }
    ownerCache = {
      owner: result.owner,
      origin,
      expires: Math.min(Date.now() + 12 * 3600_000, result.expiresAt)
    };
    return result.owner;
  }
  if (result.state === "denied") {
    if (ownerCache?.origin === origin) {
      identityEpoch++;
      computerConsole?.invalidate();
      kosworkWorkCycle?.invalidate();
      kosworkBrowser?.invalidate();
      draftSessionGate.reset();
      vaultConsole?.invalidate();
      downloadCenter.invalidate();
      for (const item of activeDownloads.values()) item.cancel();
    }
    ownerCache = null; // A real 401/403/redirect/new identity is never an offline signal.
    return null;
  }
  // Offline edits remain bound to the last server-confirmed owner IN THIS PROCESS.
  // A new app process/relogin must prove identity again before loading any draft.
  return allowCachedWrite && ownerCache?.origin === origin && ownerCache.expires > Date.now()
    ? ownerCache.owner
    : null;
}

async function restoreAfterAuthentication() {
  if (
    restoringInitialPage ||
    loginRouteInProgress ||
    !deferredRoute ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !currentOrigin
  )
    return;
  if (isLoginOrLogout(mainWindow.webContents.getURL(), currentOrigin)) return;
  loginRouteInProgress = true;
  const route = deferredRoute;
  try {
    if (!(await verifiedOwner())) return; // never reveal private routes before server-side authorization
    if (!route || deferredRoute !== route) return;
    if (mainWindow.webContents.getURL() !== currentOrigin + route) {
      if (!(await openRoute(route))) return;
    }
    if (deferredRoute === route) {
      deferredRoute = null;
      if (preferences.get().lastPath !== route) preferences.update({ lastPath: route });
    }
  } catch {
    /* An explicit retry or later login navigation can resume. */
  } finally {
    loginRouteInProgress = false;
  }
}

function isTrustedRemoteEvent(event) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event?.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame &&
    isAllowedRemoteNavigation(event.senderFrame.url, currentOrigin) &&
    !isLoginOrLogout(event.senderFrame.url, currentOrigin)
  );
}

async function nativeLogout() {
  const choice = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Выйти из Kosmora",
    message:
      "Выйти из аккаунта и удалить локальные текстовые черновики, историю задач ПК и локальные резервные копии Koswork?",
    detail:
      "Серверные чаты и файлы не удаляются. Выбранная папка локального хранилища и её копии сохранятся. Сеанс приложения и входы на сайты в браузере Koswork на этом компьютере будут завершены.",
    buttons: ["Выйти и очистить", "Отмена"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (choice.response !== 0) return;
  // Fence pending asynchronous saves before removing user data.
  identityEpoch++;
  computerConsole?.invalidate();
  kosworkWorkCycle?.invalidate();
  kosworkBrowser?.invalidate();
  draftSessionGate.reset();
  vaultConsole?.invalidate();
  downloadCenter.invalidate({ forget: true, origin: currentOrigin, owner: ownerCache?.owner });
  ownerCache = null;
  // The user explicitly authorized clearing drafts and locally remembered login.
  try {
    textDrafts.clearAll();
    workCycleHistory.clearAll();
    computerHistory.clearAll();
    computerWorkspace.forget();
    await kosworkWorkCycle?.forget();
    await kosworkBrowser?.forget();
  } catch {
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Не удалось очистить черновики",
      message: "Проверьте права доступа к профилю Windows и повторите выход."
    });
    return;
  }
  ownerCache = null;
  deferredRoute = null;
  pendingDeepLink = null;
  for (const item of activeDownloads.values()) item.cancel();
  preferences.update({ lastPath: "/" });
  const browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
  try {
    await browserSession.clearStorageData();
    await browserSession.clearCache();
    if (currentOrigin && mainWindow && !mainWindow.isDestroyed())
      await mainWindow.loadURL(currentOrigin + "/login");
  } catch {
    await showConnection(
      "Не удалось полностью завершить браузерный сеанс. Проверьте подключение и повторите выход."
    );
  }
}

function startConnectivityMonitor() {
  clearInterval(connectivityTimer);
  connectivityTimer = setInterval(async () => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      !currentOrigin ||
      mainWindow.webContents.getURL() === localConnectionUrl() ||
      connectionAttemptGate.isInFlight() ||
      connectivityProbeInFlight
    )
      return;
    connectivityProbeInFlight = true;
    const origin = currentOrigin;
    const epoch = identityEpoch;
    let probe;
    try {
      probe = await probeServer(session.fromPartition(SESSION_PARTITION, { cache: true }), origin);
    } finally {
      connectivityProbeInFlight = false;
    }
    if (
      !probe.ok &&
      origin === currentOrigin &&
      epoch === identityEpoch &&
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      if (isAllowedRemoteNavigation(mainWindow.webContents.getURL(), currentOrigin)) {
        deferredRoute =
          safeWorkspaceRoute(
            new URL(mainWindow.webContents.getURL()).pathname +
              new URL(mainWindow.webContents.getURL()).search
          ) || preferences.get().lastPath;
        void showConnection(
          "Соединение потеряно. Черновики остаются локально; отправка сообщений автоматически не повторится."
        );
      }
    }
  }, 30000);
  connectivityTimer.unref?.();
}

function clearDraftsForHostedLogout(url) {
  if (!isExplicitLogout(url, currentOrigin)) return true;
  // A first-party /logout navigation is an explicit exit, including when
  // a hosted page handles it without using the native menu.
  identityEpoch++;
  computerConsole?.invalidate();
  kosworkWorkCycle?.invalidate();
  kosworkBrowser?.invalidate();
  draftSessionGate.reset();
  vaultConsole?.invalidate();
  downloadCenter.invalidate({ forget: true, origin: currentOrigin, owner: ownerCache?.owner });
  ownerCache = null;
  deferredRoute = null;
  pendingDeepLink = null;
  try {
    textDrafts.clearAll();
    workCycleHistory.clearAll();
    computerHistory.clearAll();
    computerWorkspace.forget();
    void kosworkWorkCycle?.forget().catch(() => {});
    void kosworkBrowser?.forget().catch(() => {});
    preferences.update({ lastPath: "/" });
    return true;
  } catch {
    void dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Очистка черновиков не удалась",
      message:
        "Не удалось удалить локальные черновики или историю задач ПК при выходе. Проверьте доступ к профилю Windows."
    });
    return false;
  }
}

function installNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedRemoteNavigation(url, currentOrigin)) {
      void window.loadURL(url);
    } else if (
      isSafeExternalUrl(url) &&
      (url.startsWith("https://") || url.startsWith("mailto:"))
    ) {
      void dialog
        .showMessageBox(window, {
          type: "question",
          title: "Внешняя ссылка",
          message: "Открыть внешний сайт вне Kosmora?",
          detail: url.slice(0, 320),
          buttons: ["Открыть", "Отмена"],
          defaultId: 1,
          cancelId: 1
        })
        .then((decision) => {
          if (decision.response === 0) void shell.openExternal(url);
        });
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isExplicitLogout(url, currentOrigin) && !clearDraftsForHostedLogout(url)) {
      event.preventDefault();
      return;
    }
    if (url === localConnectionUrl() || isAllowedRemoteNavigation(url, currentOrigin)) return;
    event.preventDefault();
    // Foreign origins and file:/data:/custom protocols never navigate the Electron window.
  });

  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("did-navigate", (_event, url) => {
    draftSessionGate.reset(); // Full document navigation, not SPA history changes.
    persistRoute(url);
    if (isLoginOrLogout(url, currentOrigin)) {
      vaultConsole?.invalidate();
      downloadCenter.invalidate();
      ownerCache = null;
      identityEpoch++;
      computerConsole?.invalidate();
      kosworkWorkCycle?.invalidate();
      kosworkBrowser?.invalidate();
      draftSessionGate.reset();
    } else void restoreAfterAuthentication();
  });
  window.webContents.on("did-navigate-in-page", (_event, url) => {
    // SPA history transitions can bypass will-navigate.
    if (isExplicitLogout(url, currentOrigin)) void clearDraftsForHostedLogout(url);
    persistRoute(url);
    if (isLoginOrLogout(url, currentOrigin)) {
      vaultConsole?.invalidate();
      downloadCenter.invalidate();
      ownerCache = null;
      identityEpoch++;
      computerConsole?.invalidate();
      kosworkWorkCycle?.invalidate();
      kosworkBrowser?.invalidate();
      draftSessionGate.reset();
    } else void restoreAfterAuthentication();
  });
  window.webContents.on("render-process-gone", () => {
    deferredRoute = preferences.get().lastPath;
    void showConnection(
      "Окно Kosmora завершилось аварийно. Перезапустите соединение; сообщение не будет отправлено автоматически."
    );
  });

  window.webContents.on("will-redirect", (event, url) => {
    if (isAllowedRemoteNavigation(url, currentOrigin)) return;
    event.preventDefault();
    // Foreign origins and file:/data:/custom protocols never navigate the Electron window.
  });

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, _description, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || !currentOrigin) return;
      if (isAllowedRemoteNavigation(validatedURL, currentOrigin)) {
        try {
          const parsed = new URL(validatedURL);
          deferredRoute =
            safeWorkspaceRoute(parsed.pathname + parsed.search) ||
            deferredRoute ||
            (preferences.get().restorePage ? preferences.get().lastPath : "/");
        } catch {
          /* keep the last verified route */
        }
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
    let directory = prefs.downloadDirectory || app.getPath("downloads");
    try {
      if (!fs.statSync(directory).isDirectory()) throw new Error("Не каталог");
      fs.accessSync(directory, fs.constants.W_OK);
    } catch {
      item.cancel();
      void dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Ошибка скачивания",
        message: "Папка назначения не существует или недоступна для записи.",
        detail: "Выберите доступную папку в меню «Файлы» и повторите скачивание вручную."
      });
      return;
    }
    try {
      const target = nextAvailableDownloadPath(directory, item.getFilename(), fs.existsSync);
      if (prefs.askWhereToSave)
        item.setSaveDialogOptions({ title: "Сохранить файл Kosmora", defaultPath: target });
      else item.setSavePath(target);
      const downloadId = randomUUID();
      activeDownloads.set(downloadId, item);
      downloadCenter.capture(downloadId, item);
      createMenu();
      item.once("done", (_event, state) => {
        activeDownloads.delete(downloadId);
        createMenu();
        if (state === "interrupted" && !guiAcceptanceMode)
          void dialog.showMessageBox(mainWindow, {
            type: "warning",
            title: "Ошибка скачивания",
            message: "Не удалось сохранить файл.",
            detail:
              "Проверьте место на диске и права доступа к каталогу. Повторная загрузка не запускается автоматически."
          });
      });
    } catch {
      item.cancel();
      void dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Ошибка скачивания",
        message: "Невозможно назначить путь сохранения. Выберите другую папку."
      });
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
        { label: "Выйти и удалить локальные данные…", click: () => void nativeLogout() },
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
      label: "Koswork",
      submenu: [
        {
          label: "Локальное хранилище…",
          enabled: !!vaultConsole,
          click: () =>
            void vaultConsole?.show().catch(() =>
              dialog.showMessageBox(mainWindow, {
                type: "info",
                message: "Для хранилища нужен подтверждённый вход в Kosmora."
              })
            )
        },
        {
          label: "Рабочая задача…",
          enabled: !!kosworkWorkCycle,
          click: () => {
            void kosworkWorkCycle?.show().catch(() =>
              dialog.showMessageBox(mainWindow, {
                type: "info",
                message: "Для задачи Koswork нужен подтверждённый вход в приложение."
              })
            );
          }
        },
        { label: "Остановить задачу", click: () => kosworkWorkCycle?.stop() },
        {
          label: "Управление компьютером…",
          enabled: !!computerConsole,
          click: () => void computerConsole?.show()
        },
        {
          label: "Браузер Koswork…",
          enabled: !!kosworkBrowser,
          click: () => {
            void kosworkBrowser?.show().catch(() =>
              dialog.showMessageBox(mainWindow, {
                type: "info",
                message: "Для браузера Koswork нужен подтверждённый вход в приложение."
              })
            );
          }
        },
        { label: "Остановить браузер", click: () => kosworkBrowser?.stop() },
        {
          label: "Остановить управление",
          click: () => {
            kosworkWorkCycle?.stop();
            computerConsole?.stop();
          }
        }
      ]
    },
    {
      label: "Файлы",
      submenu: [
        {
          label: "Центр загрузок…",
          accelerator: "Ctrl+J",
          click: () => void downloadCenter.show()
        },
        { type: "separator" },
        {
          label: "Отменить текущие скачивания",
          enabled: activeDownloads.size > 0,
          click: () => {
            for (const item of activeDownloads.values()) item.cancel();
            activeDownloads.clear();
            createMenu();
          }
        },
        { type: "separator" },
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
          enabled: Boolean(updateTrust.publicKeyPem),
          click: () => void checkUpdates({ interactive: true })
        },
        {
          label: "Показать предыдущий проверенный установщик…",
          enabled: Boolean(updateTrust.publicKeyPem),
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

const draftQueues = new Map();
function queueDraft(scope, task) {
  if (typeof scope !== "string" || scope.length > 100) return Promise.resolve({ ok: false });
  const previous = draftQueues.get(scope) || Promise.resolve();
  const result = previous.catch(() => undefined).then(task);
  draftQueues.set(scope, result);
  void result.then(
    () => {
      if (draftQueues.get(scope) === result) draftQueues.delete(scope);
    },
    () => {
      if (draftQueues.get(scope) === result) draftQueues.delete(scope);
    }
  );
  return result;
}

ipcMain.handle("kosmora:vault-open", async (event) => {
  if (!isTrustedRemoteEvent(event) || !vaultConsole) return { ok: false };
  try {
    await vaultConsole.show();
    return { ok: true };
  } catch {
    return { ok: false };
  }
});
ipcMain.handle("kosmora:vault-read-context", async (event) => {
  if (!isTrustedRemoteEvent(event)) return null;
  const data = await vaultConsole?.readContext();
  return isTrustedRemoteEvent(event) ? data : null;
});
ipcMain.handle("kosmora:vault-ack-context", async (event, id) => {
  if (isTrustedRemoteEvent(event) && typeof id === "string" && id.length <= 64)
    await vaultConsole?.ackContext(id);
});
ipcMain.handle("koswork:computer-open", async (event, input) => {
  if (
    !computerConsole ||
    !isTrustedRemoteEvent(event) ||
    !input ||
    typeof input.project !== "string" ||
    !/^[a-zA-Z0-9_-]{1,160}$/.test(input.project) ||
    typeof input.goal !== "string" ||
    !input.goal.trim() ||
    input.goal.length > 8000 ||
    Object.keys(input).length !== 2
  )
    return { ok: false };
  const epoch = identityEpoch;
  const owner = await verifiedOwner();
  if (!owner || epoch !== identityEpoch || !isTrustedRemoteEvent(event)) return { ok: false };
  await computerConsole.show(input);
  return { ok: true };
});

ipcMain.handle("koswork:work-open", async (event, input) => {
  if (
    !kosworkWorkCycle ||
    !isTrustedRemoteEvent(event) ||
    !input ||
    typeof input.project !== "string" ||
    !/^[a-zA-Z0-9_-]{1,160}$/.test(input.project) ||
    typeof input.goal !== "string" ||
    !input.goal.trim() ||
    input.goal.length > 8000 ||
    Object.keys(input).length !== 2
  )
    return { ok: false };
  const epoch = identityEpoch,
    owner = await verifiedOwner();
  if (!owner || epoch !== identityEpoch || !isTrustedRemoteEvent(event)) return { ok: false };
  await kosworkWorkCycle.show(input);
  return { ok: true };
});

ipcMain.handle("cosmora:draft-load", async (event, scope) => {
  if (!isTrustedRemoteEvent(event)) return { ok: false, message: "Недоверенный источник." };
  const origin = currentOrigin;
  const version = draftSessionGate.documentVersion();
  const owner = await verifiedOwner();
  if (!owner || origin !== currentOrigin || !isTrustedRemoteEvent(event))
    return { ok: false, message: "Для восстановления черновика требуется подтверждённый вход." };
  // Validate before binding an untrusted IPC scope.
  try {
    const text = textDrafts.load(owner, origin, scope);
    if (!draftSessionGate.bindLoad(version, origin, owner, scope))
      return { ok: false, message: "Аккаунт или страница изменились. Обновите окно после входа." };
    return { ok: true, text };
  } catch {
    return { ok: false, message: "Не удалось прочитать черновик." };
  }
});
ipcMain.handle("cosmora:draft-save", (event, scope, text) => {
  if (!isTrustedRemoteEvent(event) || typeof text !== "string" || text.length > 128000)
    return { ok: false, message: "Недопустимый запрос сохранения." };
  const origin = currentOrigin;
  const epoch = identityEpoch;
  const version = draftSessionGate.documentVersion();
  return queueDraft(scope, async () => {
    if (origin !== currentOrigin || epoch !== identityEpoch)
      return { ok: false, message: "Сеанс изменился." };
    const owner = await verifiedOwner({ allowCachedWrite: true });
    if (
      !owner ||
      origin !== currentOrigin ||
      epoch !== identityEpoch ||
      !draftSessionGate.allowWrite(version, origin, owner, scope)
    )
      return { ok: false, message: "Аккаунт или страница изменились. Черновик не перенесён." };
    try {
      return textDrafts.save(owner, origin, scope, text);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Невозможно сохранить черновик."
      };
    }
  });
});
// Best effort on pagehide/navigation: enqueue, never block window closing.
ipcMain.on("cosmora:draft-flush", (event, scope, text) => {
  if (!isTrustedRemoteEvent(event) || typeof text !== "string" || text.length > 128000) return;
  // pagehide IPC is dispatched before the old document is destroyed. A
  // network identity roundtrip here would routinely lose the last keystrokes
  // after did-navigate resets the document gate. Reuse ONLY the previously
  // server-confirmed, unexpired in-process owner and the loaded scope; write
  // the encrypted bounded text synchronously. No network/POST/retry occurs.
  const origin = currentOrigin;
  const owner = draftSessionGate.ownerForFlush(draftSessionGate.documentVersion(), origin, scope);
  if (
    !owner ||
    ownerCache?.owner !== owner ||
    ownerCache.origin !== origin ||
    ownerCache.expires <= Date.now()
  )
    return;
  try {
    textDrafts.save(owner, origin, scope, text);
  } catch {
    /* no plaintext fallback or hidden retry */
  }
});
ipcMain.handle("cosmora:draft-clear", (event, scope) => {
  if (!isTrustedRemoteEvent(event)) return { ok: false };
  const origin = currentOrigin;
  const epoch = identityEpoch;
  const version = draftSessionGate.documentVersion();
  return queueDraft(scope, async () => {
    if (origin !== currentOrigin || epoch !== identityEpoch) return { ok: false };
    const owner = await verifiedOwner();
    if (
      !owner ||
      origin !== currentOrigin ||
      epoch !== identityEpoch ||
      !draftSessionGate.allowWrite(version, origin, owner, scope)
    )
      return { ok: false };
    try {
      textDrafts.clearScope(owner, origin, scope);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
});

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
    startConnectivityMonitor();
    if (preferences.get().checkUpdatesOnStart && currentOrigin && !guiAcceptanceMode)
      void checkUpdates();
    if (guiAcceptanceMode) {
      try {
        await runPackagedGuiAcceptance({
          app,
          getMainWindow: () => mainWindow,
          getDownloadWindow: () =>
            BrowserWindow.getAllWindows().find(
              (window) =>
                window.webContents.getURL() ===
                pathToFileURL(path.join(__dirname, "downloads.html")).toString()
            ),
          preferences,
          downloadCenter,
          readSavedOrigin
        });
      } catch (cause) {
        console.error(cause instanceof Error ? cause.stack || cause.message : cause);
        app.exit(1);
      }
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });

  app.on("before-quit", () => {
    clearInterval(connectivityTimer);
    isQuitting = true;
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !isQuitting) app.quit();
  });
}
