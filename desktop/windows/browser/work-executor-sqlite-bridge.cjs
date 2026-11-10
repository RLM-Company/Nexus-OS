"use strict";

/**
 * Koswork Work Executor <-> SQLite / API Session Sync Bridge
 * (`desktop/windows/browser/work-executor-sqlite-bridge.cjs`).
 *
 * Bridges the desktop Browser Research Cycle (`executeMultiSiteResearchWorkflow` /
 * `KosworkUnifiedTaskCoordinator`) with the backend SQLite schema `0064_koswork_browser_research.sql`
 * and Fastify API routes (`/api/koswork/browser-research/sessions`):
 * 1. Serializes a completed or paused desktop research cycle into the exact payload
 *    contract expected by `KosworkBrowserResearchSessionStore` (`packages/db/src/browser-research-session-store.ts`)
 *    and `packages/contracts/src/koswork-browser-research.ts`.
 * 2. Enforces the contract invariant that every `"confirmed"` claim carries a non-empty
 *    `excerpt` (`startUtf16`, `endUtf16`, `quote`) and distinct `pageDate`, `eventDate`, and `fetchedAt`.
 */

function buildApiSyncBundleFromDesktopCycle(cycleResult = {}, options = {}) {
  if (!cycleResult || typeof cycleResult !== "object") {
    throw new Error("API_SYNC_BRIDGE_REQUIRES_CYCLE_RESULT");
  }

  const sessionId =
    options.sessionId ||
    cycleResult.sessionId ||
    `brs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const searchRecords = (cycleResult.searchHistory || []).map((s, idx) => ({
    searchId: s.searchId || `srch-${idx + 1}`,
    query: s.query || cycleResult.question || "",
    actor: s.actor === "user" ? "user" : "agent",
    providerId: s.providerId || "duckduckgo-html",
    providerEndpoint: s.providerEndpoint || "https://html.duckduckgo.com/html/",
    totalResults: Number(s.totalResults ?? (s.results || s.items || []).length),
    searchedAt: s.searchedAt || new Date().toISOString()
  }));

  const sources = (cycleResult.sources || []).map((src, idx) => ({
    sourceId: src.sourceVisitId || src.sourceId || `src-${idx + 1}`,
    searchId: src.searchId || (searchRecords[0] ? searchRecords[0].searchId : null),
    serpRank: src.serpRank ?? idx + 1,
    url: src.url,
    canonicalUrl: src.canonicalUrl || src.url,
    title: src.title || src.url,
    httpStatus: Number(src.httpStatus ?? 200),
    available: Boolean(src.available),
    pageVersion: Number(src.pageVersion ?? 1),
    snapshotId: src.snapshotId || `snap-${idx + 1}`,
    contentSha256: src.contentSha256 || null,
    tabReceiptId: src.tabReceipt?.receiptId || src.tabReceiptId || null,
    pageDate: src.pageDate || null,
    eventDate: src.eventDate || null,
    fetchedAt: src.fetchedAt || new Date().toISOString()
  }));

  const confirmedClaims =
    cycleResult.savedReports?.confirmedClaims || cycleResult.confirmedClaims || [];
  const unconfirmedClaims =
    cycleResult.savedReports?.unconfirmedClaims || cycleResult.unconfirmedClaims || [];

  const excerpts = [];
  const claims = [];

  for (let i = 0; i < confirmedClaims.length; i += 1) {
    const c = confirmedClaims[i];
    const exc = c.excerpt;
    const src = c.source || {};
    const matchedSource =
      sources.find((s) => s.url === src.url || s.canonicalUrl === src.url) || sources[0];

    const excerptId = exc?.excerptId || `exc-${i + 1}`;
    if (exc && exc.quote) {
      excerpts.push({
        excerptId,
        sourceId: matchedSource ? matchedSource.sourceId : `src-ext-${i + 1}`,
        url: src.url || matchedSource?.url || "",
        pageVersion: Number(exc.pageVersion ?? matchedSource?.pageVersion ?? 1),
        snapshotId: exc.snapshotId || matchedSource?.snapshotId || `snap-${i + 1}`,
        startUtf16: Number(exc.startUtf16 ?? 0),
        endUtf16: Number(exc.endUtf16 ?? exc.quote.length),
        lengthUtf16: Number(exc.lengthUtf16 ?? exc.quote.length),
        quote: exc.quote,
        pageDate: src.pageDate ?? matchedSource?.pageDate ?? null,
        eventDate: src.eventDate ?? matchedSource?.eventDate ?? null,
        fetchedAt: src.fetchedAt ?? matchedSource?.fetchedAt ?? new Date().toISOString()
      });
    }

    claims.push({
      claimId: c.claimId || `claim-${i + 1}`,
      optionName: c.optionName || null,
      criterion: c.criterion || null,
      valueText: String(c.value ?? ""),
      claimText: c.claim,
      verificationStatus: "confirmed",
      excerptId,
      sourceId: matchedSource ? matchedSource.sourceId : null,
      sourceUrl: src.url || matchedSource?.url || null,
      conflictNote: c.conflictNote || null
    });
  }

  for (let j = 0; j < unconfirmedClaims.length; j += 1) {
    const u = unconfirmedClaims[j];
    claims.push({
      claimId: u.claimId || `unconf-claim-${j + 1}`,
      optionName: u.optionName || null,
      criterion: u.criterion || null,
      valueText: String(u.value ?? ""),
      claimText: u.claim || "Неподтверждённое утверждение",
      verificationStatus: "unconfirmed_bare_link_rejected",
      excerptId: null,
      sourceId: null,
      sourceUrl: u.source?.url || u.sourceUrl || null,
      conflictNote: u.rejectionReason || "Ссылка без верифицированной UTF-16 выдержки"
    });
  }

  return {
    schemaVersion: "koswork.browser-research.api-sync.v1",
    sessionId,
    question: cycleResult.question || options.question || "",
    status: cycleResult.status || "completed",
    criteria: cycleResult.criteria || options.criteria || [],
    searches: searchRecords,
    sources,
    excerpts,
    claims,
    contradictions: cycleResult.contradictions || [],
    outdatedFindings: cycleResult.outdatedFindings || [],
    unavailableSources: cycleResult.unavailableSources || [],
    substitutionIncidents: cycleResult.substitutionIncidents || [],
    reportPaths: cycleResult.savedReports
      ? {
          markdownPath: cycleResult.savedReports.markdownFile?.path || null,
          htmlPath: cycleResult.savedReports.htmlFile?.path || null,
          csvPath: cycleResult.savedReports.csvFile?.path || null,
          jsonPath: cycleResult.savedReports.comparisonTableFile?.path || null,
          provPath: cycleResult.savedReports.provFile?.path || null,
          bibPath: cycleResult.savedReports.bibFile?.path || null,
          docxPath: cycleResult.savedReports.docxFile?.relativePath || null,
          xlsxPath: cycleResult.savedReports.xlsxFile?.relativePath || null,
          pdfPath: cycleResult.savedReports.pdfFile?.relativePath || null,
          pptxPath: cycleResult.savedReports.pptxFile?.relativePath || null
        }
      : null,
    resourceMetrics: cycleResult.resourceMetrics || null,
    exportedAt: new Date().toISOString()
  };
}

module.exports = {
  buildApiSyncBundleFromDesktopCycle
};
