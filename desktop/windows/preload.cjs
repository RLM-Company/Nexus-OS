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
