"use strict";

const { KosworkBrowserEngine } = require("./engine.cjs");
const { saveResearchReportsViaWorkspace } = require("./research-report-builder.cjs");
const { compareFactsForCriterion } = require("./claim-comparator.cjs");

/**
 * Koswork Multi-Site Browser Research Procedure (`desktop/windows/browser/research-workflow.cjs`).
 *
 * Implements the end-to-end research cycle inside the existing Work executor:
 * 1. Question formulation & criteria decomposition (`formulateResearchQuestion`)
 * 2. Search execution via `engine.searchService` (with automatic multi-page SERP traversal up to `maxSerpPages`)
 * 3. Opening candidate sources in the browser, reading long & dynamic pages, and extracting
 *    UTF-16 anchored excerpts (`claim -> excerpt -> source`)
 * 4. Cross-source comparison by criteria via `compareFactsForCriterion` (`claim-comparator.cjs`),
 *    detecting contradictions, equivalent normalized units, outdated `pageDate`/`eventDate`,
 *    unavailable pages, and post-observation text substitutions
 * 5. Saving verifiable MD / HTML / CSV / JSON / DOCX / XLSX comparison reports via existing workspace file APIs
 */

function formulateResearchQuestion(input = {}) {
  const rawQuestion = String(input.question || input.searchQuery || "").trim();
  if (!rawQuestion) {
    throw new Error("RESEARCH_QUESTION_REQUIRED");
  }
  const criteria =
    Array.isArray(input.criteria) && input.criteria.length > 0
      ? input.criteria.map((c) => String(c).trim()).filter(Boolean)
      : ["Цена", "Автономный режим", "Поддержка SLA"];

  const options =
    Array.isArray(input.options) && input.options.length > 0
      ? input.options.map((o) => String(o).trim()).filter(Boolean)
      : [];

  return {
    question: rawQuestion,
    searchQuery: String(input.searchQuery || rawQuestion).trim(),
    criteria,
    options,
    formulatedAt: new Date().toISOString()
  };
}

/**
 * Executes a complete multi-site browser research workflow using an existing `KosworkBrowserEngine`
 * and optional `workExecutor` (`KosworkUnifiedTaskCoordinator`), recording steps into the unified
 * Work executor history without creating a second agent loop.
 */
