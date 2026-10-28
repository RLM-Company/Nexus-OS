"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createDownloadHistoryStore } = require("./download-history.cjs");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLOCKED_OPEN_EXTENSIONS = new Set([
  ".exe",
  ".msi",
  ".msp",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".scr",
  ".com",
  ".pif",
  ".dll",
  ".sys",
  ".reg",
  ".hta",
  ".cpl",
  ".jar",
  ".lnk",
  ".scf",
  ".url",
  ".iso",
  ".img",
  ".vhd",
  ".vhdx"
]);

function localDownloadsUrl() {
  return pathToFileURL(path.join(__dirname, "downloads.html")).toString();
}

function downloadScope(origin, ownerId) {
  return crypto
    .createHash("sha256")
    .update(`${origin}\0${ownerId}`)
    .digest("hex");
}

function isDangerousDownloadTarget(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return true;
  const ext = path.extname(filePath.trim()).toLowerCase();
  return BLOCKED_OPEN_EXTENSIONS.has(ext);
}

function createDownloadCenter({
  profileDirectory,
  getOrigin,
  getIdentityEpoch,
  verifiedOwner,
  activeDownloads,
  getDownloadDirectory,
  getParentWindow = () => null,
  shell,
  BrowserWindow = null,
  ipcMain = null,
  onStateChanged = () => {}
}) {
  const history = createDownloadHistoryStore(profileDirectory);
  const activeScopes = new Map();
  let panelWindow = null;

  function isTrustedPanelEvent(event) {
    if (!event?.senderFrame || event.senderFrame.url !== localDownloadsUrl()) return false;
    if (panelWindow && !panelWindow.isDestroyed()) {
      return (
        event.sender === panelWindow.webContents &&
        event.senderFrame === panelWindow.webContents.mainFrame
      );
    }
    return true;
  }

  function notifyPanel() {
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.webContents.send("cosmora:downloads-changed");
    }
    onStateChanged();
  }

  async function resolveActiveScope({ allowCachedWrite = false } = {}) {
    const origin = getOrigin();
    const epoch = getIdentityEpoch();
    if (!origin) return null;
    const owner = await verifiedOwner({ allowCachedWrite });
    if (!owner || origin !== getOrigin() || epoch !== getIdentityEpoch()) return null;
    return { origin, owner, epoch, scope: downloadScope(origin, owner) };
  }

  function capture(id, item) {
    if (typeof id !== "string" || !UUID.test(id) || !item) return;
    const normalizedId = id.toLowerCase();
    const origin = getOrigin();
    const epoch = getIdentityEpoch();
    if (!origin) {
      try {
        item.cancel();
      } catch {
        /* ignore */
      }
      activeDownloads.delete(id);
      return;
    }

    let scope = null;
    let started = false;
    let finished = null;

    const safeCancel = () => {
      try {
        item.cancel();
      } catch {
        /* ignore */
      }
      activeDownloads.delete(id);
      activeScopes.delete(normalizedId);
      notifyPanel();
    };

    const finish = ({ state, receivedBytes, totalBytes, savePath }) => {
      activeDownloads.delete(id);
      activeScopes.delete(normalizedId);
      if (!started || !scope) return;
      history.finish(
        scope,
        normalizedId,
        state,
        receivedBytes,
        totalBytes,
        state === "completed" ? savePath : null
      );
      notifyPanel();
    };

    const onUpdated = () => {
      if (origin !== getOrigin() || epoch !== getIdentityEpoch()) {
        safeCancel();
        return;
      }
      if (!started || !scope) return;
      if (history.progress(scope, normalizedId, item.getReceivedBytes(), item.getTotalBytes())) {
        notifyPanel();
      }
    };

    item.on("updated", onUpdated);
    item.once("done", (_event, state) => {
      item.removeListener?.("updated", onUpdated);
      const snapshot = {
        state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        savePath: typeof item.getSavePath === "function" ? item.getSavePath() : null
      };
      if (!started) {
        finished = snapshot;
        activeDownloads.delete(id);
        notifyPanel();
        return;
      }
      finish(snapshot);
    });

    void Promise.resolve(verifiedOwner({ allowCachedWrite: true }))
      .then((owner) => {
        if (!owner || origin !== getOrigin() || epoch !== getIdentityEpoch()) {
          safeCancel();
          return;
        }
        scope = downloadScope(origin, owner);
        const initialReceived = finished ? finished.receivedBytes : item.getReceivedBytes();
        const initialTotal = finished ? finished.totalBytes : item.getTotalBytes();
        if (!history.start(scope, normalizedId, item.getFilename(), initialReceived, initialTotal)) {
          safeCancel();
          return;
        }
        started = true;
        activeScopes.set(normalizedId, scope);
        if (finished) {
          finish(finished);
        } else {
          notifyPanel();
        }
      })
      .catch(() => {
        safeCancel();
      });
  }

  async function list(event) {
    if (!isTrustedPanelEvent(event)) throw new Error("Untrusted downloads IPC caller.");
    const context = await resolveActiveScope();
    if (!context) {
      return {
        ok: false,
        items: [],
        message: "Войдите в аккаунт Kosmora, чтобы просматривать загрузки."
      };
    }
    return {
      ok: true,
      items: history.list(context.scope)
    };
  }

  async function openItem(event, id) {
    if (!isTrustedPanelEvent(event)) throw new Error("Untrusted downloads IPC caller.");
    if (typeof id !== "string" || !UUID.test(id))
      return { ok: false, message: "Некорректный идентификатор загрузки." };
    const context = await resolveActiveScope();
    if (!context) return { ok: false, message: "Сеанс не подтверждён." };
    const target = history.resolvePath(context.scope, id);
    if (!target) return { ok: false, message: "Файл недоступен для текущего аккаунта." };
    if (isDangerousDownloadTarget(target)) {
      return {
        ok: false,
        message:
          "Запуск исполняемых и системных файлов из Центра загрузок заблокирован. Используйте «Показать в папке»."
      };
    }
    try {
      if (!fs.statSync(target).isFile()) throw new Error("Missing file");
    } catch {
      return { ok: false, message: "Файл был перемещён или удалён с диска." };
    }
    const err = await shell.openPath(target);
    if (err) return { ok: false, message: "Не удалось открыть файл в системе." };
    return { ok: true };
  }

  async function revealItem(event, id) {
    if (!isTrustedPanelEvent(event)) throw new Error("Untrusted downloads IPC caller.");
    if (typeof id !== "string" || !UUID.test(id))
      return { ok: false, message: "Некорректный идентификатор загрузки." };
    const context = await resolveActiveScope();
    if (!context) return { ok: false, message: "Сеанс не подтверждён." };
    const target = history.resolvePath(context.scope, id);
    if (!target) return { ok: false, message: "Файл недоступен для текущего аккаунта." };
    try {
      if (!fs.statSync(target).isFile()) throw new Error("Missing file");
    } catch {
      return { ok: false, message: "Файл был перемещён или удалён с диска." };
    }
    shell.showItemInFolder(target);
    return { ok: true };
  }

  async function cancelItem(event, id) {
    if (!isTrustedPanelEvent(event)) throw new Error("Untrusted downloads IPC caller.");
    if (typeof id !== "string" || !UUID.test(id))
      return { ok: false, message: "Некорректный идентификатор загрузки." };
    const normalizedId = id.toLowerCase();
    const context = await resolveActiveScope({ allowCachedWrite: true });
    if (!context || activeScopes.get(normalizedId) !== context.scope)
      return { ok: false, message: "Активная загрузка не найдена." };
    const active = activeDownloads.get(id) || activeDownloads.get(normalizedId);
    if (!active) return { ok: false, message: "Загрузка уже завершена." };
    try {
      active.cancel();
    } catch {
      return { ok: false, message: "Не удалось отменить скачивание." };
    }
    notifyPanel();
    return { ok: true };
  }

  async function removeItem(event, id) {
    if (!isTrustedPanelEvent(event)) throw new Error("Untrusted downloads IPC caller.");
    if (typeof id !== "string" || !UUID.test(id))
      return { ok: false, message: "Некорректный идентификатор загрузки." };
    const context = await resolveActiveScope();
    if (!context) return { ok: false, message: "Сеанс не подтверждён." };
    if (!history.remove(context.scope, id))
      return { ok: false, message: "Запись загрузки не найдена." };
    notifyPanel();
    return { ok: true };
  }

  async function clearCompleted(event) {
    if (!isTrustedPanelEvent(event)) throw new Error("Untrusted downloads IPC caller.");
    const context = await resolveActiveScope();
    if (!context) return { ok: false, message: "Сеанс не подтверждён." };
    history.clearCompleted(context.scope);
    notifyPanel();
    return { ok: true };
  }

  async function openFolder(event) {
    if (!isTrustedPanelEvent(event)) throw new Error("Untrusted downloads IPC caller.");
    const folder = getDownloadDirectory();
    const err = await shell.openPath(folder);
    if (err) return { ok: false, message: "Не удалось открыть папку загрузок." };
    return { ok: true };
  }

  function invalidate({ forget = false, origin = null, owner = null } = {}) {
    if (forget) {
      if (origin && owner) {
        history.clearScope(downloadScope(origin, owner));
      } else {
        history.clearAll();
      }
    }
    notifyPanel();
  }

  async function show() {
    if (!BrowserWindow) return null;
    if (panelWindow && !panelWindow.isDestroyed()) {
      if (panelWindow.isMinimized()) panelWindow.restore();
      panelWindow.show();
      panelWindow.focus();
      notifyPanel();
      return panelWindow;
    }
    const parent = getParentWindow();
    panelWindow = new BrowserWindow({
      width: 760,
      height: 540,
      minWidth: 560,
      minHeight: 380,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      backgroundColor: "#f6f6f6",
      show: false,
      title: "Загрузки Kosmora",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "downloads-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        navigateOnDragDrop: false
      }
    });
    panelWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    panelWindow.webContents.on("will-navigate", (event, url) => {
      if (url !== localDownloadsUrl()) event.preventDefault();
    });
    panelWindow.once("ready-to-show", () => {
      if (panelWindow && !panelWindow.isDestroyed()) panelWindow.show();
    });
    panelWindow.on("closed", () => {
      panelWindow = null;
    });
    await panelWindow.loadURL(localDownloadsUrl());
    return panelWindow;
  }

  function close() {
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.close();
      panelWindow = null;
    }
  }

  if (ipcMain) {
    ipcMain.handle("cosmora:downloads-list", (event) => list(event));
    ipcMain.handle("cosmora:downloads-open", (event, id) => openItem(event, id));
    ipcMain.handle("cosmora:downloads-reveal", (event, id) => revealItem(event, id));
    ipcMain.handle("cosmora:downloads-cancel", (event, id) => cancelItem(event, id));
    ipcMain.handle("cosmora:downloads-remove", (event, id) => removeItem(event, id));
    ipcMain.handle("cosmora:downloads-clear-completed", (event) => clearCompleted(event));
    ipcMain.handle("cosmora:downloads-open-folder", (event) => openFolder(event));
  }

  return {
    capture,
    list,
    openItem,
    revealItem,
    cancelItem,
    removeItem,
    clearCompleted,
    openFolder,
    invalidate,
    show,
    close
  };
}

module.exports = {
  createDownloadCenter,
  downloadScope,
  isDangerousDownloadTarget,
  localDownloadsUrl
};
