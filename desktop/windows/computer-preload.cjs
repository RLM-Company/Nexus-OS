"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("kosworkComputer", {
  projects: () => ipcRenderer.invoke("koswork:computer-projects"),
  start: (input) => ipcRenderer.invoke("koswork:computer-start", input),
  stop: () => ipcRenderer.invoke("koswork:computer-stop"),
  onStatus(listener) {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("koswork:computer-status", handler);
    return () => ipcRenderer.removeListener("koswork:computer-status", handler);
  },
  onPrefill(listener) {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("koswork:computer-prefill", handler);
    return () => ipcRenderer.removeListener("koswork:computer-prefill", handler);
  }
});
