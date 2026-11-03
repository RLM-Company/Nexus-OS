"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("kosworkComputer", {
  workspaceStatus: () => ipcRenderer.invoke("koswork:computer-workspace-status"),
  selectWorkspace: () => ipcRenderer.invoke("koswork:computer-workspace-select"),
  revokeWorkspace: () => ipcRenderer.invoke("koswork:computer-workspace-revoke"),
  openBrowser: () => ipcRenderer.invoke("koswork:computer-browser"),
  projects: () => ipcRenderer.invoke("koswork:computer-projects"),
  start: (input) => ipcRenderer.invoke("koswork:computer-start", input),
  stop: () => ipcRenderer.invoke("koswork:computer-stop"),
  resume: () => ipcRenderer.invoke("koswork:computer-resume"),
  history: () => ipcRenderer.invoke("koswork:computer-history"),
  recover: (id) => ipcRenderer.invoke("koswork:computer-recover", id),
  accept: (id) => ipcRenderer.invoke("koswork:computer-accept", id),
  clearHistory: () => ipcRenderer.invoke("koswork:computer-clear-history"),
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
