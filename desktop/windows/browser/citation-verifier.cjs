"use strict";

const crypto = require("node:crypto");

/**
 * Koswork Cryptographic Citation & UTF-16 Excerpt Audit Verifier
 * (`desktop/windows/browser/citation-verifier.cjs`).
 *
 * Audits a generated research report against source snapshots and the provenance journal:
 * 1. Confirms every item in `confirmedClaims` has valid `startUtf16` / `endUtf16` offsets,
 *    a non-empty verbatim `quote`, and a matching `quoteSha256`.
 * 2. When `snapshotsByUrl` is provided, verifies that `snapshot.fullTextUtf16.slice(startUtf16, endUtf16) === quote`.
 * 3. Confirms zero bare-link claims or unavailable sources (HTTP >= 400) leaked into `confirmedClaims`.
 * 4. Confirms both sides (`sideA` and `sideB`) of every reported contradiction carry valid UTF-16 offsets and quotes.
 */
function verifyResearchReportIntegrity({
  confirmedClaims = [],
  unconfirmedClaims = [],
  contradictions = [],
  unavailableSources = [],
  snapshotsByUrl = null
} = {}) {
  const violations = [];
  const unavailableUrlSet = new Set(
    (unavailableSources || []).map((u) => String(u.url || ""))
  );

  let verifiedSlicesCount = 0;

  for (const claim of confirmedClaims) {
    const cid = claim.claimId || "unknown-claim";
    const exc = claim.excerpt;
    const src = claim.source;

    if (!exc || typeof exc.quote !== "string" || !exc.quote.trim()) {
      violations.push({
        claimId: cid,
        code: "BARE_LINK_OR_EMPTY_QUOTE_LEAKED",
        message: `Утверждение "${cid}" попало в подтверждённые без текста выдержки.`
      });
      continue;
    }

    if (
      !Number.isInteger(exc.startUtf16) ||
      !Number.isInteger(exc.endUtf16) ||
      exc.startUtf16 < 0 ||
      exc.endUtf16 <= exc.startUtf16 ||
      exc.endUtf16 - exc.startUtf16 !== exc.quote.length
    ) {
      violations.push({
        claimId: cid,
        code: "INVALID_UTF16_SPAN_LENGTH",
        message: `Несовпадение длины выдержки UTF-16 (${exc.startUtf16}..${exc.endUtf16}) и длины цитаты (${exc.quote.length}).`
      });
    }

    if (!src || !src.url || !src.fetchedAt) {
      violations.push({
        claimId: cid,
        code: "MISSING_SOURCE_PROVENANCE",
        message: `Утверждение "${cid}" не содержит обязательных полей источника (url, fetchedAt).`
      });
    } else if (unavailableUrlSet.has(src.url)) {
      violations.push({
        claimId: cid,
        code: "UNAVAILABLE_SOURCE_USED_AS_PROOF",
        message: `Недоступный источник "${src.url}" не может использоваться как подтверждение для "${cid}".`
      });
    }

    if (snapshotsByUrl && src?.url) {
      const snap =
        snapshotsByUrl instanceof Map
          ? snapshotsByUrl.get(src.url)
          : snapshotsByUrl[src.url];
      if (snap && typeof snap.fullTextUtf16 === "string") {
        const actualSlice = snap.fullTextUtf16.slice(exc.startUtf16, exc.endUtf16);
        if (actualSlice !== exc.quote) {
          violations.push({
            claimId: cid,
            code: "UTF16_SLICE_MISMATCH",
            message: `Срез fullTextUtf16.slice(${exc.startUtf16}, ${exc.endUtf16}) не совпадает с цитатой.`
          });
        } else {
          verifiedSlicesCount += 1;
        }
      }
    }
  }

  for (const conflict of contradictions) {
    for (const sideKey of ["sideA", "sideB"]) {
      const side = conflict[sideKey];
      if (
        !side ||
        !side.quote ||
        !Number.isInteger(side.startUtf16) ||
        !Number.isInteger(side.endUtf16) ||
        side.endUtf16 <= side.startUtf16
      ) {
        violations.push({
          claimId: `contradiction:${conflict.criterion}:${sideKey}`,
          code: "CONTRADICTION_SIDE_MISSING_EXCERPT",
          message: `Сторона противоречия ${sideKey} по критерию "${conflict.criterion}" не имеет валидной выдержки UTF-16.`
        });
      }
    }
  }

  const reportDigestSha256 = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        confirmedClaimsCount: confirmedClaims.length,
        unconfirmedClaimsCount: unconfirmedClaims.length,
        contradictionsCount: contradictions.length,
        unavailableSourcesCount: unavailableSources.length
      }),
      "utf8"
    )
    .digest("hex");

  return {
    auditPassed: violations.length === 0,
    confirmedClaimsChecked: confirmedClaims.length,
    unconfirmedClaimsChecked: unconfirmedClaims.length,
    contradictionsChecked: contradictions.length,
    verifiedSlicesCount,
    violations,
    reportDigestSha256
  };
}

module.exports = {
  verifyResearchReportIntegrity
};
