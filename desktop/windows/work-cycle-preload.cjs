"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const listen = (name, callback) => {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(name, handler);
  return () => ipcRenderer.removeListener(name, handler);
};
// Frozen like every other preload bridge: the exposed surface stays exactly
// the fixed channel list below, renderer-side mutation cannot reshape it.
contextBridge.exposeInMainWorld(
  "kosworkBrowser",
  Object.freeze({
    command: (command, input) => ipcRenderer.invoke("koswork:work-command", command, input),
    onState: (callback) => listen("koswork:work-state", callback),
    onEvent: (callback) => listen("koswork:work-event", callback),
    onShortcut: (callback) => listen("koswork:work-shortcut", callback)
  })
);
