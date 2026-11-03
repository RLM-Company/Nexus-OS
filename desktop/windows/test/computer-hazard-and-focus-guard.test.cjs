"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ComputerTaskRecoveryGuard,
  classifyComputerActionHazard,
  verifyForegroundWindowFocus
} = require("../ci/computer-hazard-and-focus-guard.cjs");

test("classifies system shortcuts, destructive commands, step-up consent actions, and safe actions accurately", () => {
  const blockedShortcut = classifyComputerActionHazard({
    kind: "hotkey",
    keys: ["Alt", "F4"]
  });
  assert.equal(blockedShortcut.tier, "strictly_blocked");
  assert.equal(blockedShortcut.code, "BLOCKED_SYSTEM_SHORTCUT");

  const blockedExe = classifyComputerActionHazard({
    kind: "click",
    targetLabel: "setup-installer.exe"
  });
  assert.equal(blockedExe.tier, "strictly_blocked");

  const stepUpPayment = classifyComputerActionHazard({
    kind: "click",
    targetLabel: "Подтвердить платёж и отправить сообщение"
  });
  assert.equal(stepUpPayment.tier, "requires_step_up_consent");
  assert.equal(stepUpPayment.code, "STEP_UP_CONSENT_REQUIRED");

  const safeAction = classifyComputerActionHazard({
    kind: "type",
    targetLabel: "Поле поиска документов",
    text: "Отчёт по архитектуре Kosmora"
  });
  assert.equal(safeAction.tier, "safe");
});

test("halts immediately on Windows focus loss/steal and requires fresh post-interruption consent to resume", () => {
  const focusStolen = verifyForegroundWindowFocus(
    { hwnd: "0x001A2B", processName: "WINWORD.EXE" },
    { hwnd: "0x0099FF", processName: "explorer.exe", minimized: false }
  );
  assert.equal(focusStolen.ok, false);
  assert.equal(focusStolen.code, "FOCUS_STOLEN_BY_OTHER_WINDOW");

  const focusVerified = verifyForegroundWindowFocus(
    { hwnd: "0x001A2B", processName: "WINWORD.EXE" },
    { hwnd: "0x001A2B", processName: "winword.exe", minimized: false }
  );
  assert.equal(focusVerified.ok, true);

  const recoveryGuard = new ComputerTaskRecoveryGuard();
  const checkpoint = recoveryGuard.suspendTaskOnInterruption({
    taskId: "task-win-42",
    ownerId: "owner-1",
    stepIndex: 3,
    reasonCode: focusStolen.code,
    interruptedAt: "2026-11-02T01:10:00.000Z",
    previousConsentId: "consent-initial-1"
  });

  assert.equal(checkpoint.status, "suspended_awaiting_fresh_consent");

  // Reusing the old consent ID must be rejected
  assert.throws(
    () =>
      recoveryGuard.resumeWithFreshConsent({
        taskId: "task-win-42",
        ownerId: "owner-1",
        expectedStateDigest: checkpoint.stateDigest,
        freshConsentId: "consent-initial-1",
        consentedAt: "2026-11-02T01:11:00.000Z"
      }),
    /STALE_CONSENT_REJECTED_FRESH_CONSENT_REQUIRED/
  );

  // Fresh consent with newer timestamp succeeds
  const resumed = recoveryGuard.resumeWithFreshConsent({
    taskId: "task-win-42",
    ownerId: "owner-1",
    expectedStateDigest: checkpoint.stateDigest,
    freshConsentId: "consent-fresh-2",
    consentedAt: "2026-11-02T01:12:00.000Z"
  });
  assert.equal(resumed.status, "resumed");
  assert.equal(resumed.resumedWithConsentId, "consent-fresh-2");
});
