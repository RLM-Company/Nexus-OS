"use strict";

const { extractVerifiableExcerpt } = require("./document.cjs");
const { KosworkBrowserRecoveryError, verifyObservationIntegrity } = require("./recovery.cjs");

/**
 * Scoped Same-Origin Frame & Open Shadow DOM Excerpt & Action Executor
 * (`desktop/windows/browser/frame-shadow-executor.cjs`).
 *
 * Preserves and extends `frames/shadow scope` invariants:
 * 1. Allows targeting specific `framePath` (e.g. `["iframe#pricing-frame"]`) or `shadowPath`
 *    (e.g. `["koswork-pricing-card#alpha"]`) when extracting UTF-16 excerpts or filling controls.
 * 2. Explicitly blocks cross-origin frame access (`CROSS_ORIGIN_FRAME_ISOLATED`) if the target
 *    frame selector appears in `snapshot.skippedCrossOriginFrames`.
 * 3. Verifies post-observation text integrity inside the scoped frame/shadow block before returning
 *    or acting on it.
 */

function assertFrameScopeAllowed(snapshot, requestedScope = {}) {
  const framePath = Array.isArray(requestedScope.framePath) ? requestedScope.framePath : [];
  if (framePath.length === 0) return;

  const skipped = Array.isArray(snapshot?.skippedCrossOriginFrames)
    ? snapshot.skippedCrossOriginFrames
    : [];

  for (const targetFrame of framePath) {
    const blocked = skipped.find(
      (s) => s.frameSelector === targetFrame || s.frameSelector.endsWith(targetFrame)
    );
    if (blocked) {
      const err = new Error(
        `CROSS_ORIGIN_FRAME_ISOLATED: Доступ к кросс-доменному фрейму "${targetFrame}" (${blocked.src}) заблокирован политикой изоляции.`
      );
      err.code = "CROSS_ORIGIN_FRAME_ISOLATED";
      err.details = blocked;
      throw err;
    }
  }
}

function matchesRequestedScope(blockOrControlScope = {}, requestedScope = {}) {
  if (Array.isArray(requestedScope.framePath) && requestedScope.framePath.length > 0) {
    const actualFrames = Array.isArray(blockOrControlScope.framePath)
      ? blockOrControlScope.framePath
      : [];
    const frameMatch = requestedScope.framePath.every((reqF) =>
      actualFrames.some((actF) => actF === reqF || actF.includes(reqF))
    );
    if (!frameMatch) return false;
  }

  if (Array.isArray(requestedScope.shadowPath) && requestedScope.shadowPath.length > 0) {
    const actualShadows = Array.isArray(blockOrControlScope.shadowPath)
      ? blockOrControlScope.shadowPath
      : [];
    const shadowMatch = requestedScope.shadowPath.every((reqS) =>
      actualShadows.some((actS) => actS === reqS || actS.includes(reqS))
    );
    if (!shadowMatch) return false;
  }

  return true;
}

/**
 * Extracts a verifiable UTF-16 excerpt strictly from blocks matching `requestedScope`
 * (`{ framePath: [...], shadowPath: [...] }`), enforcing same-origin isolation and observation integrity.
 */
function extractScopedFrameOrShadowExcerpt({
  snapshot,
  requestedScope = {},
  searchTerm = "",
  expectedObservation = null,
  userTakeoverTracker = null
} = {}) {
  assertFrameScopeAllowed(snapshot, requestedScope);

  const scopedBlocks = (snapshot.blocks || []).filter((b) =>
    matchesRequestedScope(b.scope, requestedScope)
  );
  if (scopedBlocks.length === 0) {
    return null;
  }

  const needle = String(searchTerm || "").trim().toLowerCase();
  const targetBlock = needle
    ? scopedBlocks.find((b) => b.text.toLowerCase().includes(needle))
    : scopedBlocks[0];

  if (!targetBlock) {
    return null;
  }

  if (expectedObservation) {
    verifyObservationIntegrity({
      observedSnapshot: expectedObservation,
      currentSnapshot: snapshot,
      targetSpec: {
        blockId: targetBlock.blockId,
        startUtf16: targetBlock.startUtf16,
        endUtf16: targetBlock.endUtf16
      },
      userTakeoverTracker
    });
  }

  const excerpt = extractVerifiableExcerpt(snapshot, {
    startUtf16: targetBlock.startUtf16,
    endUtf16: targetBlock.endUtf16
  });

  if (!excerpt) {
    throw new KosworkBrowserRecoveryError(
      "SCOPED_EXCERPT_EXTRACTION_FAILED",
      `Не удалось извлечь выдержку из области ${JSON.stringify(requestedScope)}.`
    );
  }

  return {
    ...excerpt,
    scope: targetBlock.scope,
    deepSelector: targetBlock.recoveryAnchors?.deepSelector || null
  };
}

module.exports = {
  assertFrameScopeAllowed,
  extractScopedFrameOrShadowExcerpt,
  matchesRequestedScope
};
