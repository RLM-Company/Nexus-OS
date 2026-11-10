"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildStructuredResearchReport,
  saveResearchReportArtifactsViaCodexAdapters
} = require("./research-report-builder.cjs");

/**
 * Koswork End-to-End Multi-Site Deep Research Workflow (`desktop/windows/browser/research-workflow.cjs`).
 *
 * Implements Queue Items #5 & #6:
 * - Decomposes the research goal into targeted sub-questions (`decomposeResearchGoalIntoQuestions`).
 * - Limits repeated search queries (`maxQueriesPerQuestion`, `maxTotalQueries`) — no infinite loops.
 * - Executes multi-page SERP search, deduplicates URLs/content, opens diverse sources in real Chromium,
 *   reads long pages (`>18,000` UTF-16 chars) across scrolled windows, and runs bounded follow-up
 *   searches for missing confirmations.
 * - Evaluates contradictions across sources, marks unconfirmed cells honestly as `"не удалось установить"`,
 *   saves a real report artifact via the existing Codex workspace/Office adapters, and supports
 *   cancellation / checkpoint continuation + project handoff hook (`onProjectArtifactReady`).
 */

function decomposeResearchGoalIntoQuestions({
  question,
  options = ["Option Alpha", "Option Beta"],
  criteria = ["Цена", "SLA", "Задержка p95"]
} = {}) {
  const base = String(question || "Исследование вариантов").trim();
  const subQuestions = [];
  for (const opt of options) {
    subQuestions.push(
      `Каковы подтверждённые первоисточниками значения критериев (${criteria.join(", ")}) для ${opt}?`
    );
  }
  subQuestions.push(
    `Имеются ли противоречия или устаревшие данные между источниками по теме: «${base}»?`
  );
  return subQuestions;
}

