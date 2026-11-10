"use strict";

const crypto = require("node:crypto");
const {
  KosworkSearchAndBrowserStore
} = require("../browser/search-pagination-and-bookmarks.cjs");
const {
  classifyComputerActionHazard,
  verifyForegroundWindowFocus
} = require("./computer-hazard-and-focus-guard.cjs");
const { saveWordReportToWorkspace } = require("../workspace/word-report-builder.cjs");
const { extractVaultDocument } = require("../vault-document-extractor.cjs");
const { executeMultiSiteResearchWorkflow } = require("../browser/research-workflow.cjs");

/**
 * Unified Multi-Domain Task Coordinator across Browser, Workspace/Vault Files, and Desktop Apps
 * (completes the end-to-end acceptance pipeline of PR #416 `KOSWORK_UNIFIED_TASK_2026-10-29_RU.md`
 * and connects the multi-site Browser Research Cycle without creating a second agent loop).
 */
class KosworkUnifiedTaskCoordinator {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot;
    this.browserStore = options.browserStore || new KosworkSearchAndBrowserStore();
    this.browserEngine = options.browserEngine || null;
    this.actionHistory = [];
  }

  appendHistoryEntry(step) {
    const prevHash =
      this.actionHistory.length > 0
        ? this.actionHistory[this.actionHistory.length - 1].entryHash
        : "0".repeat(64);

    const payload = {
      index: this.actionHistory.length + 1,
      domain: step.domain,
      action: step.action,
      status: step.status,
      detailHash: crypto
        .createHash("sha256")
        .update(JSON.stringify(step.details || {}), "utf8")
        .digest("hex"),
      prevHash,
      recordedAt: new Date().toISOString()
    };

    const entryHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload), "utf8")
      .digest("hex");

    const record = { ...payload, entryHash };
    this.actionHistory.push(record);
    return record;
  }

  /**
   * Executes a planned multi-domain task across:
   * 1. Browser search (`browser_search`)
   * 2. Optional desktop window verification (`app_focus_check`)
   * 3. Word `.docx` report creation (`workspace_write_docx`) and extraction verification
   */
  executeUnifiedResearchAndReportTask(plan) {
    if (!this.workspaceRoot) {
      throw new Error("UNIFIED_TASK_WORKSPACE_NOT_CONNECTED");
    }

    // 1. Browser domain: execute first-party search and paginate top sources
    const searchPage = this.browserStore.recordAndPaginateSearch({
      query: plan.searchQuery,
      results: plan.mockOrLiveSearchResults || [],
      page: 1,
      pageSize: 5
    });

    this.appendHistoryEntry({
      domain: "browser",
      action: "browser_search",
      status: "completed",
      details: {
        searchId: searchPage.searchId,
        navigationUrl: searchPage.navigationUrl,
        resultCount: searchPage.items.length
      }
    });

    // 2. Desktop App domain: verify hazard classification and window focus if app interaction is requested
    if (plan.desktopAction) {
      const hazard = classifyComputerActionHazard(plan.desktopAction);
      if (hazard.tier !== "safe") {
        this.appendHistoryEntry({
          domain: "desktop_app",
          action: plan.desktopAction.kind || "app_action",
          status: "blocked",
          details: { code: hazard.code }
        });
        const err = new Error(`UNIFIED_TASK_DESKTOP_BLOCKED:${hazard.code}`);
        err.code = hazard.code;
        throw err;
      }

      if (plan.expectedWindow && plan.actualForegroundWindow) {
        const focusCheck = verifyForegroundWindowFocus(
          plan.expectedWindow,
          plan.actualForegroundWindow
        );
        if (!focusCheck.ok) {
          this.appendHistoryEntry({
            domain: "desktop_app",
            action: "verify_focus",
            status: "halted",
            details: { code: focusCheck.code }
          });
          const err = new Error(`UNIFIED_TASK_FOCUS_LOST:${focusCheck.code}`);
          err.code = focusCheck.code;
          throw err;
        }
      }

      this.appendHistoryEntry({
        domain: "desktop_app",
        action: plan.desktopAction.kind || "app_action",
        status: "completed",
        details: { targetLabel: plan.desktopAction.targetLabel }
      });
    }

    // 3. Files / Workspace domain: build and save verified .docx report into bounded workspace folder
    const sourcesForDocx = searchPage.items.map((item) => ({
      title: item.title,
      url: item.url,
      quote: item.snippet
    }));

    const savedReport = saveWordReportToWorkspace({
      workspaceRoot: this.workspaceRoot,
      relativePath: plan.outputRelativePath || "reports/Unified-Task-Report.docx",
      reportSpec: {
        title: plan.reportTitle || `Отчёт по теме: ${plan.searchQuery}`,
        subtitle: `Источников проверено: ${sourcesForDocx.length}`,
        sections: plan.reportSections || [
          {
            heading: "1. Результаты исследования",
            paragraphs: sourcesForDocx.map((s) => `${s.title}: ${s.quote}`)
          }
        ],
        sources: sourcesForDocx
      }
    });

    const fs = require("node:fs");
    const verifiedExtract = extractVaultDocument(fs.readFileSync(savedReport.absolutePath), {
      filename: savedReport.relativePath
    });

    this.appendHistoryEntry({
      domain: "workspace_files",
      action: "save_word_report_docx",
      status: "completed",
      details: {
        relativePath: savedReport.relativePath,
        sha256: savedReport.sha256,
        extractedChars: verifiedExtract.totalChars
      }
    });

    return {
      status: "completed",
      searchPage,
      savedReport,
      verifiedExtract,
      historyChainLength: this.actionHistory.length,
      headHistoryHash: this.actionHistory[this.actionHistory.length - 1].entryHash
    };
  }

  /**
   * Executes the full multi-site Browser Research Cycle inside the existing Work executor
   * (question formulation -> search -> multi-site open & UTF-16 excerpt extraction ->
   * comparison & claim verification -> saving MD/HTML/comparison table via workspace APIs).
   */
  async executeBrowserResearchCycle(researchPlan, options = {}) {
    if (!this.workspaceRoot) {
      throw new Error("UNIFIED_TASK_WORKSPACE_NOT_CONNECTED");
    }

    const result = await executeMultiSiteResearchWorkflow({
      engine: options.engine || this.browserEngine,
      workspaceRoot: this.workspaceRoot,
      workspaceService: options.workspaceService || null,
      workExecutor: this,
      plan: researchPlan,
      signal: options.signal || null
    });

    return {
      ...result,
      historyChainLength: this.actionHistory.length,
      headHistoryHash:
        this.actionHistory.length > 0
          ? this.actionHistory[this.actionHistory.length - 1].entryHash
          : null
    };
  }
}

module.exports = {
  KosworkUnifiedTaskCoordinator
};
