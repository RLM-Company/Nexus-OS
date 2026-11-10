"use strict";

/**
 * Koswork Research Coverage & Gap Follow-Up Planner
 * (`desktop/windows/browser/research-coverage-gap-analyzer.cjs`).
 *
 * Deepens Requirement #2 & #5:
 * - Audits an in-progress or completed research cycle against the requested
 *   `(options × criteria)` matrix.
 * - Explicitly classifies every cell into:
 *   - `"confirmed"` (backed by a valid UTF-16 excerpt `[startUtf16..endUtf16]`),
 *   - `"conflicting"` (multiple sources provide incompatible values for this cell),
 *   - `"unknown"` (no verified excerpt found yet; bare links are rejected).
 * - Generates targeted follow-up search queries (`followUpQueries`) specifically for
 *   `"unknown"` and `"conflicting"` cells so the Work executor can close knowledge gaps
 *   without re-searching already-confirmed cells.
 */
function analyzeResearchCoverageAndBuildFollowUps({
  question = "",
  options = [],
  criteria = [],
  confirmedClaims = [],
  contradictions = []
} = {}) {
  const cleanOptions = Array.from(new Set(options.map((o) => String(o).trim()).filter(Boolean)));
  const cleanCriteria = Array.from(
    new Set(criteria.map((c) => String(c).trim()).filter(Boolean))
  );

  const confirmedByCell = new Map();
  for (const c of confirmedClaims) {
    if (!c || !c.optionName || !c.criterion || !c.excerpt || !c.excerpt.quote) continue;
    const key = `${String(c.optionName).trim()}||${String(c.criterion).trim()}`;
    if (!confirmedByCell.has(key)) {
      confirmedByCell.set(key, []);
    }
    confirmedByCell.get(key).push(c);
  }

  const conflictCells = new Set();
  for (const cf of contradictions) {
    if (cf && cf.optionName && cf.criterion) {
      conflictCells.add(`${String(cf.optionName).trim()}||${String(cf.criterion).trim()}`);
    }
  }

  const confirmedCells = [];
  const conflictingCells = [];
  const unknownCells = [];
  const followUpQueries = [];

  for (const opt of cleanOptions) {
    for (const crit of cleanCriteria) {
      const key = `${opt}||${crit}`;
      const claimsForCell = confirmedByCell.get(key) || [];
      const hasConflict = conflictCells.has(key);

      if (hasConflict) {
        conflictingCells.push({
          optionName: opt,
          criterion: crit,
          status: "conflicting",
          claimsCount: claimsForCell.length
        });
        followUpQueries.push({
          optionName: opt,
          criterion: crit,
          reason: "resolve_contradiction",
          query: `${opt} ${crit} официальная спецификация актуальная дата 2026`
        });
      } else if (claimsForCell.length > 0) {
        confirmedCells.push({
          optionName: opt,
          criterion: crit,
          status: "confirmed",
          value: claimsForCell[0].value || claimsForCell[0].excerpt.quote,
          sourceUrl: claimsForCell[0].source?.url || null
        });
      } else {
        unknownCells.push({
          optionName: opt,
          criterion: crit,
          status: "unknown",
          reasonRu: "Подтверждающая UTF-16 выдержка не найдена."
        });
        followUpQueries.push({
          optionName: opt,
          criterion: crit,
          reason: "fill_unknown_gap",
          query: `${opt} ${crit} документация характеристики`
        });
      }
    }
  }

  const totalCells = cleanOptions.length * cleanCriteria.length;
  const coverageRatio =
    totalCells > 0 ? Number((confirmedCells.length / totalCells).toFixed(4)) : 1;

  return {
    question,
    totalCells,
    confirmedCellsCount: confirmedCells.length,
    conflictingCellsCount: conflictingCells.length,
    unknownCellsCount: unknownCells.length,
    coverageRatio,
    fullyCovered: unknownCells.length === 0 && conflictingCells.length === 0,
    confirmedCells,
    conflictingCells,
    unknownCells,
    followUpQueries
  };
}

module.exports = {
  analyzeResearchCoverageAndBuildFollowUps
};
