"use strict";

const { contextBridge, ipcRenderer } = require("electron");

if (window.location.protocol === "file:") {
  contextBridge.exposeInMainWorld("cosmoraDesktop", {
    getConnectionState: () => ipcRenderer.invoke("cosmora:connection-state"),
    connect: (payload) => ipcRenderer.invoke("cosmora:connect", payload),
    retry: () => ipcRenderer.invoke("cosmora:retry"),
    onConnectionStateChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("cosmora:connection-state-changed", handler);
      return () => ipcRenderer.removeListener("cosmora:connection-state-changed", handler);
    }
  });
}

// The remote renderer receives only the bounded text-draft API. Every request is
// independently origin- and owner-checked by the Electron main process.
if (window.location.protocol === "https:" || window.location.protocol === "http:") {
  contextBridge.exposeInMainWorld("kosmoraDesktopDraft", {
    load: (scope) => ipcRenderer.invoke("cosmora:draft-load", scope),
    save: (scope, text) => ipcRenderer.invoke("cosmora:draft-save", scope, text),
    clear: (scope) => ipcRenderer.invoke("cosmora:draft-clear", scope),
    flush: (scope, text) => ipcRenderer.send("cosmora:draft-flush", scope, text)
  });
}
