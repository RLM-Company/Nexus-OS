"use strict";

const { contextBridge, ipcRenderer } = require("electron");

if (window.location.protocol === "file:") {
  contextBridge.exposeInMainWorld("cosmoraDownloads", {
    list: () => ipcRenderer.invoke("cosmora:downloads-list"),
    openItem: (id) => ipcRenderer.invoke("cosmora:downloads-open", id),
    revealItem: (id) => ipcRenderer.invoke("cosmora:downloads-reveal", id),
    cancelItem: (id) => ipcRenderer.invoke("cosmora:downloads-cancel", id),
    removeItem: (id) => ipcRenderer.invoke("cosmora:downloads-remove", id),
    clearCompleted: () => ipcRenderer.invoke("cosmora:downloads-clear-completed"),
    openFolder: () => ipcRenderer.invoke("cosmora:downloads-open-folder"),
    onChanged: (listener) => {
      const notify = () => listener();
      ipcRenderer.on("cosmora:downloads-changed", notify);
      return () => ipcRenderer.removeListener("cosmora:downloads-changed", notify);
    }
  });
}
