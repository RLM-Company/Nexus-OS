"use strict";

/**
 * Koswork Functional Browser Research Drawer State Controller
 * (`desktop/windows/browser/ui-research-drawer-state.cjs`).
 *
 * Adheres strictly to `apps/web/UI_RULES.md` and task instructions:
 * - "UI browser.html/browser.js — только функциональные элементы с сохранением текущей оболочки."
 * - "Сайдбар, основной экран чата, логотип, палитру, типографику и глобальные стили не переделывай."
 */
function buildBrowserResearchDrawerViewModel(engine) {
  if (!engine) {
    throw new Error("DRAWER_VIEW_MODEL_REQUIRES_ENGINE");
  }

  const resourceReport = engine.resourceGovernor.getResourceReport();
  const journalSummary = engine.provenanceJournal.getProvenanceSummary();

  const tabItems = [];
  for (const [tabId, tab] of engine.tabs.entries()) {
    if (tab.closed) continue;
    const isPaused = Boolean(tab.authGate && tab.authGate.gated);
    tabItems.push({
      tabId,
      url: tab.url,
      title: tab.snapshot?.title || tab.url,
      pageVersion: tab.pageVersion,
      httpStatus: tab.httpStatus,
      available: tab.available,
      hibernated: Boolean(tab.hibernated),
      pausedForUser: isPaused,
      pauseReason: isPaused ? tab.authGate.reason : null,
      pauseGateType: isPaused ? tab.authGate.gateType : null,
      pageDate: tab.snapshot?.pageDate || null,
      eventDate: tab.snapshot?.eventDate || null,
      fetchedAt: tab.snapshot?.fetchedAt || null,
      userEpoch: tab.snapshot?.userEpoch ?? 0
    });
  }

  const pausedTabs = tabItems.filter((t) => t.pausedForUser);

  return {
    shellPreserved: true,
    liveTabsBadgeText: `Живых вкладок: ${resourceReport.liveTabCount}/${resourceReport.maxLiveTabs}`,
    hibernatedTabsBadgeText: `В гибернации: ${resourceReport.hibernatedTabCount}`,
    pausedBanner:
      pausedTabs.length > 0
        ? {
            visible: true,
            tabId: pausedTabs[0].tabId,
            url: pausedTabs[0].url,
            gateType: pausedTabs[0].pauseGateType,
            messageRu:
              pausedTabs[0].pauseReason ||
              "Требуется ручное прохождение CAPTCHA или входа пользователем.",
            resumeActionLabelRu: "Я прошёл проверку — продолжить исследование"
          }
        : { visible: false },
    tabs: tabItems,
    provenanceCounters: {
      searchesCount: journalSummary.totalSearches,
      openedSourcesCount: journalSummary.totalSources,
      verifiedExcerptsCount: journalSummary.totalExcerpts
    },
    telemetryFooter: {
      rssMb: resourceReport.ramTelemetry.currentRssMb,
      peakRssMb: resourceReport.ramTelemetry.peakRssMb,
      heapUsedMb: resourceReport.ramTelemetry.currentHeapUsedMb,
      latencyP50Ms: resourceReport.latencyTelemetry.p50Ms,
      latencyP95Ms: resourceReport.latencyTelemetry.p95Ms,
      snapshotReuseCount: resourceReport.snapshotReuseCount
    }
  };
}

module.exports = {
  buildBrowserResearchDrawerViewModel
};
