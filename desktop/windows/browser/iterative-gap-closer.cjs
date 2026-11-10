"use strict";

const {
  analyzeResearchCoverageAndBuildFollowUps
} = require("./research-coverage-gap-analyzer.cjs");
const { saveResearchReportsViaWorkspace } = require("./research-report-builder.cjs");

/**
 * Koswork Iterative Closed-Loop Gap-Filling Research Orchestrator
 * (`desktop/windows/browser/iterative-gap-closer.cjs`).
 *
 * Deepens Requirement #2 & #5:
 * - Inspects an initial research dataset across `(options × criteria)` using
 *   `analyzeResearchCoverageAndBuildFollowUps`.
 * - For each `"unknown"` cell, executes the generated follow-up search query via
 *   `engine.searchService.search` and opens top candidate results (`openSearchResult`)
 *   to extract a verifiable UTF-16 excerpt (`[startUtf16, endUtf16]`).
 * - Updates the comparison table and saves the refreshed report via `workspace-service.cjs`
 *   without spawning a second agent loop.
 */
async function executeIterativeGapClosingResearch({
  engine,
  workspaceRoot,
  reportSlug = "gap-closed-report",
  question = "",
  options = [],
  criteria = [],
  initialSources = [],
  initialClaims = [],
  gapExtractionHints = [],
  maxFollowUpQueries = 4,
  signal = null
} = {}) {
  if (!engine) {
    throw new Error("ITERATIVE_GAP_CLOSER_REQUIRES_ENGINE");
  }

  const initialCoverage = analyzeResearchCoverageAndBuildFollowUps({
    question,
    options,
    criteria,
    confirmedClaims: initialClaims
  });

  const allSources = [...initialSources];
  const allClaims = [...initialClaims];
  const executedFollowUps = [];

  const hintsByCell = new Map();
  for (const h of gapExtractionHints) {
    if (h && h.optionName && h.criterion) {
      hintsByCell.set(`${h.optionName}||${h.criterion}`, h);
    }
  }

  const queriesToRun = initialCoverage.followUpQueries.slice(0, maxFollowUpQueries);

  for (let i = 0; i < queriesToRun.length; i += 1) {
    if (signal?.aborted) break;
    const fq = queriesToRun[i];
    const cellKey = `${fq.optionName}||${fq.criterion}`;
    const hint = hintsByCell.get(cellKey) || {};

    const searchQuery = hint.query || fq.query;
    const searchRes = await engine.searchService.search({
      query: searchQuery,
      actor: "agent",
      signal
    });

    const items = searchRes.items || searchRes.results || [];
    if (items.length === 0) continue;

    const opened = await engine.searchService.openSearchResult({
      searchId: searchRes.searchId,
      rank: 1,
      tabId: `gap-tab-${(i % 3) + 1}`,
      actor: "agent",
      extractQuery: hint.searchTerm || fq.criterion,
      signal
    });

    allSources.push({
      url: opened.url,
      title: opened.title,
      httpStatus: opened.httpStatus,
      available: opened.available,
      pageDate: opened.pageDate,
      eventDate: opened.eventDate,
      fetchedAt: opened.fetchedAt,
      tabReceipt: opened.tabReceipt
    });

    const excerpt =
      opened.linkedExcerpts?.[0] ||
      (hint.searchTerm
        ? engine.extractExcerpt(opened.tabId, { searchTerm: hint.searchTerm })
        : null);

    if (excerpt) {
      const newClaim = {
        claimId: `gap-filled-${allClaims.length + 1}`,
        optionName: fq.optionName,
        criterion: fq.criterion,
        value: hint.value || excerpt.quote,
        claim:
          hint.claimText ||
          `${fq.optionName} (${fq.criterion}): ${hint.value || excerpt.quote}`,
        excerpt,
        source: {
          url: opened.url,
          title: opened.title,
          pageDate: opened.pageDate,
          eventDate: opened.eventDate,
          fetchedAt: opened.fetchedAt
        }
      };
      allClaims.push(newClaim);
      executedFollowUps.push({
        optionName: fq.optionName,
        criterion: fq.criterion,
        query: searchQuery,
        resolvedUrl: opened.url,
        filledClaim: newClaim
      });
    }
  }

  const finalCoverage = analyzeResearchCoverageAndBuildFollowUps({
    question,
    options,
    criteria,
    confirmedClaims: allClaims
  });

  // Build comparisonRows for saveResearchReportsViaWorkspace
  const comparisonRows = options.map((opt) => {
    const values = {};
    for (const crit of criteria) {
      const matched = allClaims.find(
        (c) => c.optionName === opt && c.criterion === crit && c.excerpt
      );
      if (matched) {
        values[crit] = {
          displayValue: matched.value || matched.excerpt.quote,
          sourceUrl: matched.source?.url,
          startUtf16: matched.excerpt.startUtf16,
          endUtf16: matched.excerpt.endUtf16
        };
      }
    }
    return { optionName: opt, values };
  });

  let savedReports = null;
  if (workspaceRoot) {
    savedReports = await saveResearchReportsViaWorkspace({
      workspaceRoot,
      reportSlug,
      reportData: {
        question,
        criteria,
        sources: allSources,
        claims: allClaims,
        comparisonRows
      },
      signal
    });
  }

  return {
    initialCoverage,
    finalCoverage,
    executedFollowUpsCount: executedFollowUps.length,
    executedFollowUps,
    savedReports
  };
}

module.exports = {
  executeIterativeGapClosingResearch
};
