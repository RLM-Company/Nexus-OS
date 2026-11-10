"use strict";

const { normalizeComparableValue } = require("./claim-comparator.cjs");

/**
 * Koswork Multi-Source Claim Corroboration & Confidence Scorer
 * (`desktop/windows/browser/corroboration-scorer.cjs`).
 *
 * Deepens Requirement #2 & #5:
 * - Evaluates claims across multiple independent sources/domains.
 * - Uses `normalizeComparableValue` so equivalent values phrased in different units or
 *   currencies (e.g., `"$49/мес"` vs `"49 USD/month"`, `"12 мс"` vs `"0.012 с"`) are
 *   recognized as corroborating the same canonical value.
 * - Rejects bare links without a valid UTF-16 excerpt (`verdict: "unverified_bare_link"`).
 * - Distinguishes:
 *   - `"multi_source_corroborated"` (>= 2 distinct sources agree on the canonical value),
 *   - `"single_source_verified"` (1 verified source with UTF-16 excerpt, no contradiction),
 *   - `"conflicting_sources"` (sources provide incompatible canonical values),
 *   - `"unverified_bare_link"` (no valid UTF-16 excerpt).
 */

function extractSourceHostname(rawUrl = "") {
  try {
    return new URL(String(rawUrl)).hostname.toLowerCase();
  } catch {
    return String(rawUrl || "unknown").toLowerCase();
  }
}

function scoreMultiSourceCorroboration(claims = []) {
  const groups = new Map(); // `${optionName}||${criterion}` -> claims[]
  const rejectedBareLinkClaims = [];

  for (const c of claims) {
    if (!c) continue;
    const hasValidExcerpt =
      c.excerpt &&
      typeof c.excerpt.quote === "string" &&
      c.excerpt.quote.trim().length > 0 &&
      Number.isInteger(c.excerpt.startUtf16) &&
      Number.isInteger(c.excerpt.endUtf16) &&
      c.excerpt.endUtf16 - c.excerpt.startUtf16 === c.excerpt.quote.length;

    if (!hasValidExcerpt) {
      rejectedBareLinkClaims.push({
        claimId: c.claimId || null,
        optionName: c.optionName || "Option",
        criterion: c.criterion || "Spec",
        verdict: "unverified_bare_link",
        confidenceScore: 0,
        reason: "Ссылка без верифицированной UTF-16 выдержки не является доказательством утверждения."
      });
      continue;
    }

    const key = `${String(c.optionName || "Option").trim()}||${String(
      c.criterion || "Spec"
    ).trim()}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(c);
  }

  const groupEvaluations = [];

  for (const [key, items] of groups.entries()) {
    const [optionName, criterion] = key.split("||");
    const byCanonicalVal = new Map(); // canonicalKey -> items[]

    for (const item of items) {
      const norm = normalizeComparableValue(item.value || item.excerpt.quote);
      const valKey = norm.canonicalKey;
      if (!byCanonicalVal.has(valKey)) {
        byCanonicalVal.set(valKey, []);
      }
      byCanonicalVal.get(valKey).push({
        ...item,
        normalizedValue: norm,
        sourceHostname: extractSourceHostname(item.source?.url),
        sourceKey: item.source?.url || "unknown"
      });
    }

    const distinctValueClusters = Array.from(byCanonicalVal.entries()).map(
      ([canonicalKey, clusterItems]) => {
        const distinctUrls = new Set(clusterItems.map((i) => i.sourceKey));
        const distinctHosts = new Set(clusterItems.map((i) => i.sourceHostname));
        return {
          canonicalKey,
          displayValue: clusterItems[0].value || clusterItems[0].excerpt.quote,
          distinctSourcesCount: distinctUrls.size,
          distinctDomainsCount: distinctHosts.size,
          supportingClaims: clusterItems
        };
      }
    );

    distinctValueClusters.sort((a, b) => b.distinctSourcesCount - a.distinctSourcesCount);

    let verdict = "single_source_verified";
    let confidenceScore = 0.72;

    if (distinctValueClusters.length > 1) {
      verdict = "conflicting_sources";
      confidenceScore = 0.35;
    } else if (distinctValueClusters[0].distinctSourcesCount >= 2) {
      verdict = "multi_source_corroborated";
      confidenceScore = Math.min(
        0.99,
        Number((0.8 + 0.08 * (distinctValueClusters[0].distinctSourcesCount - 1)).toFixed(2))
      );
    }

    groupEvaluations.push({
      optionName,
      criterion,
      verdict,
      confidenceScore,
      distinctValueClustersCount: distinctValueClusters.length,
      primaryCluster: distinctValueClusters[0],
      allClusters: distinctValueClusters
    });
  }

  return {
    evaluatedGroupsCount: groupEvaluations.length,
    rejectedBareLinkCount: rejectedBareLinkClaims.length,
    groupEvaluations,
    rejectedBareLinkClaims
  };
}

module.exports = {
  scoreMultiSourceCorroboration
};
