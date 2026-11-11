"use strict";

const { contextBridge, ipcRenderer } = require("electron");

if (window.location.protocol === "file:") {
  contextBridge.exposeInMainWorld(
    "cosmoraDesktop",
    Object.freeze({
      getConnectionState: () => ipcRenderer.invoke("cosmora:connection-state"),
      connect: (payload) => ipcRenderer.invoke("cosmora:connect", payload),
      retry: () => ipcRenderer.invoke("cosmora:retry"),
      cancel: () => ipcRenderer.invoke("cosmora:cancel-connect"),
      onConnectionStateChanged: (listener) => {
        const handler = () => listener();
        ipcRenderer.on("cosmora:connection-state-changed", handler);
        return () => ipcRenderer.removeListener("cosmora:connection-state-changed", handler);
      }
    })
  );
}

// Hosted content receives bounded drafts and an opener for the separate native
// consent window. No screen, keyboard, mouse, shell or filesystem RPC is exposed.
if (window.location.protocol === "https:" || window.location.protocol === "http:") {
  contextBridge.exposeInMainWorld(
    "kosmoraDesktopVault",
    Object.freeze({
      open: () => ipcRenderer.invoke("kosmora:vault-open"),
      readContext: () => ipcRenderer.invoke("kosmora:vault-read-context"),
      ackContext: (id) => ipcRenderer.invoke("kosmora:vault-ack-context", id),
      onContext: (listener) => {
        const handler = () => listener();
        ipcRenderer.on("kosmora:vault-context-ready", handler);
        return () => ipcRenderer.removeListener("kosmora:vault-context-ready", handler);
      }
    })
  );
  contextBridge.exposeInMainWorld(
    "kosmoraDesktopDraft",
    Object.freeze({
      load: (scope) => ipcRenderer.invoke("cosmora:draft-load", scope),
      save: (scope, text) => ipcRenderer.invoke("cosmora:draft-save", scope, text),
      clear: (scope) => ipcRenderer.invoke("cosmora:draft-clear", scope),
      flush: (scope, text) => ipcRenderer.send("cosmora:draft-flush", scope, text)
    })
  );
  contextBridge.exposeInMainWorld(
    "kosmoraDesktopComputer",
    Object.freeze({
      open: (input) => ipcRenderer.invoke("koswork:computer-open", input)
    })
  );
  contextBridge.exposeInMainWorld(
    "kosmoraDesktopWork",
    Object.freeze({
      open: (input) => ipcRenderer.invoke("koswork:work-open", input),
      onResult: (listener) => {
        if (typeof listener !== "function") return () => {};
        const handler = (_event, value) => listener(value);
        ipcRenderer.on("koswork:work-result", handler);
        return () => ipcRenderer.removeListener("koswork:work-result", handler);
      }
    })
  );
}
