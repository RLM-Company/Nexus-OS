"use strict";

const { contextBridge, ipcRenderer } = require("electron");

if (window.location.protocol === "file:") {
  contextBridge.exposeInMainWorld("cosmoraDesktop", {
    getConnectionDefaults: () => ipcRenderer.invoke("cosmora:connection-defaults"),
    connect: (payload) => ipcRenderer.invoke("cosmora:connect", payload)
  });
}
