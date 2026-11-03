"use strict";

const crypto = require("node:crypto");

/**
 * Multi-Layer Dangerous Action Classifier, Foreground Window Focus-Loss Guard,
 * and Interrupted Task Consent Checkpoint for Koswork Windows Computer Control
 * (addresses the remaining items in PR #411 `KOSWORK_COMPUTER_CONTROL_2026-10-29_RU.md`
 * and PR #412 `KOSWORK_COMPUTER_RECOVERY_2026-10-29_RU.md`).
 */

const BLOCKED_SHORTCUTS = new Set([
  "alt+f4",
  "ctrl+alt+delete",
  "ctrl+alt+del",
  "win+r",
  "meta+r",
  "win+x",
  "ctrl+shift+escape",
  "ctrl+shift+esc",
  "alt+space+c"
]);

const STRICTLY_BLOCKED_PATTERNS = [
  /(?:^|[^\p{L}\p{N}_])(?:format-volume|diskpart|cipher\s+\/w|bcdedit|vssadmin\s+delete\s+shadows|reg\s+delete|netsh\s+advfirewall|sc\s+delete|rm\s+-rf|del\s+\/[fqs])/iu,
  /\.(?:exe|msi|bat|cmd|ps1|vbs|scr|reg|pfx|p12)(?=[^\p{L}\p{N}_]|$)/iu,
  /(?:^|[^\p{L}\p{N}_])(?:формулировать\s+диск|форматировать|удалить\s+раздел|сбросить\s+windows|отключить\s+брандмауэр)/iu
];

const STEP_UP_CONSENT_PATTERNS = [
  /(?:^|[^\p{L}\p{N}_])(?:оплатить|отправить\s+перевод|подтвердить\s+платёж|удалить\s+аккаунт|отправить\s+сообщение|опубликовать|submit\s+payment|checkout|pay\s+now|delete\s+account|send\s+message|wire\s+transfer)/iu
];

function normalizeShortcut(keys) {
  if (!Array.isArray(keys)) return String(keys || "").toLowerCase().replace(/\s+/g, "");
  return keys
    .map((k) => String(k).trim().toLowerCase())
    .filter(Boolean)
    .join("+");
}

function classifyComputerActionHazard(action) {
  const kind = String(action?.kind || "unknown").toLowerCase();
  const targetLabel = String(action?.targetLabel || action?.selector || "");
  const textPayload = String(action?.text || action?.command || "");
  const urlPayload = String(action?.url || "");
  const combined = `${targetLabel} ${textPayload} ${urlPayload}`.normalize("NFKC");

  if (kind === "hotkey" || kind === "shortcut" || action?.keys) {
    const combo = normalizeShortcut(action.keys || action.shortcut);
    if (BLOCKED_SHORTCUTS.has(combo)) {
      return {
        tier: "strictly_blocked",
        code: "BLOCKED_SYSTEM_SHORTCUT",
        reason: `Системная комбинация клавиш "${combo}" заблокирована политикой безопасности Koswork.`
      };
    }
  }

  for (const re of STRICTLY_BLOCKED_PATTERNS) {
    if (re.test(combined)) {
      return {
        tier: "strictly_blocked",
        code: "BLOCKED_DESTRUCTIVE_OR_EXECUTABLE_ACTION",
        reason: "Действие затрагивает системные утилиты, исполняемые установщики или разрушающие операции ОС."
      };
    }
  }

  for (const re of STEP_UP_CONSENT_PATTERNS) {
    if (re.test(combined)) {
      return {
        tier: "requires_step_up_consent",
        code: "STEP_UP_CONSENT_REQUIRED",
        reason: "Действие связано с отправкой сообщений, публикацией или финансовой операцией и требует явного подтверждения владельца."
      };
    }
  }

  return {
    tier: "safe",
    code: "ALLOWED",
    reason: null
  };
}

