"use strict";

/**
 * Functional Controller for `desktop/windows/browser.html` (`desktop/windows/browser.js`).
 *
 * Connects user actions (search/navigation bar, result opening, cancellation, manual takeover,
 * and multi-site research trigger) to the Koswork Browser Engine / IPC bridge without altering
 * global styles, palette, typography, logo, or main chat layout.
 */
(function initKosworkBrowserUi(globalScope) {
  function createBrowserUiController({ ipcInvoke, documentRef } = {}) {
    const doc = documentRef || (typeof document !== "undefined" ? document : null);
    const invoke =
      ipcInvoke ||
      (globalScope?.kosworkBridge && typeof globalScope.kosworkBridge.invoke === "function"
        ? (channel, payload) => globalScope.kosworkBridge.invoke(channel, payload)
        : null);

    const state = {
      activeTabId: "tab-1",
      lastSearchId: null,
      manualTakeoverActive: false,
      lastResearchSummary: null
    };

    async function handleNavigateOrSearch(rawInput) {
      const text = String(rawInput || "").trim();
      if (!text || !invoke) return null;

      const isDirectUrl = /^https?:\/\//i.test(text) || /^koswork:\/\/search\//i.test(text);
      if (isDirectUrl) {
        const res = await invoke("koswork:browser:navigate", {
          tabId: state.activeTabId,
          url: text,
          actor: "user"
        });
        updateStatusText(
          res.status === "paused_for_user"
            ? `Пауза для пользователя: ${res.authGate?.reason || "требуется вход/CAPTCHA"}`
            : `Открыто: ${res.url} (v${res.snapshot?.pageVersion || 1})`
        );
        return res;
      }

      const searchRes = await invoke("koswork:browser:search", {
        query: text,
        actor: "user",
        page: 1,
        pageSize: 5
      });
      state.lastSearchId = searchRes.searchId;
      renderSerpItems(searchRes);
      updateStatusText(`Найдено результатов: ${searchRes.totalResults} (провайдер: ${searchRes.providerId})`);
      return searchRes;
    }

    async function handleOpenSearchResult(rank, url) {
      if (!invoke) return null;
      const opened = await invoke("koswork:browser:open-search-result", {
        searchId: state.lastSearchId,
        rank,
        url,
        tabId: state.activeTabId,
        actor: "user"
      });
      updateStatusText(`Открыт источник #${rank}: ${opened.title} (${opened.url})`);
      return opened;
    }

    async function handleToggleUserTakeover() {
      if (!invoke) return null;
      state.manualTakeoverActive = !state.manualTakeoverActive;
      if (state.manualTakeoverActive) {
        const res = await invoke("koswork:browser:user-action", {
          tabId: state.activeTabId,
          action: {
            type: "user_manual_takeover",
            takeover: true
          }
        });
        updateStatusText("Ручное управление пользователем активно (старые наблюдения агента сброшены)");
        return res;
      } else {
        const res = await invoke("koswork:browser:release-takeover", {
          tabId: state.activeTabId
        });
        updateStatusText("Управление возвращено исследовательскому циклу (требуется новое наблюдение)");
        return res;
      }
    }

    async function handleCancelActiveOperations() {
      if (!invoke) return null;
      const res = await invoke("koswork:browser:cancel", {
        reason: "cancelled_by_user_ui"
      });
      updateStatusText(`Отменено активных операций: ${res.cancelledCount}`);
      return res;
    }

    async function handleRunMultiSiteResearch({ question, criteriaCsv }) {
      if (!invoke) return null;
      const criteria = String(criteriaCsv || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      updateStatusText("Выполняется многосайтовое исследование...");
      const res = await invoke("koswork:browser:run-research", {
        plan: {
          question,
          criteria: criteria.length > 0 ? criteria : undefined
        }
      });
      state.lastResearchSummary = res;
      updateTelemetryDisplay(res.resourceMetrics);
      updateStatusText(
        `Отчёт сохранён: ${res.savedReports?.markdownFile?.path || "reports/koswork-browser-research-report.md"}`
      );
      return res;
    }

    function updateStatusText(message) {
      if (!doc) return;
      const el = doc.getElementById("koswork-status-indicator");
      if (el) el.textContent = String(message || "");
    }

    function updateTelemetryDisplay(metrics) {
      if (!doc || !metrics) return;
      const tabsEl = doc.getElementById("koswork-telemetry-tabs");
      const ramEl = doc.getElementById("koswork-telemetry-ram");
      const latEl = doc.getElementById("koswork-telemetry-latency");
      if (tabsEl) {
        tabsEl.textContent = `Живых вкладок: ${metrics.liveTabCount}/${metrics.maxLiveTabs} (выгружено: ${metrics.hibernationEventsCount})`;
      }
      if (ramEl && metrics.ramTelemetry) {
        ramEl.textContent = `RAM RSS: ${metrics.ramTelemetry.currentRssMb} МБ (пик ${metrics.ramTelemetry.peakRssMb} МБ)`;
      }
      if (latEl && metrics.latencyTelemetry) {
        latEl.textContent = `Latency p50/p95: ${metrics.latencyTelemetry.p50Ms} / ${metrics.latencyTelemetry.p95Ms} мс`;
      }
    }

    function renderSerpItems(searchRes) {
      if (!doc) return;
      const panel = doc.getElementById("koswork-serp-results-panel");
      if (!panel) return;
      panel.hidden = false;
      panel.innerHTML = "";
      for (const item of searchRes.items || []) {
        const row = doc.createElement("div");
        row.setAttribute("data-serp-rank", String(item.rank));
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.textContent = `${item.rank}. ${item.title} (${item.domain})`;
        btn.addEventListener("click", () => handleOpenSearchResult(item.rank, item.url));
        row.appendChild(btn);
        panel.appendChild(row);
      }
    }

    if (doc) {
      const urlForm = doc.getElementById("koswork-url-search-form");
      if (urlForm) {
        urlForm.addEventListener("submit", (ev) => {
          ev.preventDefault();
          const input = doc.getElementById("koswork-address-or-search-input");
          if (input) handleNavigateOrSearch(input.value);
        });
      }

      const cancelBtn = doc.getElementById("koswork-btn-cancel-operation");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => handleCancelActiveOperations());
      }

      const takeoverBtn = doc.getElementById("koswork-btn-user-takeover");
      if (takeoverBtn) {
        takeoverBtn.addEventListener("click", () => handleToggleUserTakeover());
      }

      const researchForm = doc.getElementById("koswork-research-form");
      if (researchForm) {
        researchForm.addEventListener("submit", (ev) => {
          ev.preventDefault();
          const qInput = doc.getElementById("koswork-research-question");
          const cInput = doc.getElementById("koswork-research-criteria");
          handleRunMultiSiteResearch({
            question: qInput ? qInput.value : "",
            criteriaCsv: cInput ? cInput.value : ""
          });
        });
      }
    }

    return {
      state,
      handleNavigateOrSearch,
      handleOpenSearchResult,
      handleToggleUserTakeover,
      handleCancelActiveOperations,
      handleRunMultiSiteResearch
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createBrowserUiController };
  }
  if (globalScope && typeof globalScope.document !== "undefined") {
    globalScope.kosworkBrowserUi = createBrowserUiController({ documentRef: globalScope.document });
  }
})(typeof window !== "undefined" ? window : globalThis);
