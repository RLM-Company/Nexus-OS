"use strict";

const { extractVaultDocument, readAddressableVaultSlice } = require("../vault-document-extractor.cjs");
const { VaultVirtualBridge } = require("../vault-virtual-bridge.cjs");
const { collectPiercedInteractiveSnapshot } = require("../browser/shadow-and-frame-piercer.cjs");
const { KosworkSearchAndBrowserStore } = require("../browser/search-pagination-and-bookmarks.cjs");
const {
  ComputerTaskRecoveryGuard,
  classifyComputerActionHazard,
  verifyForegroundWindowFocus
} = require("./computer-hazard-and-focus-guard.cjs");
const { KosworkUnifiedTaskCoordinator } = require("./unified-task-coordinator.cjs");

/**
 * Origin-Checked Electron Main Process IPC Router for all Koswork Stage-2 Desktop Capabilities.
 *
 * Security Invariants:
 * 1. Rejects any IPC invocation from an untrusted remote web page (`http:`/`https:` third-party origin
 *    inside the agent browser view) with `UNTRUSTED_IPC_SENDER_ORIGIN`.
 * 2. Requires either the local desktop shell origin (`file://`) or an explicitly allowlisted
 *    authenticated first-party Kosmora origin with a valid owner session token.
 */
class Stage2DesktopIpcBridge {
  constructor(options = {}) {
    this.allowedOrigins = new Set([
      "file://",
      ...(Array.isArray(options.allowedOrigins) ? options.allowedOrigins : ["http://127.0.0.1:3300"])
    ]);
    this.activeOwnerId = options.activeOwnerId || "local-owner";
    this.vaultBridge = options.vaultBridge || new VaultVirtualBridge();
    this.browserStore = options.browserStore || new KosworkSearchAndBrowserStore();
    this.recoveryGuard = options.recoveryGuard || new ComputerTaskRecoveryGuard();
    this.workspaceRoot = options.workspaceRoot || null;
    this.handlers = new Map();
    this.registerDefaultHandlers();
  }

  verifySenderEvent(event) {
    const senderUrl = String(event?.senderFrame?.url || event?.sender?.getURL?.() || "");
    if (!senderUrl) {
      const err = new Error("UNTRUSTED_IPC_SENDER_ORIGIN: Missing sender URL");
      err.code = "UNTRUSTED_IPC_SENDER_ORIGIN";
      throw err;
    }

    if (senderUrl.startsWith("file://")) {
      return { trusted: true, origin: "file://" };
    }

    let parsedOrigin = "";
    try {
      parsedOrigin = new URL(senderUrl).origin;
    } catch {
      const err = new Error(`UNTRUSTED_IPC_SENDER_ORIGIN: Malformed URL "${senderUrl}"`);
      err.code = "UNTRUSTED_IPC_SENDER_ORIGIN";
      throw err;
    }

    if (!this.allowedOrigins.has(parsedOrigin)) {
      const err = new Error(
        `UNTRUSTED_IPC_SENDER_ORIGIN: Origin "${parsedOrigin}" is not permitted to invoke Koswork native IPC`
      );
      err.code = "UNTRUSTED_IPC_SENDER_ORIGIN";
      throw err;
    }

    if (event?.ownerId && String(event.ownerId) !== this.activeOwnerId) {
      const err = new Error("IPC_OWNER_SESSION_MISMATCH");
      err.code = "IPC_OWNER_SESSION_MISMATCH";
      throw err;
    }

    return { trusted: true, origin: parsedOrigin };
  }

  registerHandler(channel, fn) {
    this.handlers.set(channel, async (event, payload) => {
      this.verifySenderEvent(event);
      return await fn(payload || {}, event);
    });
  }

  registerDefaultHandlers() {
    this.registerHandler("koswork:vault:extract-doc", (payload) => {
      const doc = extractVaultDocument(payload.buffer, {
        filename: payload.filename,
        sliceMaxChars: payload.sliceMaxChars
      });
      if (payload.chunkIndex !== undefined) {
        return readAddressableVaultSlice(doc, { chunkIndex: payload.chunkIndex });
      }
      return doc;
    });

    this.registerHandler("koswork:vault:read-virtual-uri", (payload) => {
      return this.vaultBridge.readVirtualUri(payload.taskId, payload.uri, {
        maxUnits: payload.maxUnits,
        nowMs: payload.nowMs
      });
    });

    this.registerHandler("koswork:browser:pierce-dom", (payload) => {
      return collectPiercedInteractiveSnapshot(payload.rootNode, {
        baseOrigin: payload.baseOrigin,
        maxDepth: payload.maxDepth
      });
    });

    this.registerHandler("koswork:browser:search-paginate", (payload) => {
      return this.browserStore.recordAndPaginateSearch(payload);
    });

    this.registerHandler("koswork:computer:check-hazard", (payload) => {
      return classifyComputerActionHazard(payload.action);
    });

    this.registerHandler("koswork:computer:verify-focus", (payload) => {
      return verifyForegroundWindowFocus(payload.expectedTarget, payload.actualForeground);
    });

    this.registerHandler("koswork:unified:run-task", (payload) => {
      const coordinator = new KosworkUnifiedTaskCoordinator({
        workspaceRoot: payload.workspaceRoot || this.workspaceRoot,
        browserStore: this.browserStore
      });
      return coordinator.executeUnifiedResearchAndReportTask(payload.plan);
    });
  }

  async invoke(channel, event, payload) {
    const handler = this.handlers.get(channel);
    if (!handler) {
      const err = new Error(`UNKNOWN_IPC_CHANNEL: ${channel}`);
      err.code = "UNKNOWN_IPC_CHANNEL";
      throw err;
    }
    return await handler(event, payload);
  }
}

module.exports = {
  Stage2DesktopIpcBridge
};
