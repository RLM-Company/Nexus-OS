"use strict";

const { redactSensitiveText } = require("./privacy-redaction-guard.cjs");

/**
 * Koswork Safe Clipboard Paste & Workspace Drag-and-Drop Guard
 * (`desktop/windows/browser/clipboard-paste-and-dragdrop-guard.cjs`).
 *
 * Deepens Requirements #4 & #7:
 * - Sanitizes clipboard paste payloads (stripping zero-width / bidirectional override
 *   characters and optionally redacting accidental secrets/tokens) before delegating
 *   to `engine.fillForm`, which enforces observation integrity (`OBSERVATION_INVALIDATED_BY_USER`
 *   if manual user takeover occurred) and post-input DOM verification.
 * - Validates drag-and-drop file lists strictly against the allowed workspace folder
 *   and forbidden attachment policy via `engine.selectFiles` (`BROWSER_FORBIDDEN_ATTACHMENT`),
 *   never widening file permissions.
 */

const ZERO_WIDTH_AND_BIDI_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\x00-\x08\x0B\x0C\x0E-\x1F]/g;

function normalizeControlId(selector = "") {
  return String(selector || "").trim().replace(/^#/, "");
}

function sanitizeClipboardText(rawText = "", { redactSecrets = false } = {}) {
  const text = String(rawText ?? "");
  const stripped = text.replace(ZERO_WIDTH_AND_BIDI_RE, "");
  const removedCharsCount = text.length - stripped.length;

  if (!redactSecrets) {
    return {
      sanitizedText: stripped,
      removedHiddenCharsCount: removedCharsCount,
      redactedSecretsCount: 0
    };
  }

  const redaction = redactSensitiveText(stripped);
  return {
    sanitizedText: redaction.redactedText,
    removedHiddenCharsCount: removedCharsCount,
    redactedSecretsCount: redaction.redactionCount
  };
}

function executeSafeClipboardPasteIntoControl({
  engine,
  tabId,
  selector,
  clipboardText = "",
  observedSnapshot = null,
  redactSecrets = false
} = {}) {
  if (!engine) {
    throw new Error("executeSafeClipboardPasteIntoControl requires a browser engine instance");
  }

  const controlId = normalizeControlId(selector);
  const sanitized = sanitizeClipboardText(clipboardText, { redactSecrets });
  const fillResult = engine.fillForm({
    tabId,
    observedSnapshot,
    fields: {
      [controlId]: sanitized.sanitizedText,
      [selector]: sanitized.sanitizedText
    }
  });

  return {
    status: fillResult.status,
    tabId,
    selector,
    controlId,
    pastedValue: sanitized.sanitizedText,
    removedHiddenCharsCount: sanitized.removedHiddenCharsCount,
    redactedSecretsCount: sanitized.redactedSecretsCount,
    fillResult
  };
}

function executeSafeWorkspaceFileDrop({
  engine,
  tabId,
  selector,
  candidateFilePaths = [],
  observedSnapshot = null
} = {}) {
  if (!engine) {
    throw new Error("executeSafeWorkspaceFileDrop requires a browser engine instance");
  }

  const controlId = normalizeControlId(selector);
  const acceptedDrops = [];
  const rejectedDrops = [];

  for (const filePath of candidateFilePaths || []) {
    try {
      const selRes = engine.selectFiles({
        tabId,
        controlId,
        filePaths: [filePath],
        observedSnapshot
      });
      const firstAttached = (selRes.attachedFiles || [])[0] || {};
      acceptedDrops.push({
        filePath,
        filename: firstAttached.filename || null,
        sha256: firstAttached.sha256 || null,
        sizeBytes: firstAttached.sizeBytes || 0
      });
    } catch (err) {
      rejectedDrops.push({
        filePath,
        code: err.code || "DROP_REJECTED",
        message: err.message
      });
    }
  }

  return {
    tabId,
    selector,
    controlId,
    acceptedCount: acceptedDrops.length,
    rejectedCount: rejectedDrops.length,
    acceptedDrops,
    rejectedDrops
  };
}

module.exports = {
  sanitizeClipboardText,
  executeSafeClipboardPasteIntoControl,
  executeSafeWorkspaceFileDrop
};
