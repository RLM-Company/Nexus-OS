"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeAtomicJson, readJsonFileSafe } = require("../desktop-state.cjs");

/**
 * Koswork Multi-Tab Crash-Recovery & Hibernated Workspace Session Restorer
 * (`desktop/windows/browser/tab-workspace-session-restorer.cjs`).
 *
 * Deepens Requirement #3, #6 & #7:
 * 1. Tracks closed or crashed tabs in a bounded ring buffer (`closedTabsHistory`)
 *    and supports `reopenLastClosedTab()` (`Ctrl+Shift+T`), restoring the exact URL,
 *    navigation history stack, and versioned snapshot.
 * 2. Saves and restores the entire multi-tab browser session (`saveBrowserSessionToDisk`,
 *    `restoreBrowserSessionFromDisk`) while strictly respecting `engine.resourceGovernor.maxLiveTabs`
 *    (default `3`): only the most recent `maxLiveTabs` tabs are restored as live, and
 *    all remaining tabs are restored in hibernated state (`hibernated: true`) so restoring
 *    a large research session never exceeds the live tab RAM cap!
 */
class KosworkTabWorkspaceSessionRestorer {
  constructor(options = {}) {
    if (!options.engine) {
      throw new Error("TAB_SESSION_RESTORER_REQUIRES_ENGINE");
    }
    this.engine = options.engine;
    this.workspaceRoot = path.resolve(
      options.workspaceRoot || this.engine.allowedWorkspaceRoot || process.cwd()
    );
    this.stateDir = path.join(this.workspaceRoot, ".koswork-research");
    fs.mkdirSync(this.stateDir, { recursive: true });
    this.sessionFilePath = path.join(this.stateDir, "tab-workspace-session.json");
    this.maxClosedHistory = Math.max(1, Number(options.maxClosedHistory ?? 10));
    this.closedTabsHistory = [];
  }

  /**
   * Closes a tab and records its last known snapshot and navigation history stack
   * so it can be recovered via `reopenLastClosedTab()`.
   */
  closeAndRecordTab(tabId, reason = "user_or_crash_close") {
    const key = String(tabId);
    const tab = this.engine.tabs.get(key);
    if (!tab || tab.closed) {
      return { closed: false, tabId: key };
    }

    const navStack = this.engine.tabNavigationStacks.get(key) || {
      entries: [tab.url],
      index: 0
    };

    const closedRecord = {
      tabId: key,
      url: tab.url,
      title: tab.snapshot?.title || tab.url,
      pageVersion: tab.pageVersion,
      pageDate: tab.snapshot?.pageDate || null,
      eventDate: tab.snapshot?.eventDate || null,
      fetchedAt: tab.snapshot?.fetchedAt || null,
      fullTextUtf16: tab.snapshot?.fullTextUtf16 || "",
      navigationStack: {
        entries: [...navStack.entries],
        index: navStack.index
      },
      closedReason: reason,
      closedAt: new Date().toISOString()
    };

    this.closedTabsHistory.push(closedRecord);
    if (this.closedTabsHistory.length > this.maxClosedHistory) {
      this.closedTabsHistory.shift();
    }

    this.engine.closeTab(key);
    return {
      closed: true,
      tabId: key,
      closedRecord
    };
  }

  async reopenLastClosedTab() {
    if (this.closedTabsHistory.length === 0) {
      const err = new Error("NO_CLOSED_TABS_TO_REOPEN");
      err.code = "NO_CLOSED_TABS_TO_REOPEN";
      throw err;
    }

    const last = this.closedTabsHistory.pop();
    if (!this.engine.syntheticSites.has(last.url) && last.fullTextUtf16) {
      this.engine.registerSyntheticSite(last.url, {
        title: last.title,
        pageDate: last.pageDate,
        eventDate: last.eventDate,
        text: last.fullTextUtf16
      });
    }

    const nav = await this.engine.navigate({
      tabId: last.tabId,
      url: last.url,
      actor: "user"
    });

    if (last.navigationStack && Array.isArray(last.navigationStack.entries)) {
      this.engine.tabNavigationStacks.set(last.tabId, {
        entries: [...last.navigationStack.entries],
        index: last.navigationStack.index
      });
    }

    return {
      reopened: true,
      tabId: nav.tabId,
      url: nav.url,
      pageVersion: nav.snapshot.pageVersion,
      tabReceipt: nav.tabReceipt,
      snapshot: nav.snapshot,
      remainingClosedHistoryCount: this.closedTabsHistory.length
    };
  }

  saveBrowserSessionToDisk() {
    const openTabs = [];
    for (const [tabId, tab] of this.engine.tabs.entries()) {
      if (tab.closed) continue;
      const navStack = this.engine.tabNavigationStacks.get(tabId) || {
        entries: [tab.url],
        index: 0
      };
      openTabs.push({
        tabId,
        url: tab.url,
        title: tab.snapshot?.title || tab.url,
        pageVersion: tab.pageVersion,
        hibernated: Boolean(tab.hibernated),
        pageDate: tab.snapshot?.pageDate || null,
        eventDate: tab.snapshot?.eventDate || null,
        fetchedAt: tab.snapshot?.fetchedAt || null,
        fullTextUtf16: tab.snapshot?.fullTextUtf16 || "",
        navigationStack: navStack
      });
    }

    const payload = {
      schemaVersion: "koswork.browser-research.tab-session.v1",
      savedAt: new Date().toISOString(),
      maxLiveTabs: this.engine.resourceGovernor.maxLiveTabs,
      openTabs,
      closedTabsHistory: this.closedTabsHistory
    };

    writeAtomicJson(this.sessionFilePath, payload);
    return {
      filePath: this.sessionFilePath,
      savedTabsCount: openTabs.length,
      closedHistoryCount: this.closedTabsHistory.length
    };
  }

  async restoreBrowserSessionFromDisk(targetEngine = this.engine) {
    const data = readJsonFileSafe(this.sessionFilePath, null);
    if (!data || !Array.isArray(data.openTabs)) {
      return { restored: false, restoredTabsCount: 0 };
    }

    for (const item of data.openTabs) {
      if (!targetEngine.syntheticSites.has(item.url) && item.fullTextUtf16) {
        targetEngine.registerSyntheticSite(item.url, {
          title: item.title,
          pageDate: item.pageDate,
          eventDate: item.eventDate,
          text: item.fullTextUtf16
        });
      }
      await targetEngine.navigate({
        tabId: item.tabId,
        url: item.url,
        actor: "agent"
      });
      if (item.navigationStack) {
        targetEngine.tabNavigationStacks.set(item.tabId, item.navigationStack);
      }
    }

    this.closedTabsHistory = Array.isArray(data.closedTabsHistory)
      ? [...data.closedTabsHistory]
      : [];

    const report = targetEngine.resourceGovernor.getResourceReport();
    return {
      restored: true,
      restoredTabsCount: data.openTabs.length,
      liveTabCount: report.liveTabCount,
      hibernatedTabCount: report.hibernatedTabCount,
      maxLiveTabs: report.maxLiveTabs
    };
  }
}

module.exports = {
  KosworkTabWorkspaceSessionRestorer
};
