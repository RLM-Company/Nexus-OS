"use strict";

/**
 * Koswork Epistemic Claim Comparator & Unit/Value Normalizer
 * (`desktop/windows/browser/claim-comparator.cjs`).
 *
 * Distinguishes:
 * 1. Semantically equivalent values expressed in different formats across sources
 *    (e.g., `"$49/мес"` vs `"$49.00 в месяц"`, `"12 мс"` vs `"0.012 с"`, `"64 ГБ"` vs `"65536 МБ"`)
 *    -> merges into `confirmed_multi_source` without false-positive contradiction flags.
 * 2. Genuine contradictions (`"$49/мес"` vs `"$79/мес"`, `"99.95%"` vs `"99.0%"`)
 *    -> flags `conflicting_evidence` and ranks sources by temporal freshness (`eventDate` > `pageDate` > `fetchedAt`).
 */

function normalizeComparableValue(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) {
    return { kind: "empty", canonicalKey: "", numericValue: null, raw };
  }

  const lower = raw.toLowerCase().replace(/,/g, ".");

  // 1. Currency per month/year: e.g. "$49/мес", "$49.00 в месяц", "49 usd/month"
  const currencyMatch = lower.match(
    /(?:\$|usd\s*)?\s*(\d+(?:\.\d+)?)\s*(?:\$|usd)?\s*(?:\/|\s+в\s+|\s+per\s+)?\s*(мес|месяц|month|mo|год|year|yr)(?:$|[^\p{L}\p{N}])/iu
  );
  if (
    currencyMatch &&
    (lower.includes("$") || lower.includes("usd") || lower.includes("мес") || lower.includes("год"))
  ) {
    const amount = Number(currencyMatch[1]);
    const periodRaw = currencyMatch[2].toLowerCase();
    const isYearly = periodRaw.startsWith("год") || periodRaw.startsWith("y");
    const monthlyUsd = isYearly ? Number((amount / 12).toFixed(2)) : Number(amount.toFixed(2));
    return {
      kind: "currency_monthly_usd",
      canonicalKey: `usd_mo:${monthlyUsd.toFixed(2)}`,
      numericValue: monthlyUsd,
      raw
    };
  }

  // 2. Percentage: e.g. "99.95%", "99,95 %"
  const pctMatch = lower.match(/^[^\d]*(\d+(?:\.\d+)?)\s*%[^\d]*$/);
  if (pctMatch) {
    const pct = Number(pctMatch[1]);
    return {
      kind: "percentage",
      canonicalKey: `pct:${pct.toFixed(4)}`,
      numericValue: pct,
      raw
    };
  }

  // 3. Latency / duration: e.g. "< 12 мс", "12 ms", "0.012 с", "0.012 sec"
  const latencyMatch = lower.match(
    /(<\s*|до\s*)?(\d+(?:\.\d+)?)\s*(мс|ms|сек|sec|с|s)(?:$|[^\p{L}\p{N}])/iu
  );
  if (latencyMatch) {
    const prefix = latencyMatch[1] ? "<" : "";
    const val = Number(latencyMatch[2]);
    const unit = latencyMatch[3].toLowerCase();
    const ms = unit === "мс" || unit === "ms" ? val : val * 1000;
    return {
      kind: "latency_ms",
      canonicalKey: `ms:${prefix}${ms.toFixed(2)}`,
      numericValue: ms,
      raw
    };
  }

  // 4. Memory / Storage size: e.g. "64 ГБ", "65536 МБ"
  const storageMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*(гб|gb|мб|mb|тб|tb)(?:$|[^\p{L}\p{N}])/iu
  );
  if (storageMatch) {
    const val = Number(storageMatch[1]);
    const unit = storageMatch[2].toLowerCase();
    const mb =
      unit === "тб" || unit === "tb"
        ? val * 1024 * 1024
        : unit === "гб" || unit === "gb"
          ? val * 1024
          : val;
    return {
      kind: "storage_mb",
      canonicalKey: `mb:${Math.round(mb)}`,
      numericValue: mb,
      raw
    };
  }

  // 5. Canonical text fallback
  const canonicalText = lower.replace(/\s+/g, " ").trim();
  return {
    kind: "text",
    canonicalKey: `txt:${canonicalText}`,
    numericValue: null,
    raw
  };
}

function getEffectiveSourceDate(source = {}) {
  return source.eventDate || source.pageDate || null;
}

/**
 * Compares a group of extracted facts for the same `(optionName, criterion)` across multiple sources.
 */
