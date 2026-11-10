"use strict";

const { KosworkBrowserEngine } = require("./engine.cjs");
const {
  decomposeResearchGoalIntoQuestions,
  executeMultiSiteResearchWorkflow
} = require("./research-workflow.cjs");

/**
 * Browser Shell Integration Adapter for Main / Native Host (`desktop/windows/browser/shell.cjs`).
 *
 * Kept in a separate integration commit (`INTEGRATION.md`) so Codex/OpenCode can wire
 * the real Chromium CDP engine and Deep Research workflow into Electron main / native host
 * without conflicting with core Windows main or chat/sidebar code.
 */
class KosworkBrowserShellHost {
  constructor(options = {}) {
    this.engine = options.engine || new KosworkBrowserEngine(options);
    this.workspaceRoot = options.allowedWorkspaceRoot || options.workspaceRoot || null;
  }

  async handleShellCommand(command, payload = {}, { signal = null } = {}) {
    switch (command) {
      case "browser:list-tabs":
        return { ok: true, tabs: this.engine.listTabs() };
      case "browser:select-tab":
        return { ok: true, ...(await this.engine.selectTab(payload.tabId, { signal })) };
      case "browser:navigate":
        return await this.engine.navigate({ ...payload, signal });
      case "browser:back":
        return await this.engine.goBack(payload.tabId, { signal });
      case "browser:forward":
        return await this.engine.goForward(payload.tabId, { signal });
      case "browser:observe":
        return await this.engine.observePage(payload.tabId, {
          reuseSnapshot: Boolean(payload.reuseSnapshot)
        });
      case "browser:find-in-page":
        return this.engine.findInPage(payload.tabId, payload.query, payload.options || {});
      case "browser:read-long-page":
        return await this.engine.readLongPage({ ...payload, signal });
      case "browser:fill-form":
        return await this.engine.fillForm(payload);
      case "browser:select-files":
        return this.engine.selectFiles(payload);
      case "browser:submit-form":
        return await this.engine.submitForm(payload);
      case "browser:search":
        return await this.engine.searchService.search({ ...payload, signal });
      case "browser:open-search-result":
        return await this.engine.searchService.openSearchResult({ ...payload, signal });
      case "browser:deep-research":
        return await executeMultiSiteResearchWorkflow({
          engine: this.engine,
          workspaceRoot: payload.workspaceRoot || this.workspaceRoot,
          question: payload.question,
          options: payload.options,
          criteria: payload.criteria,
          extractionRules: payload.extractionRules,
          maxQueriesPerQuestion: payload.maxQueriesPerQuestion,
          maxTotalQueries: payload.maxTotalQueries,
          maxSerpPages: payload.maxSerpPages,
          reportSlug: payload.reportSlug,
          checkpointFilePath: payload.checkpointFilePath,
          resumeFromCheckpoint: Boolean(payload.resumeFromCheckpoint),
          onProjectArtifactReady: payload.onProjectArtifactReady || null,
          signal
        });
      case "browser:close-tab":
        return await this.engine.closeTab(payload.tabId);
      case "browser:shutdown":
        await this.engine.shutdown();
        return { ok: true };
      default: {
        const err = new Error(`UNKNOWN_BROWSER_SHELL_COMMAND: ${command}`);
        err.code = "UNKNOWN_BROWSER_SHELL_COMMAND";
        throw err;
      }
    }
  }
}

module.exports = {
  KosworkBrowserShellHost,
  decomposeResearchGoalIntoQuestions
};
