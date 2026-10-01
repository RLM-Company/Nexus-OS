"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cosmoraDesktop", {
  getConnectionDefaults: () => ipcRenderer.invoke("cosmora:connection-defaults"),
  connect: (payload) => ipcRenderer.invoke("cosmora:connect", payload)
});
