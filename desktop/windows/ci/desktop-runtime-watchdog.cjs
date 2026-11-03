"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertNotReparseOrSymlink } = require("../workspace/path-guard.cjs");

const MAX_TOTAL_VIEWS_RAM_MB = 512;

/**
 * Desktop Runtime Security Watchdog for Koswork Windows client.
 *
 * Invariant Guards:
 * 1. Monitors aggregate RAM across loaded WebContentsViews and auto-evicts tabs if > 512 MB.
 * 2. Continuously audits connected workspace folders to detect unauthorized symlink or junction swaps.
 * 3. Intercepts session lock / desktop focus loss and suspends active tasks into recovery checkpoints.
 */
class DesktopRuntimeWatchdog {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : null;
    this.maxTotalRamMb = options.maxTotalRamMb ?? MAX_TOTAL_VIEWS_RAM_MB;
    this.sessionLocked = false;
    this.activeTaskRecoveryGuard = options.recoveryGuard ?? null;
    this.activeViews = new Map();
    this.securityViolations = [];
  }

  updateViewMetrics(tabId, metrics) {
    this.activeViews.set(String(tabId), {
      tabId: String(tabId),
      ramMb: Number(metrics.ramMb ?? 0),
      lastActiveAt: Number(metrics.lastActiveAt ?? Date.now())
    });

    let totalRam = 0;
    for (const v of this.activeViews.values()) {
      totalRam += v.ramMb;
    }

    const evictedTabIds = [];
    if (totalRam > this.maxTotalRamMb && this.activeViews.size > 1) {
      // Evict oldest view to bring RAM under ceiling
      let oldestTab = null;
      let oldestTime = Infinity;
      for (const [id, v] of this.activeViews.entries()) {
        if (v.lastActiveAt < oldestTime) {
          oldestTime = v.lastActiveAt;
          oldestTab = id;
        }
      }
      if (oldestTab) {
        this.activeViews.delete(oldestTab);
        evictedTabIds.push(oldestTab);
      }
    }

    return {
      activeViewsCount: this.activeViews.size,
      totalRamMb: Number(totalRam.toFixed(2)),
      overQuota: totalRam > this.maxTotalRamMb,
      evictedTabIds
    };
  }

  /**
   * Scans workspace root and verified files to guarantee no symlinks, junctions,
   * or reparse points were substituted while the task was running.
   */
  auditWorkspaceFolderIntegrity(filesToCheck = []) {
    if (!this.workspaceRoot) return { ok: true, checkedCount: 0 };
    if (!fs.existsSync(this.workspaceRoot)) {
      const err = new Error("WATCHDOG_WORKSPACE_DISCONNECTED");
      err.code = "WATCHDOG_WORKSPACE_DISCONNECTED";
      this.securityViolations.push({ code: err.code, at: new Date().toISOString() });
      throw err;
    }

    const rootLstat = fs.lstatSync(this.workspaceRoot);
    assertNotReparseOrSymlink(this.workspaceRoot, rootLstat);

    let checkedCount = 0;
    for (const relFile of filesToCheck) {
      const fullPath = path.join(this.workspaceRoot, relFile);
      if (fs.existsSync(fullPath)) {
        const fileLstat = fs.lstatSync(fullPath);
        assertNotReparseOrSymlink(fullPath, fileLstat);
        checkedCount++;
      }
    }

    return { ok: true, checkedCount };
  }

  /**
   * Simulates/intercepts a Windows Session Lock event (e.g., Win+L, screensaver, RDP disconnect).
   * Automatically suspends any active computer control task into an immutable checkpoint.
   */
  handleWindowsSessionLockEvent(activeTaskId, ownerId) {
    this.sessionLocked = true;
    let checkpoint = null;
    if (this.activeTaskRecoveryGuard && activeTaskId) {
      checkpoint = this.activeTaskRecoveryGuard.suspendTaskOnInterruption({
        taskId: activeTaskId,
        ownerId: ownerId || "local-owner",
        reasonCode: "WINDOWS_SESSION_LOCKED",
        interruptedAt: new Date().toISOString()
      });
    }

    return {
      sessionLocked: true,
      checkpointCreated: Boolean(checkpoint),
      checkpoint
    };
  }

  handleWindowsSessionUnlockEvent() {
    this.sessionLocked = false;
    return { sessionLocked: false };
  }

  getWatchdogHealthStatus() {
    let totalRam = 0;
    for (const v of this.activeViews.values()) {
      totalRam += v.ramMb;
    }

    return {
      status: this.securityViolations.length === 0 ? "healthy" : "violation_detected",
      sessionLocked: this.sessionLocked,
      activeViewsCount: this.activeViews.size,
      totalRamMb: Number(totalRam.toFixed(2)),
      maxAllowedRamMb: this.maxTotalRamMb,
      securityViolationsCount: this.securityViolations.length,
      violations: this.securityViolations
    };
  }
}

module.exports = {
  DesktopRuntimeWatchdog,
  MAX_TOTAL_VIEWS_RAM_MB
};
