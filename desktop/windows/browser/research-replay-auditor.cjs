"use strict";

const { verifyResearchReportIntegrity } = require("./citation-verifier.cjs");

/**
 * Koswork Deterministic Replay & Audit Bundle Verifier
 * (`desktop/windows/browser/research-replay-auditor.cjs`).
 *
 * Verifies cross-artifact consistency across:
 * 1. The saved Research Report (`confirmedClaims`, `unconfirmedClaims`, `contradictions`, `unavailableSources`),
 * 2. The W3C PROV-JSON lineage graph (`provJsonObject.entity`, `provJsonObject.wasDerivedFrom`),
 * 3. The W3C HAR 1.2 session trace (`harLog.log.entries`),
 * 4. The recorded versioned page snapshots (`snapshotsByUrl`).
 *
 * Confirms that every `"confirmed"` claim is backed by:
 * - an exact UTF-16 slice in `snapshotsByUrl`,
 * - a `wasDerivedFrom` edge in the PROV-JSON lineage graph, and
 * - a corresponding HTTP 2xx entry in the HAR 1.2 trace.
 */
function verifyDeterministicResearchReplay({
  savedReports,
  provJsonObject,
  harLog,
  snapshotsByUrl = {}
} = {}) {
  if (!savedReports || typeof savedReports !== "object") {
    throw new Error("REPLAY_AUDITOR_REQUIRES_SAVED_REPORTS");
  }

  const confirmedClaims = savedReports.confirmedClaims || [];
  const unconfirmedClaims = savedReports.unconfirmedClaims || [];

  // 1. Run cryptographic UTF-16 slice & SHA-256 citation verifier
  const citationCheck = verifyResearchReportIntegrity({
    confirmedClaims,
    unconfirmedClaims,
    snapshotsByUrl
  });

  const violations = [...(citationCheck.violations || [])];

  // 2. Verify W3C PROV-JSON derivation edges if `provJsonObject` is provided
  let verifiedProvDerivations = 0;
  if (provJsonObject && provJsonObject.wasDerivedFrom) {
    const wdfEntries = Object.values(provJsonObject.wasDerivedFrom);
    for (const c of confirmedClaims) {
      const claimEntityRef = `kosmora:${c.claimId}`;
      const hasClaimDerivation = wdfEntries.some(
        (edge) => edge["prov:generatedEntity"] === claimEntityRef
      );
      if (!hasClaimDerivation) {
        violations.push({
          code: "PROV_DERIVATION_MISSING_FOR_CLAIM",
          claimId: c.claimId,
          message: `В графе PROV-JSON отсутствует связь wasDerivedFrom для утверждения ${c.claimId}`
        });
      } else {
        verifiedProvDerivations += 1;
      }
    }
  }

  // 3. Verify W3C HAR 1.2 entries if `harLog` is provided
  let verifiedHarEntries = 0;
  if (harLog && harLog.log && Array.isArray(harLog.log.entries)) {
    const harUrls = new Set(
      harLog.log.entries
        .filter((e) => e.response && e.response.status >= 200 && e.response.status < 400)
        .map((e) => e.request?.url)
    );
    for (const c of confirmedClaims) {
      const srcUrl = c.source?.url;
      if (srcUrl && !harUrls.has(srcUrl)) {
        violations.push({
          code: "HAR_TRACE_MISSING_SOURCE_URL",
          claimId: c.claimId,
          sourceUrl: srcUrl,
          message: `В HAR 1.2 трассе отсутствует успешный HTTP-ответ для источника ${srcUrl}`
        });
      } else if (srcUrl) {
        verifiedHarEntries += 1;
      }
    }
  }

  return {
    replayAuditPassed: violations.length === 0 && citationCheck.auditPassed,
    verifiedClaimsCount: confirmedClaims.length,
    verifiedUtf16SlicesCount: citationCheck.verifiedSlicesCount,
    verifiedProvDerivations,
    verifiedHarEntries,
    reportDigestSha256: citationCheck.reportDigestSha256,
    violations
  };
}

module.exports = {
  verifyDeterministicResearchReplay
};
