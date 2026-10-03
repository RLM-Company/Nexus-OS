"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function reportNetworkStatus() {
  ipcRenderer.send("cosmora:network-status", {
    online: navigator.onLine === true
  });
}

window.addEventListener("online", reportNetworkStatus);
window.addEventListener("offline", reportNetworkStatus);
window.addEventListener("DOMContentLoaded", reportNetworkStatus, { once: true });

if (window.location.protocol === "file:") {
  contextBridge.exposeInMainWorld("cosmoraDesktop", {
    getConnectionDefaults: () => ipcRenderer.invoke("cosmora:connection-defaults"),
    connect: (payload) => ipcRenderer.invoke("cosmora:connect", payload)
  });
}
