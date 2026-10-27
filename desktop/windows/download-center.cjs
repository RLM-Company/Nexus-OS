"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createDownloadHistoryStore, downloadScope } = require("./download-history.cjs");

/** Only this trusted Electron main process owns DownloadItems, file paths and shell access. */
function createDownloadCenter({
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  profileDirectory,
  getOrigin,
  getIdentityEpoch,
  verifiedOwner,
  getMainWindow,
  activeDownloads,
  onChange
}) {
  const history = createDownloadHistoryStore(profileDirectory);
  const pageURL = pathToFileURL(path.join(__dirname, "downloads.html")).toString();
  const live = new Map();
  let window = null;
  let windowScope = null;
  let windowOrigin = null;
  let windowEpoch = null;
  let windowOwner = null;

  function emit(refreshMenu = true) {
    if (refreshMenu) onChange();
    if (
      window &&
      !window.isDestroyed() &&
      windowScope &&
      windowOrigin === getOrigin() &&
      windowEpoch === getIdentityEpoch()
    ) {
      window.webContents.send("cosmora:downloads:changed", history.list(windowScope));
    }
  }
  function trusted(event) {
    return Boolean(
      window &&
      !window.isDestroyed() &&
      event?.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame.url === pageURL &&
      window.webContents.getURL() === pageURL
    );
  }
  async function authorize(event) {
    if (
      !trusted(event) ||
      !windowScope ||
      windowOrigin !== getOrigin() ||
      windowEpoch !== getIdentityEpoch()
    )
      return null;
    const epoch = windowEpoch;
    const origin = windowOrigin;
    const owner = await verifiedOwner({ allowCachedWrite: true });
    if (
      !trusted(event) ||
      epoch !== getIdentityEpoch() ||
      origin !== getOrigin() ||
      owner !== windowOwner ||
      downloadScope(origin, owner || "invalid") !== windowScope
    )
      return null;
    return windowScope;
  }
  async function show() {
    const origin = getOrigin();
    const epoch = getIdentityEpoch();
    const owner = origin && (await verifiedOwner({ allowCachedWrite: true }));
    if (!owner || epoch !== getIdentityEpoch() || origin !== getOrigin()) {
      await dialog.showMessageBox(getMainWindow(), {
        type: "info",
        title: "Центр загрузок",
        message: "Для доступа к истории загрузок требуется подтверждённый сеанс Kosmora.",
        detail:
          "Подключитесь и войдите в аккаунт. При перезапуске офлайн история не открывается без проверки владельца."
      });
      return false;
    }
    const scope = downloadScope(origin, owner);
    if (window && !window.isDestroyed()) {
      if (windowScope === scope && windowOrigin === origin && windowEpoch === epoch) {
        window.show();
        window.focus();
        return true;
      }
      window.destroy();
    }
    windowOrigin = origin;
    windowEpoch = epoch;
    windowScope = scope;
    windowOwner = owner;
    const nextWindow = new BrowserWindow({
      parent: getMainWindow() || undefined,
      width: 690,
      height: 565,
      minWidth: 500,
      minHeight: 360,
      show: false,
      backgroundColor: "#ffffff",
      title: "Kosmora — Загрузки",
      webPreferences: {
        preload: path.join(__dirname, "downloads-preload.cjs"),
        partition: "kosmora-download-center",
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    });
    window = nextWindow;
    nextWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    nextWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    nextWindow.webContents.on("will-redirect", (event) => event.preventDefault());
    nextWindow.webContents.on("did-finish-load", () => {
      if (window === nextWindow)
        nextWindow.webContents.send("cosmora:downloads:changed", history.list(scope));
    });
    nextWindow.on("closed", () => {
      if (window === nextWindow) {
        window = null;
        windowScope = null;
        windowOrigin = null;
        windowOwner = null;
        windowEpoch = null;
      }
    });
    try {
      await nextWindow.loadURL(pageURL);
      if (!nextWindow.isDestroyed()) {
        nextWindow.show();
        return true;
      }
      return false;
    } catch {
      if (!nextWindow.isDestroyed()) nextWindow.destroy();
      return false;
    }
  }
  function capture(id, item) {
    const safeCancel = () => {
      try {
        item.cancel();
      } catch {
        /* already finished */
      }
    };
    const origin = getOrigin();
    const epoch = getIdentityEpoch();
    let current = null;
    let finished = null;
    let lastPersisted = 0;
    function finish(state) {
      if (finished) return;
      finished = state;
      if (!current) return;
      live.delete(id);
      const sameOwner = current.origin === getOrigin() && current.epoch === getIdentityEpoch();
      if (!sameOwner) return;
      const savedPath = state === "completed" ? item.getSavePath() : null;
      let completed = false;
      if (state === "completed" && typeof savedPath === "string" && path.isAbsolute(savedPath)) {
        try {
          completed = fs.statSync(savedPath).isFile();
        } catch {
          /* no saved file */
        }
      }
      try {
        history.finish(
          current.scope,
          id,
          state === "cancelled" ? "cancelled" : completed ? "completed" : "interrupted",
          item.getReceivedBytes(),
          item.getTotalBytes(),
          completed ? savedPath : null
        );
      } catch {
        /* corrupt/unwritable metadata never starts a retry */
      }
      emit();
    }
    // Register synchronously: even tiny downloads can finish while owner verification is in flight.
    item.on("updated", () => {
      if (
        !current ||
        finished ||
        current.epoch !== getIdentityEpoch() ||
        current.origin !== getOrigin()
      )
        return;
      const now = Date.now();
      if (now - lastPersisted < 350) return;
      lastPersisted = now;
      try {
        history.progress(current.scope, id, item.getReceivedBytes(), item.getTotalBytes());
      } catch {}
      emit(false);
    });
    item.once("done", (_event, state) => finish(state));
    void (async () => {
      const owner = origin && (await verifiedOwner({ allowCachedWrite: true }));
      if (!owner || origin !== getOrigin() || epoch !== getIdentityEpoch()) {
        safeCancel();
        return;
      }
      const scope = downloadScope(origin, owner);
      try {
        if (
          !history.start(
            scope,
            id,
            item.getFilename(),
            item.getReceivedBytes(),
            item.getTotalBytes()
          )
        ) {
          safeCancel();
          return;
        }
      } catch {
        safeCancel();
        return;
      }
      current = { scope, origin, epoch };
      if (finished) {
        // The one-shot done callback fired before verification: retain actual terminal result.
        const state = finished;
        finished = null;
        finish(state);
      } else {
        live.set(id, { item, scope, origin, epoch });
        emit();
      }
    })().catch(safeCancel);
  }
  function invalidate({ forget = false, origin = null, owner = null } = {}) {
    const previousScope = windowScope;
    if (window && !window.isDestroyed()) window.destroy();
    for (const [id, entry] of live) {
      try {
        entry.item.cancel();
      } catch {}
      live.delete(id);
      activeDownloads.delete(id);
      if (forget) {
        try {
          history.forgetScope(entry.scope);
        } catch {
          /* no metadata disclosure */
        }
      } else {
        try {
          history.finish(
            entry.scope,
            id,
            "cancelled",
            entry.item.getReceivedBytes(),
            entry.item.getTotalBytes()
          );
        } catch {}
      }
    }
    if (forget && previousScope) {
      try {
        history.forgetScope(previousScope);
      } catch {}
    }
    if (forget && origin && owner) {
      try {
        history.forgetScope(downloadScope(origin, owner));
      } catch {}
    }
    emit();
  }
  function registerIpc() {
    ipcMain.handle("cosmora:downloads:list", async (event) => {
      const scope = await authorize(event);
      return scope ? { ok: true, entries: history.list(scope) } : { ok: false, entries: [] };
    });
    ipcMain.handle("cosmora:downloads:cancel", async (event, id) => {
      const scope = await authorize(event);
      if (!scope || typeof id !== "string" || id.length !== 36) return { ok: false };
      const entry = live.get(id);
      if (!entry || entry.scope !== scope) return { ok: false };
      entry.item.cancel();
      return { ok: true };
    });
    ipcMain.handle("cosmora:downloads:reveal", async (event, id) => {
      const scope = await authorize(event);
      if (!scope || typeof id !== "string" || id.length !== 36) return { ok: false };
      const savedPath = history.savedPath(scope, id);
      if (!savedPath) return { ok: false };
      try {
        if (!fs.statSync(savedPath).isFile()) return { ok: false };
        shell.showItemInFolder(savedPath); // Reveal selection, NEVER shell.openPath / execute.
        return { ok: true };
      } catch {
        return { ok: false };
      }
    });
    ipcMain.handle("cosmora:downloads:clear", async (event) => {
      const scope = await authorize(event);
      if (!scope) return { ok: false };
      try {
        history.clearFinished(scope);
        emit();
        return { ok: true };
      } catch {
        return { ok: false };
      }
    });
  }
  registerIpc();
  return { show, capture, invalidate, history };
}

module.exports = { createDownloadCenter };