async function executeMultiSiteResearchWorkflow({
  engine,
  workspaceRoot,
  workspaceService = null,
  workExecutor = null,
  plan = {},
  signal = null
} = {}) {
  const browserEngine =
    engine ||
    new KosworkBrowserEngine({
      allowedWorkspaceRoot: workspaceRoot
    });

  const recordStep = (action, status, details) => {
    if (workExecutor && typeof workExecutor.appendHistoryEntry === "function") {
      workExecutor.appendHistoryEntry({
        domain: "browser_research",
        action,
        status,
        details
      });
    }
  };

  // Step 1: Question formulation
  const formulation = formulateResearchQuestion(plan);
  recordStep("formulate_question", "completed", {
    question: formulation.question,
    criteria: formulation.criteria,
    options: formulation.options
  });

  // Step 2: Execute search query and collect candidate items across up to `maxSerpPages`
  const maxSerpPages = Math.max(1, Math.min(Number(plan.maxSerpPages ?? 2), 5));
  const pageSize = Math.max(1, Math.min(Number(plan.pageSize ?? 5), 5));

  const searchResponse = await browserEngine.searchService.search({
    query: formulation.searchQuery,
    actor: plan.actor || "agent",
    page: 1,
    pageSize,
    signal,
    mockOrAdapterResults: plan.searchResults || null
  });

  const allSerpItems = [...searchResponse.items];
  let currentPage = 1;
  let lastPageObj = searchResponse;
  while (lastPageObj.hasNextPage && currentPage < maxSerpPages) {
    currentPage += 1;
    lastPageObj = browserEngine.searchService.getSearchPage(searchResponse.searchId, {
      page: currentPage,
      pageSize
    });
    allSerpItems.push(...lastPageObj.items);
  }

  recordStep("search_sources", "completed", {
    searchId: searchResponse.searchId,
    providerId: searchResponse.providerId,
    totalResults: searchResponse.totalResults,
    serpPagesRead: currentPage
  });

  const openedSources = [];
  const unavailableSources = [];
  const extractedFacts = [];
  const substitutionIncidents = [];
  const authPausedSources = [];

  // Step 3: Open each result in the browser engine, read long/dynamic content, and extract UTF-16 excerpts
  for (const item of allSerpItems) {
    if (signal?.aborted) {
      const err = new Error("RESEARCH_WORKFLOW_CANCELLED");
      err.code = "RESEARCH_WORKFLOW_CANCELLED";
      throw err;
    }

    const sourceVisit = await browserEngine.searchService.openSearchResult({
      searchId: searchResponse.searchId,
      rank: item.rank,
      url: item.url,
      actor: plan.actor || "agent",
      signal
    });

    const tabState = browserEngine.tabs.get(sourceVisit.tabId);
    if (!sourceVisit.available || sourceVisit.httpStatus >= 400) {
      unavailableSources.push({
        url: sourceVisit.url,
        title: sourceVisit.title,
        httpStatus: sourceVisit.httpStatus,
        reason: tabState?.networkError || `HTTP ${sourceVisit.httpStatus}`,
        fetchedAt: sourceVisit.fetchedAt
      });
      openedSources.push(sourceVisit);
      recordStep("open_source_unavailable", "degraded", {
        url: sourceVisit.url,
        httpStatus: sourceVisit.httpStatus
      });
      continue;
    }

    if (tabState?.authGate?.gated) {
      authPausedSources.push({
        url: sourceVisit.url,
        gateType: tabState.authGate.gateType,
        code: tabState.authGate.code,
        reason: tabState.authGate.reason
      });
      openedSources.push(sourceVisit);
      recordStep("open_source_paused_for_user", "paused_for_user", {
        url: sourceVisit.url,
        gateType: tabState.authGate.gateType
      });
      continue;
    }

    // Trigger dynamic content loading if page has lazy-loaded blocks
    if (tabState?.rawSiteDef?.onDynamicScroll) {
      await browserEngine.readLongPage({
        tabId: sourceVisit.tabId,
        cursorUtf16: 0,
        windowChars: 4000,
        triggerDynamicScroll: true,
        signal
      });
    }

    // Read progressive windows if the page is a very long article (> 4000 UTF-16 code units)
    const initialObservation = browserEngine.observePage(sourceVisit.tabId, {
      reuseSnapshot: true
    }).snapshot;
    let cursor = 0;
    let windowsRead = 0;
    while (cursor !== null && cursor < initialObservation.totalUtf16CodeUnits) {
      const win = await browserEngine.readLongPage({
        tabId: sourceVisit.tabId,
        cursorUtf16: cursor,
        windowChars: 4000,
        overlapChars: 100,
        signal
      });
      windowsRead += 1;
      cursor = win.hasMore ? win.nextCursorUtf16 : null;
    }

    // Check if the site simulates or exhibits a post-observation text substitution before claim verification
    let urlPathname = "";
    try {
      urlPathname = new URL(sourceVisit.url).pathname;
    } catch {
      urlPathname = sourceVisit.url;
    }

    const subSpec =
      tabState?.rawSiteDef?.simulatePostObservationSubstitution ||
      plan.substitutionsByUrlPath?.[urlPathname] ||
      null;

    if (subSpec) {
      const preSubExcerpt = browserEngine.extractExcerpt(sourceVisit.tabId, {
        searchTerm: subSpec.targetPhrase
      });
      if (subSpec.reNavigateUrl) {
        await browserEngine.navigate({
          tabId: sourceVisit.tabId,
          url: subSpec.reNavigateUrl,
          actor: "agent",
          signal,
          _fromHistoryTraversal: true
        });
      } else {
        browserEngine.mutatePageContent(sourceVisit.tabId, {
          replaceText: {
            from: subSpec.targetPhrase,
            to: subSpec.substitutedPhrase
          }
        });
      }
      if (preSubExcerpt) {
        try {
          browserEngine.extractExcerpt(
            sourceVisit.tabId,
            {
              startUtf16: preSubExcerpt.startUtf16,
              endUtf16: preSubExcerpt.endUtf16,
              expectedQuote: preSubExcerpt.quote
            },
            initialObservation
          );
        } catch (subErr) {
          if (subErr && subErr.code === "OBSERVATION_TEXT_SUBSTITUTED") {
            substitutionIncidents.push({
              url: sourceVisit.url,
              title: sourceVisit.title,
              ...subErr.details
            });
          } else {
            throw subErr;
          }
        }
      }
    }

    // Extract structured claims/facts from the current verified snapshot
    const currentObs = browserEngine.observePage(sourceVisit.tabId, {
      reuseSnapshot: true
    }).snapshot;
    const siteAssertions = Array.isArray(tabState?.rawSiteDef?.assertions)
      ? tabState.rawSiteDef.assertions
      : Array.isArray(plan.assertionsByUrlPath?.[urlPathname])
        ? plan.assertionsByUrlPath[urlPathname]
        : extractHeuristicAssertionsFromSnapshot(currentObs, formulation);

    for (const assertion of siteAssertions) {
      const excerpt = browserEngine.extractExcerpt(
        sourceVisit.tabId,
        {
          exactQuote: assertion.quote,
          searchTerm: assertion.searchTerm || assertion.quote
        },
        currentObs
      );
      if (excerpt) {
        browserEngine.searchService.linkExcerptToSource(sourceVisit.sourceVisitId, excerpt);
        extractedFacts.push({
          optionName: assertion.optionName || "Общий вариант",
          criterion: assertion.criterion,
          value: assertion.value,
          displayValue: String(assertion.displayValue ?? assertion.value),
          claimText:
            assertion.claimText ||
            `${assertion.optionName}: ${assertion.criterion} = ${assertion.displayValue ?? assertion.value}`,
          excerpt,
          source: {
            url: sourceVisit.url,
            title: currentObs.title,
            pageDate: currentObs.pageDate,
            eventDate: currentObs.eventDate,
            fetchedAt: currentObs.fetchedAt
          }
        });
      }
    }

    openedSources.push({
      ...sourceVisit,
      pageDate: currentObs.pageDate,
      eventDate: currentObs.eventDate,
      windowsRead,
      totalUtf16CodeUnits: currentObs.totalUtf16CodeUnits
    });
  }

  // Step 4: Compare across sources using `compareFactsForCriterion` (unit/currency/latency normalization + temporal freshness)
  const contradictions = [];
  const outdatedFindings = [];
  const factsByOptionAndCriterion = new Map();

  for (const fact of extractedFacts) {
    const key = `${fact.optionName}||${fact.criterion}`;
    if (!factsByOptionAndCriterion.has(key)) {
      factsByOptionAndCriterion.set(key, []);
    }
    factsByOptionAndCriterion.get(key).push(fact);
  }

  const allOptions =
    formulation.options.length > 0
      ? formulation.options
      : Array.from(new Set(extractedFacts.map((f) => f.optionName)));

  const comparisonRows = [];
  const claimsForReport = [];

  for (const optionName of allOptions) {
    const rowValues = {};
    let hasConflictInRow = false;

    for (const criterion of formulation.criteria) {
      const key = `${optionName}||${criterion}`;
      const group = factsByOptionAndCriterion.get(key) || [];
      if (group.length === 0) {
        rowValues[criterion] = null;
        claimsForReport.push({
          optionName,
          criterion,
          claim: `${optionName} — значение по критерию «${criterion}»`,
          excerpt: null,
          sourceUrl: null
        });
        continue;
      }

      const comparison = compareFactsForCriterion(group);

      if (comparison.hasConflict) {
        hasConflictInRow = true;
        if (comparison.contradiction) {
          contradictions.push(comparison.contradiction);
        }
        if (comparison.outdatedFinding) {
          outdatedFindings.push(comparison.outdatedFinding);
        }

        const primary = comparison.primaryFact;
        const secondary = comparison.secondaryFact;
        rowValues[criterion] = {
          displayValue: `${primary.displayValue} vs ${secondary.displayValue}`,
          conflict: true,
          outdated: Boolean(primary.isOutdated || secondary.isOutdated),
          sourceUrl: primary.source.url,
          sourceTitle: primary.source.title,
          startUtf16: primary.excerpt.startUtf16,
          endUtf16: primary.excerpt.endUtf16
        };
      } else {
        const chosen = comparison.primaryFact;
        rowValues[criterion] = {
          displayValue: chosen.displayValue,
          conflict: false,
          outdated: Boolean(chosen.isOutdated),
          evidenceGrade: comparison.evidenceGrade,
          corroboratingSourcesCount: comparison.corroboratingSourcesCount || 1,
          sourceUrl: chosen.source.url,
          sourceTitle: chosen.source.title,
          startUtf16: chosen.excerpt.startUtf16,
          endUtf16: chosen.excerpt.endUtf16
        };
      }

      for (const f of group) {
        claimsForReport.push({
          optionName: f.optionName,
          criterion: f.criterion,
          value: f.value,
          claim: f.claimText,
          isOutdated: Boolean(f.isOutdated),
          outdatedNote: f.outdatedNote || null,
          evidenceGrade: f.evidenceGrade || comparison.evidenceGrade,
          excerpt: f.excerpt,
          sourceUrl: f.source.url
        });
      }
    }

    comparisonRows.push({
      optionName,
      values: rowValues,
      verificationSummary: hasConflictInRow
        ? "Обнаружено противоречие между источниками"
        : "Подтверждено выдержками"
    });
  }

  // Include any explicit unbacked claims passed in plan.unbackedClaims to verify epistemic rejection
  if (Array.isArray(plan.unbackedClaims)) {
    for (const rawUnbacked of plan.unbackedClaims) {
      claimsForReport.push({
        claim: rawUnbacked.claim,
        sourceUrl: rawUnbacked.sourceUrl || null,
        excerpt: null
      });
    }
  }

  const resourceMetrics = browserEngine.resourceGovernor.getResourceReport();

  // Step 5: Save reports via workspace service
  const savedReports = await saveResearchReportsViaWorkspace({
    workspaceRoot,
    workspaceService,
    reportSlug: plan.reportSlug || "koswork-browser-research-report",
    exportOfficeFormats: plan.exportOfficeFormats !== false,
    reportData: {
      question: formulation.question,
      criteria: formulation.criteria,
      comparisonRows,
      claims: claimsForReport,
      contradictions,
      outdatedFindings,
      unavailableSources,
      substitutionIncidents,
      sources: openedSources,
      resourceMetrics
    },
    signal
  });

  recordStep("save_research_reports", "completed", {
    markdownPath: savedReports.markdownFile.path,
    htmlPath: savedReports.htmlFile.path,
    csvPath: savedReports.csvFile.path,
    comparisonTablePath: savedReports.comparisonTableFile.path,
    docxPath: savedReports.docxFile?.relativePath || null,
    xlsxPath: savedReports.xlsxFile?.relativePath || null,
    confirmedClaimsCount: savedReports.confirmedClaims.length,
    contradictionsCount: contradictions.length
  });

  return {
    status: "completed",
    formulation,
    searchResponse,
    serpPagesRead: currentPage,
    openedSources,
    unavailableSources,
    authPausedSources,
    contradictions,
    outdatedFindings,
    substitutionIncidents,
    confirmedClaims: savedReports.confirmedClaims,
    unconfirmedClaims: savedReports.unconfirmedClaims,
    comparisonRows,
    resourceMetrics,
    savedReports
  };
}

function extractHeuristicAssertionsFromSnapshot(snapshot, formulation) {
  const results = [];
  for (const block of snapshot.blocks || []) {
    for (const crit of formulation.criteria || []) {
      if (block.text.toLowerCase().includes(crit.toLowerCase())) {
        results.push({
          optionName: formulation.options[0] || snapshot.title || "Источник",
          criterion: crit,
          value: block.text.slice(0, 120),
          displayValue: block.text.slice(0, 120),
          quote: block.text.slice(0, Math.min(block.text.length, 160)),
          claimText: `${snapshot.title}: ${block.text.slice(0, 120)}`
        });
      }
    }
  }
  return results;
}

module.exports = {
  executeMultiSiteResearchWorkflow,
  formulateResearchQuestion
};
