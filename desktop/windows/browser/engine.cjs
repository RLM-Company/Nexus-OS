"use strict";

const path = require("node:path");
const {
  buildVersionedPageSnapshot,
  extractVerifiableExcerpt,
  findInPageTextOccurrences,
  readLongPageWindow
} = require("./document.cjs");
const {
  detectAuthOrCaptchaGate,
  evaluateNavigationPolicy,
  resolveAllowedDownloadTarget,
  verifyAuthorizedSiteSession,
  verifyFileSelectionPolicy
} = require("./policy.cjs");
const {
  KosworkBrowserRecoveryError,
  UserTakeoverTracker,
  verifyObservationIntegrity,
  verifyTabReceipt
} = require("./recovery.cjs");
const { KosworkBrowserResourceGovernor } = require("./resource-governor.cjs");
const { KosworkBrowserSearchService } = require("./search.cjs");
const { KosworkChromiumCdpDriver } = require("./chromium-cdp-driver.cjs");
const { verifyEvidenceAgainstSnapshotAndClaim } = require("./evidence-verifier.cjs");
const { verifyBrowserActionMutation } = require("./visual-dom-diff-verifier.cjs");

/**
 * Koswork Real Chromium CDP Browser Engine (`desktop/windows/browser/engine.cjs`).
 *
 * Implements Queue Items #2, #3, #4, #6:
 * - Uses the real Chromium CDP driver (`KosworkChromiumCdpDriver`) for HTTP/HTTPS navigation,
 *   live DOM inspection, JS execution, form interaction, scrolling, and `Page.stopLoading` cancellation.
 * - Does NOT replace Chromium with `syntheticSites` or a bare HTTP regex parser.
 * - Full tab lifecycle: `createTab`, `selectTab`, `listTabs`, `closeTab`, `goBack`, `goForward`,
 *   live-tab cap (`maxLiveTabs = 3`) with background hibernation and automatic wake on select.
 * - Stable element refs (`elementRef: "ref-1"`, `domEpoch`) and strict stale-reference rejection
 *   (`STALE_ELEMENT_REFERENCE` / `OBSERVATION_STALE_REOBSERVE_REQUIRED` / `OBSERVATION_INVALIDATED_BY_USER`).
 * - Real in-page search (`findInPage`) and long-page windowed reading (`readLongPage`) with scroll.
 * - Strict evidence verification (`verifyClaimEvidence`) where non-empty quote + hash alone does not prove a claim.
 */
class KosworkBrowserEngine {
  constructor(options = {}) {
    this.allowedWorkspaceRoot = options.allowedWorkspaceRoot
      ? path.resolve(String(options.allowedWorkspaceRoot))
      : null;
    this.allowedDownloadDir = options.allowedDownloadDir
      ? path.resolve(String(options.allowedDownloadDir))
      : this.allowedWorkspaceRoot
        ? path.join(this.allowedWorkspaceRoot, "downloads")
        : null;
    this.allowLocalLoopback = options.allowLocalLoopback !== false;
    this.allowedDomains = options.allowedDomains || null;
    this.allowedSessionIds = options.allowedSessionIds || [];

    this.cdpDriver =
      options.cdpDriver ||
      new KosworkChromiumCdpDriver({
        chromiumPath: options.chromiumPath || "/usr/bin/chromium"
      });

    this.resourceGovernor =
      options.resourceGovernor ||
      new KosworkBrowserResourceGovernor({
        maxLiveTabs: options.maxLiveTabs ?? 3,
        snapshotTtlMs: options.snapshotTtlMs ?? 30000
      });

    this.userTakeover = options.userTakeover || new UserTakeoverTracker();
    this.tabs = new Map(); // tabId -> tabState
    this.tabNavigationStacks = new Map(); // tabId -> { entries: [url], index }
    this.activeTabId = null;
    this.nextTabCounter = 1;

    this.searchService =
      options.searchService ||
      new KosworkBrowserSearchService({
        adapterOptions: options.searchAdapterOptions || {}
      });
    this.searchService.attachEngine(this);
  }

