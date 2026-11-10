"use strict";

const { extractVerifiableExcerpt } = require("./document.cjs");
const {
  KosworkBrowserRecoveryError,
  findRecoveryCandidates,
  verifyObservationIntegrity
} = require("./recovery.cjs");

/**
 * Koswork Self-Healing Layout Shift & Recovery Candidate Resolver
 * (`desktop/windows/browser/self-healing-navigation.cjs`).
 *
 * Handles the common dynamic-page scenario where a harmless top banner, cookie notice, or
 * lazy header insertion increments `pageVersion` and shifts UTF-16 offsets (`+N` code units)
 * without mutating the target quote or interactive control's semantic identity:
 * - Re-anchors the excerpt to its new exact UTF-16 offsets (`newStartUtf16`, `newEndUtf16`)
 *   and issues a `recoveryReceipt`.
 * - If the target text was actually substituted/altered (`OBSERVATION_TEXT_SUBSTITUTED`),
 *   refuses to self-heal and propagates the error with ranked recovery candidates.
 */

function reanchorExcerptAfterHarmlessLayoutShift({
  observedSnapshot,
  currentSnapshot,
  originalExcerpt,
  userTakeoverTracker = null
} = {}) {
  if (!originalExcerpt || typeof originalExcerpt.quote !== "string") {
    throw new Error("INVALID_ORIGINAL_EXCERPT_FOR_REANCHOR");
  }

  const integrity = verifyObservationIntegrity({
    observedSnapshot,
    currentSnapshot,
    targetSpec: {
      blockId: originalExcerpt.blockId,
      startUtf16: originalExcerpt.startUtf16,
      endUtf16: originalExcerpt.endUtf16,
      expectedQuote: originalExcerpt.quote
    },
    userTakeoverTracker
  });

  const targetStart = integrity.recoveredShift
    ? integrity.newStartUtf16
    : originalExcerpt.startUtf16;
  const targetEnd = integrity.recoveredShift
    ? integrity.newEndUtf16
    : originalExcerpt.endUtf16;

  const updatedExcerpt = extractVerifiableExcerpt(currentSnapshot, {
    startUtf16: targetStart,
    endUtf16: targetEnd
  });

  return {
    recoveredShift: Boolean(integrity.recoveredShift),
    deltaUtf16: targetStart - originalExcerpt.startUtf16,
    previousPageVersion: observedSnapshot.pageVersion,
    currentPageVersion: currentSnapshot.pageVersion,
    excerpt: updatedExcerpt
  };
}

/**
 * Resolves a control across page version updates using `findRecoveryCandidates`.
 * Only accepts a recovery candidate if its confidence >= `minConfidence` (default 0.75)
 * and its label was not semantically substituted.
 */
function resolveControlWithRecoveryCandidates({
  observedSnapshot,
  currentSnapshot,
  targetControlSpec = {},
  minConfidence = 0.75,
  userTakeoverTracker = null
} = {}) {
  if (userTakeoverTracker && observedSnapshot) {
    userTakeoverTracker.assertObservationValid(
      observedSnapshot.tabId,
      observedSnapshot.userEpoch
    );
  }

  const candidates = findRecoveryCandidates(
    {
      kind: "control",
      id: targetControlSpec.id,
      name: targetControlSpec.name,
      role: targetControlSpec.role,
      label: targetControlSpec.label,
      expectedText: targetControlSpec.label,
      deepSelector: targetControlSpec.deepSelector
    },
    currentSnapshot
  );

  if (candidates.length === 0 || candidates[0].confidence < minConfidence) {
    throw new KosworkBrowserRecoveryError(
      "RECOVERY_CANDIDATE_BELOW_THRESHOLD",
      `Не удалось однозначно восстановить привязку к элементу "${
        targetControlSpec.id || targetControlSpec.label
      }" после изменения страницы.`,
      {
        targetControlSpec,
        candidates
      }
    );
  }

  const best = candidates[0];
  if (targetControlSpec.label && best.textSimilarity < 0.65) {
    throw new KosworkBrowserRecoveryError(
      "OBSERVATION_TEXT_SUBSTITUTED",
      `Подпись элемента "${best.candidateId}" была изменена с "${targetControlSpec.label}" на "${best.actualText}".`,
      {
        targetControlSpec,
        bestCandidate: best
      }
    );
  }

  return {
    recovered: true,
    selectedCandidate: best,
    alternates: candidates.slice(1)
  };
}

module.exports = {
  reanchorExcerptAfterHarmlessLayoutShift,
  resolveControlWithRecoveryCandidates
};
