"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "kosmoraVault",
  Object.freeze({
    command: (command, value) => ipcRenderer.invoke("kosmora:vault-command", command, value)
  })
);