function compareFactsForCriterion(group = []) {
  if (!Array.isArray(group) || group.length === 0) {
    return {
      status: "missing",
      hasConflict: false,
      evidenceGrade: "unverified_missing",
      distinctClusters: [],
      primaryFact: null,
      contradiction: null,
      outdatedFinding: null
    };
  }

  const clustersByKey = new Map();
  for (const fact of group) {
    const norm = normalizeComparableValue(fact.value ?? fact.displayValue);
    fact.normalizedValue = norm;
    if (!clustersByKey.has(norm.canonicalKey)) {
      clustersByKey.set(norm.canonicalKey, []);
    }
    clustersByKey.get(norm.canonicalKey).push(fact);
  }

  const distinctClusters = Array.from(clustersByKey.values());

  // Sort clusters by newest effective date (`eventDate || pageDate`) descending, then cluster size descending
  distinctClusters.sort((clusterA, clusterB) => {
    const dateA = getEffectiveSourceDate(clusterA[0].source) || "";
    const dateB = getEffectiveSourceDate(clusterB[0].source) || "";
    if (dateA && dateB && dateA !== dateB) {
      return dateA > dateB ? -1 : 1;
    }
    return clusterB.length - clusterA.length;
  });

  if (distinctClusters.length === 1) {
    const singleCluster = distinctClusters[0];
    const uniqueSourceUrls = new Set(singleCluster.map((f) => f.source?.url).filter(Boolean));
    const grade =
      uniqueSourceUrls.size >= 2 ? "confirmed_multi_source" : "confirmed_single_source";
    for (const f of singleCluster) {
      f.evidenceGrade = grade;
    }
    return {
      status: "confirmed",
      hasConflict: false,
      evidenceGrade: grade,
      distinctClusters,
      primaryFact: singleCluster[0],
      corroboratingSourcesCount: uniqueSourceUrls.size,
      contradiction: null,
      outdatedFinding: null
    };
  }

  // Multiple distinct canonical values -> genuine contradiction across sources!
  const newestOrPrimary = distinctClusters[0][0];
  const conflictingSecondary = distinctClusters[1][0];

  const datePrimary = getEffectiveSourceDate(newestOrPrimary.source);
  const dateSecondary = getEffectiveSourceDate(conflictingSecondary.source);

  let outdatedFinding = null;
  if (datePrimary && dateSecondary && datePrimary !== dateSecondary) {
    const older = datePrimary < dateSecondary ? newestOrPrimary : conflictingSecondary;
    const newer = datePrimary < dateSecondary ? conflictingSecondary : newestOrPrimary;
    older.isOutdated = true;
    older.evidenceGrade = "outdated_superseded";
    newer.evidenceGrade = "conflicting_evidence_newer";
    older.outdatedNote = `Более свежий источник (${newer.source.title}) от ${getEffectiveSourceDate(newer.source)} указывает: ${newer.displayValue}`;
    outdatedFinding = {
      optionName: older.optionName,
      criterion: older.criterion,
      url: older.source.url,
      title: older.source.title,
      pageDate: older.source.pageDate,
      eventDate: older.source.eventDate,
      supersededByDate: getEffectiveSourceDate(newer.source),
      note: older.outdatedNote
    };
  } else {
    for (const f of group) {
      f.evidenceGrade = "conflicting_evidence";
    }
  }

  const contradiction = {
    optionName: newestOrPrimary.optionName,
    criterion: newestOrPrimary.criterion,
    summary: `Расхождение значений между источниками: «${newestOrPrimary.displayValue}» против «${conflictingSecondary.displayValue}».`,
    sideA: {
      value: newestOrPrimary.value,
      quote: newestOrPrimary.excerpt.quote,
      startUtf16: newestOrPrimary.excerpt.startUtf16,
      endUtf16: newestOrPrimary.excerpt.endUtf16,
      url: newestOrPrimary.source.url,
      title: newestOrPrimary.source.title,
      pageDate: newestOrPrimary.source.pageDate,
      eventDate: newestOrPrimary.source.eventDate
    },
    sideB: {
      value: conflictingSecondary.value,
      quote: conflictingSecondary.excerpt.quote,
      startUtf16: conflictingSecondary.excerpt.startUtf16,
      endUtf16: conflictingSecondary.excerpt.endUtf16,
      url: conflictingSecondary.source.url,
      title: conflictingSecondary.source.title,
      pageDate: conflictingSecondary.source.pageDate,
      eventDate: conflictingSecondary.source.eventDate
    }
  };

  return {
    status: "conflicting",
    hasConflict: true,
    evidenceGrade: "conflicting_evidence",
    distinctClusters,
    primaryFact: newestOrPrimary,
    secondaryFact: conflictingSecondary,
    contradiction,
    outdatedFinding
  };
}

module.exports = {
  compareFactsForCriterion,
  getEffectiveSourceDate,
  normalizeComparableValue
};
