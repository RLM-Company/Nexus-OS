"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopRuntimeWatchdog } = require("../ci/desktop-runtime-watchdog.cjs");
const { ComputerTaskRecoveryGuard } = require("../ci/computer-hazard-and-focus-guard.cjs");

test("enforces 512 MB WebContentsView RAM quota with auto-eviction, audits workspace folder integrity, and catches Windows session lock", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-watchdog-test-"));
  const recoveryGuard = new ComputerTaskRecoveryGuard();

  try {
    fs.writeFileSync(path.join(workspaceRoot, "notes.txt"), "Текстовый файл рабочей папки", "utf8");

    const watchdog = new DesktopRuntimeWatchdog({
      workspaceRoot,
      maxTotalRamMb: 512,
      recoveryGuard
    });

    // 1. RAM quota tracking: registering 3 views (total 400 MB) is under quota
    watchdog.updateViewMetrics("view-1", { ramMb: 150, lastActiveAt: 1000 });
    watchdog.updateViewMetrics("view-2", { ramMb: 120, lastActiveAt: 2000 });
    const safeMetrics = watchdog.updateViewMetrics("view-3", { ramMb: 130, lastActiveAt: 3000 });
    assert.equal(safeMetrics.overQuota, false);
    assert.equal(safeMetrics.evictedTabIds.length, 0);

    // Adding 4th view (200 MB) brings total to 600 MB (> 512 MB) -> oldest view-1 must be auto-evicted!
    const overMetrics = watchdog.updateViewMetrics("view-4", { ramMb: 200, lastActiveAt: 4000 });
    assert.deepEqual(overMetrics.evictedTabIds, ["view-1"]);
    assert.equal(overMetrics.activeViewsCount, 3);

    // 2. Workspace integrity audit
    const auditRes = watchdog.auditWorkspaceFolderIntegrity(["notes.txt"]);
    assert.equal(auditRes.ok, true);
    assert.equal(auditRes.checkedCount, 1);

    // 3. Windows session lock event (Win+L / screensaver / RDP disconnect)
    const lockRes = watchdog.handleWindowsSessionLockEvent("task-active-77", "owner-1");
    assert.equal(lockRes.sessionLocked, true);
    assert.equal(lockRes.checkpointCreated, true);
    assert.equal(lockRes.checkpoint.reasonCode, "WINDOWS_SESSION_LOCKED");

    const health = watchdog.getWatchdogHealthStatus();
    assert.equal(health.status, "healthy");
    assert.equal(health.sessionLocked, true);
    assert.equal(health.securityViolationsCount, 0);

    watchdog.handleWindowsSessionUnlockEvent();
    assert.equal(watchdog.sessionLocked, false);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