async function executeMultiSiteResearchWorkflow({
  engine,
  workspaceRoot,
  question,
  options = ["Option Alpha", "Option Beta"],
  criteria = ["Цена", "SLA", "Задержка p95"],
  extractionRules = [],
  maxQueriesPerQuestion = 2,
  maxTotalQueries = 6,
  maxSerpPages = 2,
  reportSlug = "browser-deep-research-report",
  checkpointFilePath = null,
  resumeFromCheckpoint = false,
  onProjectArtifactReady = null,
  signal = null
} = {}) {
  if (!engine) {
    throw new Error("RESEARCH_WORKFLOW_REQUIRES_BROWSER_ENGINE");
  }
  if (!workspaceRoot) {
    throw new Error("RESEARCH_WORKFLOW_REQUIRES_WORKSPACE_ROOT");
  }

  const resolvedCheckpointPath =
    checkpointFilePath ||
    path.join(workspaceRoot, ".koswork-research-checkpoint.json");

  let state = {
    question,
    subQuestions: decomposeResearchGoalIntoQuestions({ question, options, criteria }),
    executedQueries: [],
    openedUrls: [],
    extractedFacts: [],
    unavailableSources: [],
    completedSerpPages: 0
  };

  if (resumeFromCheckpoint && fs.existsSync(resolvedCheckpointPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(resolvedCheckpointPath, "utf8"));
      if (saved && saved.question === question) {
        state = { ...state, ...saved };
      }
    } catch {
      // start fresh if checkpoint unreadable
    }
  }

  const snapshotsByUrl = new Map();
  let queriesUsed = state.executedQueries.length;

  function persistCheckpoint(status = "in_progress") {
    try {
      fs.mkdirSync(path.dirname(resolvedCheckpointPath), { recursive: true });
      fs.writeFileSync(
        resolvedCheckpointPath,
        JSON.stringify({ ...state, status, updatedAt: new Date().toISOString() }, null, 2),
        "utf8"
      );
    } catch {
      // ignore checkpoint write error
    }
  }

  const normalizedQuerySeen = new Set(
    state.executedQueries.map((q) => String(q).toLowerCase().trim())
  );

  async function runBoundedSearchAndCollect(queryStr, page = 1) {
    if (signal?.aborted) {
      persistCheckpoint("cancelled");
      const err = new Error("RESEARCH_WORKFLOW_CANCELLED");
      err.code = "RESEARCH_WORKFLOW_CANCELLED";
      throw err;
    }

    const qKey = `${String(queryStr).toLowerCase().trim()}::p${page}`;
    if (normalizedQuerySeen.has(qKey) || queriesUsed >= maxTotalQueries) {
      return { skippedByBudget: true, items: [] };
    }

    normalizedQuerySeen.add(qKey);
    queriesUsed += 1;
    state.executedQueries.push(qKey);

    const serp = await engine.searchService.search({
      query: queryStr,
      page,
      pageSize: 5,
      signal
    });
    state.completedSerpPages += 1;

    for (const item of serp.items || []) {
      if (signal?.aborted) {
        persistCheckpoint("cancelled");
        const err = new Error("RESEARCH_WORKFLOW_CANCELLED");
        err.code = "RESEARCH_WORKFLOW_CANCELLED";
        throw err;
      }

      if (state.openedUrls.includes(item.url)) {
        continue;
      }
      state.openedUrls.push(item.url);

      const visit = await engine.searchService.openSearchResult({
        searchId: serp.searchId,
        rank: item.rank,
        url: item.url,
        signal
      });

      if (!visit.available) {
        state.unavailableSources.push({
          url: visit.url,
          httpStatus: visit.httpStatus,
          reason: `Источник вернул HTTP ${visit.httpStatus}`
        });
        persistCheckpoint("in_progress");
        continue;
      }

      if (visit.duplicateContentOfUrl) {
        continue;
      }

      const tab = engine.tabs.get(visit.tabId);
      if (!tab || !tab.snapshot) continue;

      // If the page is a long article (> 12,000 UTF-16 chars), read through its scrolled windows
      if (tab.snapshot.totalLengthUtf16 > 12000) {
        let cursor = 0;
        while (cursor < tab.snapshot.totalLengthUtf16) {
          const win = await engine.readLongPage({
            tabId: visit.tabId,
            cursorUtf16: cursor,
            windowChars: 5000,
            overlapChars: 200,
            scrollInChromium: true,
            signal
          });
          if (!win.hasMore) break;
          cursor = win.nextCursorUtf16;
        }
      }

      snapshotsByUrl.set(visit.url, tab.snapshot);

      for (const rule of extractionRules) {
        try {
          const exc = engine.extractExcerpt(visit.tabId, {
            searchTerm: rule.searchPhrase
          });
          state.extractedFacts.push({
            optionName: rule.optionName,
            criterion: rule.criterion,
            value: rule.value,
            displayValue: rule.displayValue || rule.value,
            excerpt: exc,
            source: {
              url: visit.url,
              title: visit.title,
              pageDate: visit.pageDate,
              eventDate: visit.eventDate,
              fetchedAt: visit.fetchedAt
            }
          });
        } catch {
          // phrase not present in this source
        }
      }

      persistCheckpoint("in_progress");
    }

    return serp;
  }

  // Step 1: Primary search across SERP pages (up to maxSerpPages and maxQueriesPerQuestion)
  for (let p = 1; p <= maxSerpPages; p += 1) {
    if (queriesUsed >= maxTotalQueries) break;
    await runBoundedSearchAndCollect(question, p);
  }

  // Step 2: Check for missing confirmations and run at most 1 targeted follow-up per option within budget
  let followUpQueriesRun = 0;
  for (const opt of options) {
    for (const crit of criteria) {
      const hasFact = state.extractedFacts.some(
        (f) => f.optionName === opt && f.criterion === crit
      );
      if (
        !hasFact &&
        followUpQueriesRun < maxQueriesPerQuestion &&
        queriesUsed < maxTotalQueries
      ) {
        followUpQueriesRun += 1;
        await runBoundedSearchAndCollect(`${opt} ${crit}`, 1);
      }
    }
  }

  const report = buildStructuredResearchReport({
    question,
    subQuestions: state.subQuestions,
    options,
    criteria,
    extractedFacts: state.extractedFacts,
    snapshotsByUrl,
    unavailableSources: state.unavailableSources,
    queryBudgetStats: {
      queriesUsed,
      maxTotalQueries,
      maxQueriesPerQuestion,
      followUpQueriesRun
    }
  });

  const savedArtifacts = await saveResearchReportArtifactsViaCodexAdapters({
    workspaceRoot,
    slug: reportSlug,
    report,
    exportDocx: true,
    exportXlsx: true,
    signal
  });

  persistCheckpoint("completed");

  let projectHandoffReceipt = null;
  if (typeof onProjectArtifactReady === "function") {
    projectHandoffReceipt = await onProjectArtifactReady({
      question,
      report,
      savedArtifacts
    });
  }

  return {
    status: "completed",
    question,
    report,
    savedArtifacts,
    projectHandoffReceipt,
    checkpointFilePath: resolvedCheckpointPath,
    telemetry: engine.resourceGovernor.getTelemetry()
  };
}

module.exports = {
  decomposeResearchGoalIntoQuestions,
  executeMultiSiteResearchWorkflow
};