  allocateTabId(requestedTabId = null) {
    if (requestedTabId && String(requestedTabId).trim()) {
      return String(requestedTabId).trim();
    }
    const id = `tab-${this.nextTabCounter}`;
    this.nextTabCounter += 1;
    return id;
  }

  listTabs() {
    return Array.from(this.tabs.values()).map((t) => ({
      tabId: t.tabId,
      url: t.url,
      title: t.snapshot?.title || t.url,
      active: t.tabId === this.activeTabId,
      closed: Boolean(t.closed),
      hibernated: Boolean(t.hibernated),
      pageVersion: t.pageVersion,
      domEpoch: t.snapshot?.domEpoch ?? 1,
      httpStatus: t.httpStatus
    }));
  }

  async selectTab(tabId, { signal = null } = {}) {
    const id = String(tabId || "");
    const tab = this.tabs.get(id);
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError(
        "TAB_LOST_OR_CLOSED",
        `Невозможно выбрать закрытую или несуществующую вкладку "${id}".`
      );
    }
    this.activeTabId = id;
    if (tab.hibernated) {
      // Wake hibernated tab in real Chromium
      await this.navigate({
        tabId: id,
        url: tab.url,
        signal,
        _fromHistoryTraversal: true
      });
    }
    return {
      tabId: id,
      active: true,
      url: tab.url,
      pageVersion: tab.pageVersion,
      snapshot: tab.snapshot
    };
  }

  async navigate({
    tabId = null,
    url,
    actor = "agent",
    signal = null,
    timeoutMs = 6000,
    requiresAuthenticatedSession = false,
    sessionId = null,
    initiatedBySearchId = null,
    initiatedByRank = null,
    _fromHistoryTraversal = false
  } = {}) {
    verifyAuthorizedSiteSession({
      requiresAuthenticatedSession,
      requestedSessionId: sessionId,
      allowedSessionIds: this.allowedSessionIds
    });

    const resolvedTabId = this.allocateTabId(tabId);
    const task = this.resourceGovernor.beginTask(
      `nav-${resolvedTabId}-${Date.now()}`,
      "navigate",
      signal
    );

    try {
      if (task.controller.signal.aborted) {
        const err = new Error("BROWSER_NAVIGATION_CANCELLED");
        err.code = "BROWSER_NAVIGATION_CANCELLED";
        throw err;
      }

      const navPolicy = evaluateNavigationPolicy(url, {
        allowLocalLoopback: this.allowLocalLoopback,
        allowedDomains: this.allowedDomains
      });
      const normalizedUrl = navPolicy.normalizedUrl;

      const prevTab = this.tabs.get(resolvedTabId);
      const nextVersion = prevTab ? prevTab.pageVersion + 1 : 1;
      const fetchedAt = new Date().toISOString();

      if (actor === "user") {
        this.userTakeover.recordUserAction(resolvedTabId, {
          type: "user_navigate",
          detail: { url: normalizedUrl }
        });
      }

      const rawPageData = await this.cdpDriver.navigateTab(resolvedTabId, normalizedUrl, {
        signal: task.controller.signal,
        timeoutMs
      });

      const snapshot = buildVersionedPageSnapshot(rawPageData, {
        tabId: resolvedTabId,
        pageVersion: nextVersion,
        url: normalizedUrl,
        fetchedAt
      });
      snapshot.userEpoch = this.userTakeover.getCurrentEpoch(resolvedTabId);

      const authGate = detectAuthOrCaptchaGate(snapshot);
      const available =
        snapshot.httpStatus >= 200 && snapshot.httpStatus < 400 && !rawPageData.networkError;

      const tabState = {
        tabId: resolvedTabId,
        url: normalizedUrl,
        pageVersion: nextVersion,
        httpStatus: snapshot.httpStatus,
        available,
        networkError: rawPageData.networkError || null,
        closed: false,
        hibernated: false,
        snapshot,
        lastObservation: snapshot,
        selectedFiles: new Map(),
        authGate,
        initiatedBySearchId,
        initiatedByRank
      };

      this.tabs.set(resolvedTabId, tabState);
      this.activeTabId = resolvedTabId;
      this.resourceGovernor.cacheSnapshot(snapshot);

      if (!_fromHistoryTraversal) {
        if (!this.tabNavigationStacks.has(resolvedTabId)) {
          this.tabNavigationStacks.set(resolvedTabId, { entries: [], index: -1 });
        }
        const stack = this.tabNavigationStacks.get(resolvedTabId);
        stack.entries = stack.entries.slice(0, stack.index + 1);
        stack.entries.push(normalizedUrl);
        stack.index = stack.entries.length - 1;
      }

      const governorState = this.resourceGovernor.touchLiveTab(
        resolvedTabId,
        tabState,
        (hibernatedId) => {
          const bgTab = this.tabs.get(hibernatedId);
          if (bgTab && !bgTab.closed) {
            bgTab.hibernated = true;
            this.cdpDriver.closeTabSession(hibernatedId).catch(() => {});
          }
        }
      );

      this.resourceGovernor.sampleProcessMemory(`after_nav_${resolvedTabId}`);
      const latencyMs = task.finish();

      if (authGate.gated) {
        return {
          status: "paused_for_user",
          code: authGate.code,
          gateType: authGate.gateType,
          reason: authGate.reason,
          tabId: resolvedTabId,
          url: normalizedUrl,
          title: snapshot.title,
          httpStatus: snapshot.httpStatus,
          available,
          pageVersion: snapshot.pageVersion,
          domEpoch: snapshot.domEpoch,
          pageDate: snapshot.pageDate,
          eventDate: snapshot.eventDate,
          fetchedAt: snapshot.fetchedAt,
          tabReceipt: snapshot.tabReceipt,
          snapshot,
          governorState,
          latencyMs
        };
      }

      return {
        status: available ? "ok" : "unavailable",
        tabId: resolvedTabId,
        url: normalizedUrl,
        title: snapshot.title,
        httpStatus: snapshot.httpStatus,
        available,
        networkError: rawPageData.networkError || null,
        pageVersion: snapshot.pageVersion,
        domEpoch: snapshot.domEpoch,
        pageDate: snapshot.pageDate,
        eventDate: snapshot.eventDate,
        fetchedAt: snapshot.fetchedAt,
        tabReceipt: snapshot.tabReceipt,
        snapshot,
        governorState,
        latencyMs
      };
    } catch (err) {
      task.finish();
      throw err;
    }
  }

  async goBack(tabId, { signal = null } = {}) {
    const id = String(tabId || this.activeTabId || "");
    const stack = this.tabNavigationStacks.get(id);
    if (!stack || stack.index <= 0) {
      const err = new Error(`BROWSER_HISTORY_BOUNDS: Нет предыдущей страницы во вкладке "${id}".`);
      err.code = "BROWSER_HISTORY_BOUNDS";
      throw err;
    }
    stack.index -= 1;
    const prevUrl = stack.entries[stack.index];
    return await this.navigate({
      tabId: id,
      url: prevUrl,
      signal,
      _fromHistoryTraversal: true
    });
  }

  async goForward(tabId, { signal = null } = {}) {
    const id = String(tabId || this.activeTabId || "");
    const stack = this.tabNavigationStacks.get(id);
    if (!stack || stack.index >= stack.entries.length - 1) {
      const err = new Error(`BROWSER_HISTORY_BOUNDS: Нет следующей страницы во вкладке "${id}".`);
      err.code = "BROWSER_HISTORY_BOUNDS";
      throw err;
    }
    stack.index += 1;
    const nextUrl = stack.entries[stack.index];
    return await this.navigate({
      tabId: id,
      url: nextUrl,
      signal,
      _fromHistoryTraversal: true
    });
  }

  getTabHistory(tabId) {
    const id = String(tabId || this.activeTabId || "");
    const stack = this.tabNavigationStacks.get(id) || { entries: [], index: -1 };
    return {
      tabId: id,
      entries: [...stack.entries],
      currentIndex: stack.index,
      canGoBack: stack.index > 0,
      canGoForward: stack.index >= 0 && stack.index < stack.entries.length - 1
    };
  }

  /**
   * Captures a fresh observation from live Chromium DOM (`fresh: true` by default)
   * or reuses a valid cached snapshot if `reuseSnapshot === true` and DOM has not mutated.
   */
  async observePage(tabId, { reuseSnapshot = false } = {}) {
    const id = String(tabId || this.activeTabId || "");
    const tab = this.tabs.get(id);
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError(
        "TAB_LOST_OR_CLOSED",
        `Невозможно наблюдать закрытую или несуществующую вкладку "${id}".`
      );
    }

    if (reuseSnapshot && !tab.hibernated) {
      const cached = this.resourceGovernor.getValidCachedSnapshot(tab.url);
      if (cached && cached.pageVersion === tab.pageVersion) {
        tab.lastObservation = cached;
        return {
          reusedCachedSnapshot: true,
          tabId: id,
          snapshot: cached,
          tabReceipt: cached.tabReceipt
        };
      }
    }

    if (!tab.hibernated) {
      const liveDom = await this.cdpDriver.inspectTabDom(id, { requestedUrl: tab.url });
      const prevEpoch = tab.snapshot?.domEpoch ?? 1;
      const liveEpoch = liveDom.domEpoch ?? 1;
      const nextVer = liveEpoch !== prevEpoch ? tab.pageVersion + 1 : tab.pageVersion;
      const freshSnapshot = buildVersionedPageSnapshot(liveDom, {
        tabId: id,
        pageVersion: nextVer,
        url: tab.url,
        fetchedAt: new Date().toISOString()
      });
      freshSnapshot.userEpoch = this.userTakeover.getCurrentEpoch(id);
      tab.pageVersion = nextVer;
      tab.snapshot = freshSnapshot;
      tab.lastObservation = freshSnapshot;
      this.resourceGovernor.cacheSnapshot(freshSnapshot);
    }

    return {
      reusedCachedSnapshot: false,
      tabId: id,
      snapshot: tab.snapshot,
      tabReceipt: tab.snapshot.tabReceipt
    };
  }

  findInPage(tabId, query, options = {}) {
    const tab = this.tabs.get(String(tabId || this.activeTabId));
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError("TAB_LOST_OR_CLOSED", `Вкладка "${tabId}" недоступна.`);
    }
    return findInPageTextOccurrences(tab.snapshot, query, options);
  }

  extractExcerpt(tabId, options = {}) {
    const tab = this.tabs.get(String(tabId || this.activeTabId));
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError("TAB_LOST_OR_CLOSED", `Вкладка "${tabId}" недоступна.`);
    }
    return extractVerifiableExcerpt(tab.snapshot, options);
  }

  verifyClaimEvidence({
    tabId,
    excerpt,
    optionName = "",
    criterion = "",
    claimedValue = ""
  } = {}) {
    const tab = this.tabs.get(String(tabId || this.activeTabId));
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError("TAB_LOST_OR_CLOSED", `Вкладка "${tabId}" недоступна.`);
    }
    return verifyEvidenceAgainstSnapshotAndClaim({
      snapshot: tab.snapshot,
      excerpt,
      optionName,
      criterion,
      claimedValue
    });
  }

  async readLongPage({
    tabId,
    cursorUtf16 = 0,
    windowChars = 4000,
    overlapChars = 120,
    scrollInChromium = true,
    signal = null
  } = {}) {
    if (signal?.aborted) {
      const err = new Error("LONG_PAGE_READ_CANCELLED");
      err.code = "LONG_PAGE_READ_CANCELLED";
      throw err;
    }

    const id = String(tabId || this.activeTabId || "");
    const tab = this.tabs.get(id);
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError("TAB_LOST_OR_CLOSED", `Вкладка "${id}" потеряна.`);
    }

    if (scrollInChromium && !tab.hibernated) {
      const approxScrollY = Math.floor(cursorUtf16 / 4);
      const liveDom = await this.cdpDriver.scrollTabTo(id, approxScrollY);
      if ((liveDom.text || "").length > (tab.snapshot.fullTextUtf16 || "").length) {
        tab.pageVersion += 1;
        tab.snapshot = buildVersionedPageSnapshot(liveDom, {
          tabId: id,
          pageVersion: tab.pageVersion,
          url: tab.url,
          fetchedAt: new Date().toISOString()
        });
        tab.snapshot.userEpoch = this.userTakeover.getCurrentEpoch(id);
        tab.lastObservation = tab.snapshot;
      }
    }

    return readLongPageWindow(tab.snapshot, {
      cursorUtf16,
      windowChars,
      overlapChars
    });
  }

  recordUserAction(tabId, action = {}) {
    return this.userTakeover.recordUserAction(tabId, action);
  }

  async fillForm({
    tabId,
    observedSnapshot = null,
    tabReceipt = null,
    fields = {},
    elementRefs = {}
  } = {}) {
    const id = String(tabId || this.activeTabId || "");
    const tab = this.tabs.get(id);
    if (tabReceipt) {
      verifyTabReceipt(tabReceipt, tab);
    } else if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError("TAB_LOST_OR_CLOSED", `Вкладка "${id}" потеряна.`);
    }

    if (tab.authGate && tab.authGate.gated) {
      return {
        status: "paused_for_user",
        code: tab.authGate.code,
        reason: tab.authGate.reason,
        gateType: tab.authGate.gateType
      };
    }

    // Sync live DOM epoch from Chromium first to catch any in-page JS mutation since observePage
    const liveCheck = await this.cdpDriver.inspectTabDom(id, { requestedUrl: tab.url });
    if (liveCheck.domEpoch && tab.snapshot.domEpoch && liveCheck.domEpoch !== tab.snapshot.domEpoch) {
      tab.pageVersion += 1;
      tab.snapshot = buildVersionedPageSnapshot(liveCheck, {
        tabId: id,
        pageVersion: tab.pageVersion,
        url: tab.url,
        fetchedAt: new Date().toISOString()
      });
    }

    const obs = observedSnapshot || tab.lastObservation;
    verifyObservationIntegrity({
      observedSnapshot: obs,
      currentSnapshot: tab.snapshot,
      userTakeoverTracker: this.userTakeover
    });

    const preNodes = tab.snapshot.controls.map((c) => ({
      id: c.id,
      tag: c.tag,
      role: c.role,
      text: c.label,
      value: c.value,
      checked: c.checked,
      visible: true,
      disabled: c.disabled,
      bbox: c.bounds
    }));

    for (const [key, val] of Object.entries(fields || {})) {
      const explicitRef = elementRefs[key] || (key.startsWith("ref-") ? key : null);
      await this.cdpDriver.executeDomInteraction(id, {
        elementRef: explicitRef,
        controlId: explicitRef ? null : key,
        expectedDomEpoch: obs.domEpoch,
        action: "fill",
        value: val
      });
    }

    const postDom = await this.cdpDriver.inspectTabDom(id, { requestedUrl: tab.url });
    tab.pageVersion += 1;
    const updatedSnapshot = buildVersionedPageSnapshot(postDom, {
      tabId: id,
      pageVersion: tab.pageVersion,
      url: tab.url,
      fetchedAt: new Date().toISOString()
    });
    updatedSnapshot.userEpoch = this.userTakeover.getCurrentEpoch(id);
    tab.snapshot = updatedSnapshot;
    tab.lastObservation = updatedSnapshot;

    const postNodes = updatedSnapshot.controls.map((c) => ({
      id: c.id,
      tag: c.tag,
      role: c.role,
      text: c.label,
      value: c.value,
      checked: c.checked,
      visible: true,
      disabled: c.disabled,
      bbox: c.bounds
    }));

    const domDiff = verifyBrowserActionMutation(
      { url: tab.url, title: obs.title, nodes: preNodes },
      { url: tab.url, title: updatedSnapshot.title, nodes: postNodes },
      { type: "fill_form" }
    );

    return {
      status: "ok",
      tabId: id,
      pageVersion: updatedSnapshot.pageVersion,
      domEpoch: updatedSnapshot.domEpoch,
      tabReceipt: updatedSnapshot.tabReceipt,
      snapshot: updatedSnapshot,
      domVerification: domDiff
    };
  }

  selectFiles({
    tabId,
    controlId,
    filePaths = [],
    observedSnapshot = null
  } = {}) {
    const id = String(tabId || this.activeTabId || "");
    const tab = this.tabs.get(id);
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError("TAB_LOST_OR_CLOSED", `Вкладка "${id}" потеряна.`);
    }

    const obs = observedSnapshot || tab.lastObservation;
    verifyObservationIntegrity({
      observedSnapshot: obs,
      currentSnapshot: tab.snapshot,
      targetSpec: { controlId },
      userTakeoverTracker: this.userTakeover
    });

    const verifiedFiles = [];
    for (const candidatePath of filePaths) {
      const checked = verifyFileSelectionPolicy(candidatePath, {
        allowedWorkspaceRoot: this.allowedWorkspaceRoot
      });
      verifiedFiles.push(checked);
    }

    tab.selectedFiles.set(String(controlId), verifiedFiles);
    return {
      status: "ok",
      tabId: id,
      controlId,
      attachedFiles: verifiedFiles
    };
  }

  async submitForm({
    tabId,
    submitControlId = null,
    submitElementRef = null,
    observedSnapshot = null
  } = {}) {
    const id = String(tabId || this.activeTabId || "");
    const tab = this.tabs.get(id);
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError("TAB_LOST_OR_CLOSED", `Вкладка "${id}" потеряна.`);
    }

    if (tab.authGate && tab.authGate.gated) {
      return {
        status: "paused_for_user",
        code: tab.authGate.code,
        reason: tab.authGate.reason,
        gateType: tab.authGate.gateType
      };
    }

    const obs = observedSnapshot || tab.lastObservation;
    verifyObservationIntegrity({
      observedSnapshot: obs,
      currentSnapshot: tab.snapshot,
      targetSpec: { controlId: submitControlId, elementRef: submitElementRef },
      userTakeoverTracker: this.userTakeover
    });

    const preNodes = tab.snapshot.controls.map((c) => ({
      id: c.id,
      tag: c.tag,
      role: c.role,
      text: c.label,
      value: c.value,
      checked: c.checked,
      visible: true,
      disabled: c.disabled,
      bbox: c.bounds
    }));

    const postDom = await this.cdpDriver.executeDomInteraction(id, {
      elementRef: submitElementRef,
      controlId: submitControlId,
      expectedDomEpoch: obs.domEpoch,
      action: "submit"
    });

    tab.pageVersion += 1;
    const updatedSnapshot = buildVersionedPageSnapshot(postDom, {
      tabId: id,
      pageVersion: tab.pageVersion,
      url: postDom.url || tab.url,
      fetchedAt: new Date().toISOString()
    });
    updatedSnapshot.userEpoch = this.userTakeover.getCurrentEpoch(id);
    tab.snapshot = updatedSnapshot;
    tab.lastObservation = updatedSnapshot;

    const postNodes = updatedSnapshot.controls.map((c) => ({
      id: c.id,
      tag: c.tag,
      role: c.role,
      text: c.label,
      value: c.value,
      checked: c.checked,
      visible: true,
      disabled: c.disabled,
      bbox: c.bounds
    }));

    const domVerification = verifyBrowserActionMutation(
      { url: obs.url, title: obs.title, nodes: preNodes },
      { url: updatedSnapshot.url, title: updatedSnapshot.title, nodes: postNodes },
      { type: "submit_form", targetId: submitControlId || submitElementRef || "form" }
    );

    return {
      status: "ok",
      tabId: id,
      pageVersion: updatedSnapshot.pageVersion,
      domEpoch: updatedSnapshot.domEpoch,
      snapshot: updatedSnapshot,
      domVerification
    };
  }

  async closeTab(tabId) {
    const id = String(tabId || "");
    const tab = this.tabs.get(id);
    if (!tab) return { closed: false, tabId: id };
    tab.closed = true;
    this.resourceGovernor.removeTab(id);
    await this.cdpDriver.closeTabSession(id);
    if (this.activeTabId === id) {
      const remaining = Array.from(this.tabs.values()).find((t) => !t.closed);
      this.activeTabId = remaining ? remaining.tabId : null;
    }
    return { closed: true, tabId: id };
  }

  async shutdown() {
    await this.cdpDriver.shutdown();
  }
}

module.exports = {
  KosworkBrowserEngine,
  resolveAllowedDownloadTarget
};
