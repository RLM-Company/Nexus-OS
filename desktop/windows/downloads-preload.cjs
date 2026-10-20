"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Installed only on the dedicated sandboxed local downloads window.
contextBridge.exposeInMainWorld("kosmoraDownloads", Object.freeze({
  list: () => ipcRenderer.invoke("cosmora:downloads:list"),
  cancel: (id) => ipcRenderer.invoke("cosmora:downloads:cancel", id),
  reveal: (id) => ipcRenderer.invoke("cosmora:downloads:reveal", id),
  clear: () => ipcRenderer.invoke("cosmora:downloads:clear"),
  onChanged: (listener) => {
    if (typeof listener !== "function") return () => {};
    const handler = (_event, entries) => {
      if (Array.isArray(entries)) listener(entries);
    };
    ipcRenderer.on("cosmora:downloads:changed", handler);
    return () => ipcRenderer.removeListener("cosmora:downloads:changed", handler);
  }
}));
