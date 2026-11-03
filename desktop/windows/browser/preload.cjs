"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("kosworkBrowser", {
  onShortcut(fn) {
    const handler = (_e, key) => fn(key);
    ipcRenderer.on("koswork:browser-shortcut", handler);
    return () => ipcRenderer.removeListener("koswork:browser-shortcut", handler);
  },
  command: (command, input) => ipcRenderer.invoke("koswork:browser-command", command, input),
  onState(fn) {
    const handler = (_e, v) => fn(v);
    ipcRenderer.on("koswork:browser-state", handler);
    return () => ipcRenderer.removeListener("koswork:browser-state", handler);
  },
  onEvent(fn) {
    const handler = (_e, v) => fn(v);
    ipcRenderer.on("koswork:browser-event", handler);
    return () => ipcRenderer.removeListener("koswork:browser-event", handler);
  }
});
