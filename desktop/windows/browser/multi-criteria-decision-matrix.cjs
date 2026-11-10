"use strict";

const { normalizeComparableValue } = require("./claim-comparator.cjs");

/**
 * Koswork Multi-Criteria Decision Matrix & Pareto Trade-Off Analyzer
 * (`desktop/windows/browser/multi-criteria-decision-matrix.cjs`).
 *
 * Deepens Requirement #2 & #5:
 * - Evaluates compared options across weighted criteria (`direction: "lower_better" | "higher_better"`
 *   and hard constraints `maxNumeric` / `minNumeric`).
 * - Strictly requires a verified UTF-16 excerpt (`startUtf16`, `endUtf16`, `quote`) for any
 *   confirmed criterion score; missing or bare-link criteria are marked `"unknown"` and
 *   never fabricated or interpolated.
 * - Identifies Pareto-optimal options (`paretoOptimal: true`) and ranks eligible options
 *   with full citation provenance per cell.
 */

function evaluateMultiCriteriaDecisionMatrix({
  options = [],
  criteriaSpecs = [],
  confirmedClaims = []
} = {}) {
  const optionNames = Array.from(
    new Set([
      ...options,
      ...confirmedClaims.map((c) => c.optionName).filter(Boolean)
    ])
  );

  // Index verified claims by `${optionName}||${criterion}`
  const claimMap = new Map();
  for (const c of confirmedClaims) {
    if (!c || !c.optionName || !c.criterion || !c.excerpt || !c.excerpt.quote) continue;
    const key = `${String(c.optionName).trim()}||${String(c.criterion).trim()}`;
    if (!claimMap.has(key)) {
      claimMap.set(key, c);
    }
  }

  // Collect min/max numeric values per criterion across options for min-max normalization
  const numericBounds = new Map();
  for (const spec of criteriaSpecs) {
    const crit = spec.name || spec.criterion;
    const nums = [];
    for (const opt of optionNames) {
      const claim = claimMap.get(`${opt}||${crit}`);
      if (!claim) continue;
      const norm = normalizeComparableValue(claim.value || claim.excerpt.quote);
      if (typeof norm.numericValue === "number" && Number.isFinite(norm.numericValue)) {
        nums.push(norm.numericValue);
      }
    }
    if (nums.length > 0) {
      numericBounds.set(crit, {
        min: Math.min(...nums),
        max: Math.max(...nums)
      });
    }
  }

  const evaluatedOptions = optionNames.map((optionName) => {
    let weightedSum = 0;
    let totalWeight = 0;
    let confirmedCriteriaCount = 0;
    let unknownCriteriaCount = 0;
    const hardConstraintViolations = [];
    const criterionCells = {};
    const numericVector = {};

    for (const spec of criteriaSpecs) {
      const crit = spec.name || spec.criterion;
      const weight = Math.max(0, Number(spec.weight ?? 1));
      const direction = spec.direction || "higher_better";
      totalWeight += weight;

      const claim = claimMap.get(`${optionName}||${crit}`);
      if (!claim) {
        unknownCriteriaCount += 1;
        if (spec.required) {
          hardConstraintViolations.push({
            criterion: crit,
            reason: "MISSING_VERIFIED_EXCERPT_FOR_REQUIRED_CRITERION"
          });
        }
        criterionCells[crit] = {
          status: "unknown",
          displayValue: "Неизвестно (нет выдержки)",
          normalizedScore: 0,
          sourceUrl: null
        };
        continue;
      }

      confirmedCriteriaCount += 1;
      const norm = normalizeComparableValue(claim.value || claim.excerpt.quote);
      const numVal = norm.numericValue;

      if (typeof numVal === "number" && Number.isFinite(numVal)) {
        if (typeof spec.maxNumeric === "number" && numVal > spec.maxNumeric) {
          hardConstraintViolations.push({
            criterion: crit,
            reason: `VALUE_${numVal}_EXCEEDS_MAX_${spec.maxNumeric}`
          });
        }
        if (typeof spec.minNumeric === "number" && numVal < spec.minNumeric) {
          hardConstraintViolations.push({
            criterion: crit,
            reason: `VALUE_${numVal}_BELOW_MIN_${spec.minNumeric}`
          });
        }
      }

      let cellScore = 1;
      const bounds = numericBounds.get(crit);
      if (bounds && typeof numVal === "number" && bounds.max > bounds.min) {
        const ratio = (numVal - bounds.min) / (bounds.max - bounds.min);
        cellScore = direction === "lower_better" ? 1 - ratio : ratio;
      }

      numericVector[crit] =
        typeof numVal === "number"
          ? direction === "lower_better"
            ? -numVal
            : numVal
          : cellScore;

      weightedSum += cellScore * weight;
      criterionCells[crit] = {
        status: "confirmed",
        displayValue: claim.value || claim.excerpt.quote,
        numericValue: numVal,
        normalizedScore: Number(cellScore.toFixed(4)),
        quote: claim.excerpt.quote,
        startUtf16: claim.excerpt.startUtf16,
        endUtf16: claim.excerpt.endUtf16,
        sourceUrl: claim.source?.url || null
      };
    }

    const overallScore =
      totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(4)) : 0;

    return {
      optionName,
      eligible: hardConstraintViolations.length === 0,
      hardConstraintViolations,
      confirmedCriteriaCount,
      unknownCriteriaCount,
      overallScore,
      criterionCells,
      _numericVector: numericVector
    };
  });

  // Compute Pareto optimality among eligible options
  for (const cand of evaluatedOptions) {
    if (!cand.eligible) {
      cand.paretoOptimal = false;
      continue;
    }
    let dominated = false;
    for (const other of evaluatedOptions) {
      if (other.optionName === cand.optionName || !other.eligible) continue;
      const critNames = criteriaSpecs.map((s) => s.name || s.criterion);
      const allGreaterOrEqual = critNames.every(
        (c) => (other._numericVector[c] ?? -Infinity) >= (cand._numericVector[c] ?? -Infinity)
      );
      const strictlyGreaterOne = critNames.some(
        (c) => (other._numericVector[c] ?? -Infinity) > (cand._numericVector[c] ?? -Infinity)
      );
      if (allGreaterOrEqual && strictlyGreaterOne) {
        dominated = true;
        break;
      }
    }
    cand.paretoOptimal = !dominated;
  }
  for (const cand of evaluatedOptions) {
    delete cand._numericVector;
  }

  evaluatedOptions.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.overallScore - a.overallScore;
  });

  return {
    optionsCount: evaluatedOptions.length,
    paretoFrontierOptions: evaluatedOptions
      .filter((o) => o.paretoOptimal)
      .map((o) => o.optionName),
    recommendedOption: evaluatedOptions.find((o) => o.eligible)?.optionName || null,
    rankings: evaluatedOptions
  };
}

module.exports = {
  evaluateMultiCriteriaDecisionMatrix
};