/**
 * Verifies that the OS foreground window matches the consented target application/window
 * before any click or keystroke is dispatched. Immediately halts with `FOCUS_LOST_OR_STOLEN`
 * if focus shifted away (as required by PR #411 / #412).
 */
function verifyForegroundWindowFocus(expectedTarget, actualForeground) {
  if (!actualForeground || !actualForeground.hwnd || actualForeground.minimized) {
    return {
      ok: false,
      code: "FOCUS_LOST_OR_MINIMIZED",
      reason: "Целевое окно свернуто или потеряло фокус ввода Windows."
    };
  }

  if (
    expectedTarget.hwnd &&
    String(expectedTarget.hwnd) !== String(actualForeground.hwnd)
  ) {
    return {
      ok: false,
      code: "FOCUS_STOLEN_BY_OTHER_WINDOW",
      reason: `Фокус перехвачен другим окном (ожидался HWND ${expectedTarget.hwnd}, активен ${actualForeground.hwnd}).`
    };
  }

  if (
    expectedTarget.processName &&
    String(expectedTarget.processName).toLowerCase() !==
      String(actualForeground.processName || "").toLowerCase()
  ) {
    return {
      ok: false,
      code: "FOCUS_PROCESS_MISMATCH",
      reason: `Активный процесс "${actualForeground.processName}" не совпадает с разрешённым "${expectedTarget.processName}".`
    };
  }

  return {
    ok: true,
    code: "FOCUS_VERIFIED",
    reason: null
  };
}

/**
 * Creates a tamper-evident recovery checkpoint when a computer control task is interrupted
 * (by focus loss, step-up consent prompt, or crash) and requires a fresh consent token
 * with a newer timestamp before resuming (PR #412).
 */
class ComputerTaskRecoveryGuard {
  constructor() {
    this.checkpoints = new Map();
  }

  suspendTaskOnInterruption(input) {
    const taskId = String(input.taskId);
    const interruptedAt = input.interruptedAt || new Date().toISOString();
    const stateDigest = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          taskId,
          stepIndex: input.stepIndex,
          reasonCode: input.reasonCode,
          interruptedAt
        }),
        "utf8"
      )
      .digest("hex");

    const checkpoint = {
      taskId,
      ownerId: String(input.ownerId),
      stepIndex: Number(input.stepIndex ?? 0),
      reasonCode: String(input.reasonCode || "FOCUS_LOST"),
      interruptedAt,
      previousConsentId: String(input.previousConsentId || ""),
      stateDigest,
      status: "suspended_awaiting_fresh_consent"
    };

    this.checkpoints.set(taskId, checkpoint);
    return checkpoint;
  }

  resumeWithFreshConsent(input) {
    const checkpoint = this.checkpoints.get(String(input.taskId));
    if (!checkpoint) {
      throw new Error("RECOVERY_CHECKPOINT_NOT_FOUND");
    }
    if (checkpoint.ownerId !== String(input.ownerId)) {
      throw new Error("RECOVERY_OWNER_MISMATCH");
    }
    if (checkpoint.stateDigest !== String(input.expectedStateDigest)) {
      throw new Error("RECOVERY_STATE_DIGEST_MISMATCH");
    }
    if (
      !input.freshConsentId ||
      String(input.freshConsentId) === checkpoint.previousConsentId
    ) {
      throw new Error("STALE_CONSENT_REJECTED_FRESH_CONSENT_REQUIRED");
    }
    if (
      !input.consentedAt ||
      String(input.consentedAt) <= checkpoint.interruptedAt
    ) {
      throw new Error("CONSENT_TIMESTAMP_MUST_FOLLOW_INTERRUPTION");
    }

    checkpoint.status = "resumed";
    checkpoint.resumedWithConsentId = String(input.freshConsentId);
    checkpoint.resumedAt = String(input.consentedAt);
    return checkpoint;
  }
}

module.exports = {
  ComputerTaskRecoveryGuard,
  classifyComputerActionHazard,
  verifyForegroundWindowFocus
};
