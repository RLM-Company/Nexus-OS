"use strict";

const { contextBridge, ipcRenderer } = require("electron");

let lastReportedOnline = null;

function reportNetworkStatus() {
  const online = navigator.onLine === true;
  if (online === lastReportedOnline) return;
  lastReportedOnline = online;
  ipcRenderer.send("cosmora:network-status", { online });
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
