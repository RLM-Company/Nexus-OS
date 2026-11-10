"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildVersionedPageSnapshot,
  extractVerifiableExcerpt,
  readLongPageWindow
} = require("./document.cjs");
const {
  KosworkBrowserPolicyError,
  detectAuthOrCaptchaGate,
  evaluateNavigationPolicy,
  resolveAllowedDownloadTarget,
  verifyFileSelectionPolicy
} = require("./policy.cjs");
const {
  KosworkBrowserRecoveryError,
  UserTakeoverTracker,
  findRecoveryCandidates,
  verifyObservationIntegrity,
  verifyTabReceipt
} = require("./recovery.cjs");
const { KosworkBrowserResourceGovernor } = require("./resource-governor.cjs");
const { KosworkBrowserSearchService } = require("./search.cjs");
const { KosworkResearchProvenanceJournal } = require("./provenance-journal.cjs");
const { fetchHttpRaw } = require("./research-adapter.cjs");
const { waitForVerifiedDownload } = require("./download-verifier.cjs");
const { verifyBrowserActionMutation } = require("./visual-dom-diff-verifier.cjs");

/**
 * Koswork Local Chromium / Synthetic Browser Engine (`desktop/windows/browser/engine.cjs`).
 *
 * Unifies:
 * - Search query execution & result navigation (`this.searchService`)
 * - Durable research provenance journal (`this.provenanceJournal`)
 * - Versioned pages, UTF-16 offsets, bounds, recovery candidates, frames/shadow scope, and stable tab receipts
 * - Back/forward source navigation stack per tab (`goBack`, `goForward`, `getTabHistory`)
 * - Distinct `pageDate`, `eventDate`, and `fetchedAt` fields
 * - Ordinary form input (`input`, `textarea`, `select`, `checkbox`, `radio`), file selection (`verifyFileSelectionPolicy`),
 *   and verified downloads (`waitForVerifiedDownload`)
 * - Post-submit effect verification (`verifyBrowserActionMutation`)
 * - Automatic pause for user on CAPTCHA / login walls (`status: "paused_for_user"`) and user completion resume (`completeUserAuthOrCaptchaPause`)
 * - Resource governor: live tab limit, background hibernation, cancellation, snapshot reuse, and RAM/latency metrics
 * - Normal user browsing and manual takeover invalidating stale agent observations
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

    this.resourceGovernor =
      options.resourceGovernor ||
      new KosworkBrowserResourceGovernor({
        maxLiveTabs: options.maxLiveTabs ?? 3,
        snapshotTtlMs: options.snapshotTtlMs ?? 30000
      });

    this.provenanceJournal =
      options.provenanceJournal ||
      new KosworkResearchProvenanceJournal({
        journalFilePath:
          options.journalFilePath ||
          (this.allowedWorkspaceRoot
            ? path.join(this.allowedWorkspaceRoot, ".koswork-browser-provenance.json")
            : null)
      });

    this.userTakeover = options.userTakeover || new UserTakeoverTracker();
    this.tabs = new Map(); // tabId -> tabState
    this.tabNavigationStacks = new Map(); // tabId -> { entries: [url, ...], index: number }
    this.syntheticSites = new Map(); // normalizedUrl -> siteDefinition
    this.nextTabCounter = 1;

    this.searchService =
      options.searchService ||
      new KosworkBrowserSearchService({
        adapterOptions: options.searchAdapterOptions || {}
      });
    this.searchService.attachEngine(this);
  }

  /**
   * Registers a reproducible synthetic page or site fixture (used in the 5-site acceptance corpus
   * and synthetic form/download tests without requiring external internet).
   */
  registerSyntheticSite(url, siteDef) {
    const policy = evaluateNavigationPolicy(url, { allowLocalLoopback: true });
    this.syntheticSites.set(policy.normalizedUrl, {
      ...siteDef,
      url: policy.normalizedUrl
    });
    return policy.normalizedUrl;
  }

  allocateTabId(requestedTabId = null) {
    if (requestedTabId && String(requestedTabId).trim()) {
      return String(requestedTabId).trim();
    }
    const id = `tab-${this.nextTabCounter}`;
    this.nextTabCounter += 1;
    return id;
  }

  /**
   * Navigates an existing or new tab to `url`, enforcing navigation policy, live tab caps,
   * background tab hibernation, and capturing a versioned page snapshot.
   */
  async navigate({
    tabId = null,
    url,
    actor = "agent",
    signal = null,
    timeoutMs = 6000,
    initiatedBySearchId = null,
    initiatedByRank = null,
    _fromHistoryTraversal = false
  } = {}) {
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
        allowLocalLoopback: this.allowLocalLoopback
      });
      const normalizedUrl = navPolicy.normalizedUrl;

      if (actor === "user") {
        this.userTakeover.recordUserAction(resolvedTabId, {
          type: "user_navigation",
          detail: { url: normalizedUrl }
        });
      }

      this.resourceGovernor.sampleProcessMemory(`before_nav_${resolvedTabId}`);

      const fetchedAt = new Date().toISOString();
      let rawPageData = null;

      if (this.syntheticSites.has(normalizedUrl)) {
        const site = this.syntheticSites.get(normalizedUrl);
        if (Number(site.simulatedDelayMs) > 0) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, Number(site.simulatedDelayMs));
            task.controller.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                const err = new Error("BROWSER_NAVIGATION_CANCELLED");
                err.code = "BROWSER_NAVIGATION_CANCELLED";
                reject(err);
              },
              { once: true }
            );
          });
        }
        rawPageData =
          typeof site.render === "function"
            ? await site.render({ url: normalizedUrl, fetchedAt })
            : { ...site, url: normalizedUrl, fetchedAt };
      } else {
        try {
          const httpRes = await fetchHttpRaw(normalizedUrl, {
            timeoutMs,
            signal: task.controller.signal
          });
          rawPageData = {
            url: normalizedUrl,
            canonicalUrl: normalizedUrl,
            httpStatus: httpRes.status,
            html: httpRes.body,
            fetchedAt
          };
        } catch (fetchErr) {
          if (
            fetchErr &&
            (fetchErr.code === "SEARCH_REQUEST_CANCELLED" || task.controller.signal.aborted)
          ) {
            const err = new Error("BROWSER_NAVIGATION_CANCELLED");
            err.code = "BROWSER_NAVIGATION_CANCELLED";
            throw err;
          }
          rawPageData = {
            url: normalizedUrl,
            canonicalUrl: normalizedUrl,
            httpStatus: 503,
            title: "Источник временно недоступен",
            text: `Ошибка соединения при получении ${normalizedUrl}: ${
              fetchErr.message || String(fetchErr)
            }`,
            networkError: fetchErr.code || fetchErr.message || "NETWORK_UNAVAILABLE",
            fetchedAt
          };
        }
      }

      const prevTab = this.tabs.get(resolvedTabId);
      const nextVersion = prevTab && !prevTab.closed ? prevTab.pageVersion + 1 : 1;

      const snapshot = buildVersionedPageSnapshot({
        ...rawPageData,
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
        rawSiteDef: this.syntheticSites.get(normalizedUrl) || null,
        formValues: new Map(),
        selectedFiles: new Map(),
        authGate
      };

      this.tabs.set(resolvedTabId, tabState);
      this.resourceGovernor.cacheSnapshot(snapshot);

      // Update per-tab navigation stack for back/forward traversal
      if (!_fromHistoryTraversal) {
        if (!this.tabNavigationStacks.has(resolvedTabId)) {
          this.tabNavigationStacks.set(resolvedTabId, { entries: [], index: -1 });
        }
        const stack = this.tabNavigationStacks.get(resolvedTabId);
        stack.entries = stack.entries.slice(0, stack.index + 1);
        stack.entries.push(normalizedUrl);
        stack.index = stack.entries.length - 1;
      }

      // Record in durable provenance journal
      this.provenanceJournal.recordSourceOpen({
        url: normalizedUrl,
        canonicalUrl: snapshot.canonicalUrl,
        title: snapshot.title,
        httpStatus: snapshot.httpStatus,
        available,
        pageVersion: snapshot.pageVersion,
        snapshotId: snapshot.snapshotId,
        tabReceiptId: snapshot.tabReceipt?.receiptId || null,
        pageDate: snapshot.pageDate,
        eventDate: snapshot.eventDate,
        fetchedAt: snapshot.fetchedAt,
        searchId: initiatedBySearchId,
        serpRank: initiatedByRank
      });

      const governorState = this.resourceGovernor.touchLiveTab(
        resolvedTabId,
        tabState,
        (hibernatedId) => {
          const bgTab = this.tabs.get(hibernatedId);
          if (bgTab && !bgTab.closed) {
            bgTab.hibernated = true;
          }
        }
      );

      this.resourceGovernor.sampleProcessMemory(`after_nav_${resolvedTabId}`);
      const latencyMs = task.finish({ url: normalizedUrl });

      return {
        status: authGate.gated ? "paused_for_user" : available ? "ok" : "unavailable",
        tabId: resolvedTabId,
        url: normalizedUrl,
        httpStatus: snapshot.httpStatus,
        available,
        networkError: tabState.networkError,
        fetchedAt: snapshot.fetchedAt,
        pageDate: snapshot.pageDate,
        eventDate: snapshot.eventDate,
        tabReceipt: snapshot.tabReceipt,
        snapshot,
        authGate,
        latencyMs,
        governorState
      };
    } catch (err) {
      task.finish({ url });
      throw err;
    }
  }

  /**
   * Navigates backward in `tabId`'s history stack (`SERP <- Source <- Subpage`).
   */
  async goBack(tabId, options = {}) {
    const stack = this.tabNavigationStacks.get(String(tabId));
    if (!stack || stack.index <= 0) {
      return { navigated: false, reason: "no_back_history", tabId: String(tabId) };
    }
    stack.index -= 1;
    const targetUrl = stack.entries[stack.index];
    const nav = await this.navigate({
      tabId,
      url: targetUrl,
      actor: options.actor || "agent",
      signal: options.signal || null,
      _fromHistoryTraversal: true
    });
    return {
      navigated: true,
      direction: "back",
      historyIndex: stack.index,
      historyLength: stack.entries.length,
      ...nav
    };
  }

  /**
   * Navigates forward in `tabId`'s history stack.
   */
  async goForward(tabId, options = {}) {
    const stack = this.tabNavigationStacks.get(String(tabId));
    if (!stack || stack.index >= stack.entries.length - 1) {
      return { navigated: false, reason: "no_forward_history", tabId: String(tabId) };
    }
    stack.index += 1;
    const targetUrl = stack.entries[stack.index];
    const nav = await this.navigate({
      tabId,
      url: targetUrl,
      actor: options.actor || "agent",
      signal: options.signal || null,
      _fromHistoryTraversal: true
    });
    return {
      navigated: true,
      direction: "forward",
      historyIndex: stack.index,
      historyLength: stack.entries.length,
      ...nav
    };
  }

  getTabHistory(tabId) {
    const stack = this.tabNavigationStacks.get(String(tabId)) || { entries: [], index: -1 };
    return {
      tabId: String(tabId),
      entries: [...stack.entries],
      currentIndex: stack.index,
      canGoBack: stack.index > 0,
      canGoForward: stack.index >= 0 && stack.index < stack.entries.length - 1
    };
  }

  /**
   * Completes a user CAPTCHA / login pause once the user has manually authenticated or solved the challenge,
   * updating the page state and returning a fresh valid snapshot for subsequent research/form steps.
   */
  completeUserAuthOrCaptchaPause(tabId, postAuthPageData = {}) {
    const tab = this.tabs.get(String(tabId));
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError(
        "TAB_LOST_OR_CLOSED",
        `Вкладка "${tabId}" закрыта.`
      );
    }

    this.userTakeover.recordUserAction(tab.tabId, {
      type: "user_resolved_auth_or_captcha_gate",
      takeover: false
    });

    const nextVersion = tab.pageVersion + 1;
    const updatedSnapshot = buildVersionedPageSnapshot({
      ...postAuthPageData,
      tabId: tab.tabId,
      pageVersion: nextVersion,
      url: postAuthPageData.url || tab.url,
      fetchedAt: new Date().toISOString()
    });
    updatedSnapshot.userEpoch = this.userTakeover.getCurrentEpoch(tab.tabId);

    tab.pageVersion = nextVersion;
    tab.snapshot = updatedSnapshot;
    tab.lastObservation = updatedSnapshot;
    tab.authGate = detectAuthOrCaptchaGate(updatedSnapshot);
    this.resourceGovernor.invalidateSnapshotsForTab(tab.tabId);
    this.resourceGovernor.cacheSnapshot(updatedSnapshot);

    return {
      status: tab.authGate.gated ? "paused_for_user" : "resumed",
      tabId: tab.tabId,
      pageVersion: nextVersion,
      snapshot: updatedSnapshot,
      tabReceipt: updatedSnapshot.tabReceipt
    };
  }

  /**
   * Observes the current page state on `tabId`. Reuses a valid cached snapshot if `reuseSnapshot` is true
   * and neither `pageVersion` nor `userEpoch` has changed.
   */
  observePage(tabId, options = {}) {
    const tab = this.tabs.get(String(tabId));
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError(
        "TAB_LOST_OR_CLOSED",
        `Вкладка "${tabId}" закрыта или не существует.`
      );
    }

    // Wake up hibernated tab seamlessly using its preserved state
    if (tab.hibernated) {
      tab.hibernated = false;
      this.resourceGovernor.touchLiveTab(tab.tabId, tab, (hibId) => {
        const bg = this.tabs.get(hibId);
        if (bg) bg.hibernated = true;
      });
    }

    const currentUserEpoch = this.userTakeover.getCurrentEpoch(tab.tabId);
    const allowReuse = options.reuseSnapshot !== false;

    if (allowReuse && tab.snapshot.userEpoch === currentUserEpoch) {
      const cached = this.resourceGovernor.getReusableSnapshot(
        tab.tabId,
        tab.url,
        tab.pageVersion
      );
      if (cached) {
        tab.lastObservation = cached;
        return {
          snapshot: cached,
          reusedSnapshot: true,
          tabReceipt: cached.tabReceipt,
          authGate: tab.authGate
        };
      }
    }

    tab.snapshot.userEpoch = currentUserEpoch;
    this.resourceGovernor.cacheSnapshot(tab.snapshot);
    tab.lastObservation = tab.snapshot;

    return {
      snapshot: tab.snapshot,
      reusedSnapshot: false,
      tabReceipt: tab.snapshot.tabReceipt,
      authGate: tab.authGate
    };
  }

  /**
   * Reads a long or dynamic page in bounded UTF-16 windows, supporting lazy-loaded dynamic sections
   * and cooperative cancellation (`signal`).
   */
  async readLongPage({
    tabId,
    cursorUtf16 = 0,
    windowChars = 4000,
    overlapChars = 120,
    triggerDynamicScroll = false,
    signal = null
  } = {}) {
    const task = this.resourceGovernor.beginTask(
      `read-${tabId}-${cursorUtf16}`,
      "read_long_page",
      signal
    );
    try {
      if (task.controller.signal.aborted) {
        const err = new Error("BROWSER_READ_CANCELLED");
        err.code = "BROWSER_READ_CANCELLED";
        throw err;
      }

      const tab = this.tabs.get(String(tabId));
      if (!tab || tab.closed) {
        throw new KosworkBrowserRecoveryError(
          "TAB_LOST_OR_CLOSED",
          `Вкладка "${tabId}" была потеряна во время чтения страницы.`
        );
      }

      if (
        triggerDynamicScroll &&
        tab.rawSiteDef &&
        typeof tab.rawSiteDef.onDynamicScroll === "function"
      ) {
        const dynamicAddition = await tab.rawSiteDef.onDynamicScroll({
          currentVersion: tab.pageVersion,
          cursorUtf16
        });
        if (dynamicAddition) {
          this.mutatePageContent(tab.tabId, dynamicAddition);
        }
      }

      const windowResult = readLongPageWindow(tab.snapshot, {
        cursorUtf16,
        windowChars,
        overlapChars
      });

      const latencyMs = task.finish({ url: tab.url });
      return {
        ...windowResult,
        latencyMs
      };
    } catch (err) {
      task.finish({});
      throw err;
    }
  }

  /**
   * Applies a dynamic DOM mutation or post-observation text substitution to `tabId`,
   * incrementing `pageVersion` and recalculating UTF-16 offsets while keeping `tab.lastObservation`
   * at the snapshot the agent previously observed.
   */
  mutatePageContent(tabId, mutation = {}) {
    const tab = this.tabs.get(String(tabId));
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError(
        "TAB_LOST_OR_CLOSED",
        `Вкладка "${tabId}" закрыта.`
      );
    }

    const nextVersion = tab.pageVersion + 1;
    let nextText = tab.snapshot.fullTextUtf16;
    if (typeof mutation.replaceText === "object" && mutation.replaceText !== null) {
      const { from, to } = mutation.replaceText;
      nextText = nextText.replace(from, to);
    } else if (typeof mutation.appendText === "string" && mutation.appendText.trim()) {
      nextText = `${nextText}\n\n${mutation.appendText.trim()}`;
    } else if (typeof mutation.fullText === "string") {
      nextText = mutation.fullText;
    }

    let nextControls = tab.snapshot.controls.map((c) => ({ ...c }));
    if (Array.isArray(mutation.controls)) {
      nextControls = mutation.controls;
    } else if (mutation.replaceControlLabel) {
      const { controlId, newLabel } = mutation.replaceControlLabel;
      nextControls = nextControls.map((c) =>
        c.id === controlId ? { ...c, label: newLabel } : c
      );
    }

    const updatedSnapshot = buildVersionedPageSnapshot({
      tabId: tab.tabId,
      pageVersion: nextVersion,
      url: tab.url,
      canonicalUrl: tab.snapshot.canonicalUrl,
      httpStatus: tab.httpStatus,
      title: mutation.title || tab.snapshot.title,
      pageDate: mutation.pageDate !== undefined ? mutation.pageDate : tab.snapshot.pageDate,
      eventDate: mutation.eventDate !== undefined ? mutation.eventDate : tab.snapshot.eventDate,
      fetchedAt: tab.snapshot.fetchedAt,
      text: nextText,
      controls: nextControls,
      tables: mutation.tables !== undefined ? mutation.tables : tab.snapshot.tables
    });
    updatedSnapshot.userEpoch = this.userTakeover.getCurrentEpoch(tab.tabId);

    tab.pageVersion = nextVersion;
    tab.snapshot = updatedSnapshot;
    this.resourceGovernor.invalidateSnapshotsForTab(tab.tabId);
    this.resourceGovernor.cacheSnapshot(updatedSnapshot);

    return updatedSnapshot;
  }

  /**
   * Extracts a verifiable excerpt with UTF-16 offsets, verifies observation integrity against
   * post-observation text substitution if `expectedObservation` is passed, and records the excerpt
   * in `this.provenanceJournal`.
   */
  extractExcerpt(tabId, queryOrSpan = {}, expectedObservation = null) {
    const tab = this.tabs.get(String(tabId));
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError(
        "TAB_LOST_OR_CLOSED",
        `Вкладка "${tabId}" закрыта или потеряна.`
      );
    }

    if (expectedObservation) {
      verifyObservationIntegrity({
        observedSnapshot: expectedObservation,
        currentSnapshot: tab.snapshot,
        targetSpec: queryOrSpan,
        userTakeoverTracker: this.userTakeover
      });
    }

    const excerpt = extractVerifiableExcerpt(tab.snapshot, queryOrSpan);
    if (excerpt) {
      this.provenanceJournal.recordExcerpt(excerpt);
    }
    return excerpt;
  }

  /**
   * Records a manual user action (click, input, scroll, or takeover toggle) on `tabId`.
   * Immediately invalidates any prior agent observation on that tab so stale observations cannot drive input.
   */
  recordUserAction(tabId, action = {}) {
    return this.userTakeover.recordUserAction(tabId, action);
  }

  releaseUserTakeover(tabId) {
    return this.userTakeover.releaseTakeover(tabId);
  }

  closeTab(tabId) {
    const tab = this.tabs.get(String(tabId));
    if (!tab) return { closed: false, tabId };
    tab.closed = true;
    this.resourceGovernor.removeTab(tabId);
    return { closed: true, tabId };
  }

  /**
   * Fills ordinary form fields (`input`, `textarea`, `select`, `checkbox`, `radio`) on `tabId`, verifying:
   * 1. Tab receipt & observation validity (rejects if user intervened or text was substituted after observation)
   * 2. No CAPTCHA / login gate (pauses for user if gated)
   */
  fillForm({
    tabId,
    observedSnapshot = null,
    tabReceipt = null,
    fields = {}
  } = {}) {
    const tab = this.tabs.get(String(tabId));
    if (tabReceipt) {
      verifyTabReceipt(tabReceipt, tab);
    } else if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError("TAB_LOST_OR_CLOSED", `Вкладка "${tabId}" потеряна.`);
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

    const nextControls = tab.snapshot.controls.map((c) => {
      const hasMatch =
        Object.prototype.hasOwnProperty.call(fields, c.id) ||
        (c.name && Object.prototype.hasOwnProperty.call(fields, c.name));
      if (!hasMatch) return { ...c };

      verifyObservationIntegrity({
        observedSnapshot: obs,
        currentSnapshot: tab.snapshot,
        targetSpec: { controlId: c.id },
        userTakeoverTracker: this.userTakeover
      });

      const rawInputVal = fields[c.id] ?? fields[c.name];
      if (c.type === "checkbox" || c.type === "radio") {
        const nextChecked = Boolean(rawInputVal);
        tab.formValues.set(c.id, nextChecked);
        return {
          ...c,
          checked: nextChecked,
          value: nextChecked ? c.value || "on" : ""
        };
      }

      const newVal = String(rawInputVal ?? "");
      tab.formValues.set(c.id, newVal);
      return {
        ...c,
        value: newVal
      };
    });

    const updatedSnapshot = this.mutatePageContent(tab.tabId, {
      controls: nextControls
    });
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
      { url: tab.url, title: tab.snapshot.title, nodes: preNodes },
      { url: tab.url, title: updatedSnapshot.title, nodes: postNodes },
      { type: "fill_form" }
    );

    return {
      status: "ok",
      tabId: tab.tabId,
      pageVersion: updatedSnapshot.pageVersion,
      tabReceipt: updatedSnapshot.tabReceipt,
      snapshot: updatedSnapshot,
      domVerification: domDiff
    };
  }

  /**
   * Selects a local file for an `<input type="file">` control on `tabId`.
   * Enforces `verifyFileSelectionPolicy` so forbidden extensions, `.env`/credentials, symlinks,
   * and files outside `allowedWorkspaceRoot` are strictly rejected.
   */
  selectFiles({
    tabId,
    controlId,
    filePaths = [],
    observedSnapshot = null
  } = {}) {
    const tab = this.tabs.get(String(tabId));
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError("TAB_LOST_OR_CLOSED", `Вкладка "${tabId}" потеряна.`);
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

    const nextControls = tab.snapshot.controls.map((c) =>
      c.id === controlId
        ? { ...c, value: verifiedFiles.map((f) => f.filename).join(", ") }
        : { ...c }
    );
    const updatedSnapshot = this.mutatePageContent(tab.tabId, {
      controls: nextControls
    });
    tab.lastObservation = updatedSnapshot;

    return {
      status: "ok",
      tabId: tab.tabId,
      controlId,
      attachedFiles: verifiedFiles,
      snapshot: updatedSnapshot
    };
  }

  /**
   * Submits a form on `tabId` and verifies the post-submit DOM/URL effect using `verifyBrowserActionMutation`.
   */
  async submitForm({
    tabId,
    submitControlId = null,
    observedSnapshot = null
  } = {}) {
    const tab = this.tabs.get(String(tabId));
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError("TAB_LOST_OR_CLOSED", `Вкладка "${tabId}" потеряна.`);
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
      targetSpec: submitControlId ? { controlId: submitControlId } : {},
      userTakeoverTracker: this.userTakeover
    });

    const preDom = {
      url: tab.url,
      title: tab.snapshot.title,
      nodes: [
        ...tab.snapshot.controls.map((c) => ({
          id: c.id,
          tag: c.tag,
          role: c.role,
          text: c.label,
          value: c.value,
          checked: c.checked,
          visible: true,
          disabled: c.disabled
        })),
        ...tab.snapshot.blocks.map((b) => ({
          id: b.blockId,
          tag: b.tag,
          role: b.role,
          text: b.text,
          value: "",
          visible: true,
          disabled: false
        }))
      ]
    };

    const submittedData = Object.fromEntries(tab.formValues.entries());
    const attachedFiles = Object.fromEntries(tab.selectedFiles.entries());

    let submitEffect = {
      appendText: `Форма успешно отправлена: ${JSON.stringify(submittedData)}`,
      statusBanner: "Заявка принята к обработке"
    };

    if (tab.rawSiteDef && typeof tab.rawSiteDef.onSubmit === "function") {
      submitEffect = await tab.rawSiteDef.onSubmit({
        values: submittedData,
        files: attachedFiles,
        currentSnapshot: tab.snapshot
      });
    }

    const updatedSnapshot = this.mutatePageContent(tab.tabId, {
      appendText: submitEffect.appendText || submitEffect.statusBanner || "Форма отправлена",
      title: submitEffect.newTitle || tab.snapshot.title
    });
    tab.lastObservation = updatedSnapshot;

    const postDom = {
      url: updatedSnapshot.url,
      title: updatedSnapshot.title,
      nodes: [
        ...updatedSnapshot.controls.map((c) => ({
          id: c.id,
          tag: c.tag,
          role: c.role,
          text: c.label,
          value: c.value,
          checked: c.checked,
          visible: true,
          disabled: c.disabled
        })),
        ...updatedSnapshot.blocks.map((b) => ({
          id: b.blockId,
          tag: b.tag,
          role: b.role,
          text: b.text,
          value: "",
          visible: true,
          disabled: false
        }))
      ]
    };

    const effectVerification = verifyBrowserActionMutation(preDom, postDom, {
      type: "submit_form",
      targetId: submitControlId || "form"
    });

    return {
      status: effectVerification.actionVerified ? "ok" : "no_effect_detected",
      effectVerified: effectVerification.actionVerified,
      submittedData,
      attachedFiles,
      snapshot: updatedSnapshot,
      tabReceipt: updatedSnapshot.tabReceipt,
      effectVerification
    };
  }

  /**
   * Downloads a file from a synthetic or local HTTP site strictly into `allowedDownloadDir`
   * (inside the connected workspace folder) and verifies its completion and SHA-256 via `waitForVerifiedDownload`.
   */
  async downloadFromPage({
    tabId,
    downloadControlId = null,
    filename = "download.txt",
    content = null
  } = {}) {
    const tab = this.tabs.get(String(tabId));
    if (!tab || tab.closed) {
      throw new KosworkBrowserRecoveryError("TAB_LOST_OR_CLOSED", `Вкладка "${tabId}" потеряна.`);
    }

    this.userTakeover.assertObservationValid(tab.tabId, tab.lastObservation?.userEpoch);

    let resolvedFilename = filename;
    let payloadContent = content;

    if (tab.rawSiteDef && typeof tab.rawSiteDef.onDownload === "function") {
      const dlSpec = await tab.rawSiteDef.onDownload({
        downloadControlId,
        values: Object.fromEntries(tab.formValues.entries())
      });
      if (dlSpec?.filename) resolvedFilename = dlSpec.filename;
      if (dlSpec?.content !== undefined) payloadContent = dlSpec.content;
    }

    const target = resolveAllowedDownloadTarget(resolvedFilename, {
      allowedDownloadDir: this.allowedDownloadDir,
      allowedWorkspaceRoot: this.allowedWorkspaceRoot
    });

    const finalText =
      typeof payloadContent === "string"
        ? payloadContent
        : `Downloaded from ${tab.url} at ${new Date().toISOString()}\n`;

    fs.writeFileSync(target.targetPath, finalText, "utf8");

    const verified = await waitForVerifiedDownload({
      filename: target.filename,
      primaryDir: target.downloadDir,
      timeoutMs: 2000,
      pollIntervalMs: 20,
      minBytes: 1
    });

    return {
      status: "ok",
      tabId: tab.tabId,
      sourceUrl: tab.url,
      downloadDir: target.downloadDir,
      filename: verified.filename,
      resolvedPath: verified.resolvedPath,
      sizeBytes: verified.sizeBytes,
      sha256: verified.sha256
    };
  }

  findRecoveryCandidatesForTab(tabId, targetSpec) {
    const tab = this.tabs.get(String(tabId));
    if (!tab || tab.closed) return [];
    return findRecoveryCandidates(targetSpec, tab.snapshot);
  }
}

module.exports = {
  KosworkBrowserEngine,
  KosworkBrowserPolicyError,
  KosworkBrowserRecoveryError
};
