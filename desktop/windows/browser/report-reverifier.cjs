"use strict";

const { saveResearchReportsViaWorkspace } = require("./research-report-builder.cjs");

/**
 * Koswork Live Report Re-Verifier & Delta Updater
 * (`desktop/windows/browser/report-reverifier.cjs`).
 *
 * Deepens Requirement #5:
 * "Создавать отчёт MD/HTML/таблицу сравнения через существующие file APIs: цитата,
 *  источник, что подтверждено, что неизвестно. Ссылка сама по себе не доказательство
 *  утверждения; отметь конфликтующие/устаревшие данные и недоступные источники."
 *
 * Re-verifies an existing research report against current browser sources:
 * 1. Re-visits previously unavailable (`503` / offline) sources; if a source is now
 *    available (`200 OK`) and contains a verifiable UTF-16 excerpt for an `"unknown"`
 *    criterion, promotes that claim to `"confirmed"`.
 * 2. Re-checks existing confirmed claims against fresh page snapshots to detect whether
 *    any source has updated its figures (`updatedSourceClaims`) or become unavailable.
 * 3. Writes an updated revision of the MD/HTML/CSV/JSON/DOCX/XLSX/PDF/PPTX/PROV/BibTeX
 *    reports via `workspace-service.cjs`.
 */
async function reverifyAndRefreshResearchReport({
  engine,
  workspaceRoot,
  reportSlug = "reverified-research-report",
  previousReportData,
  recoveryProbes = [],
  signal = null
} = {}) {
  if (!engine) {
    throw new Error("REVERIFIER_REQUIRES_ENGINE");
  }
  if (!previousReportData || typeof previousReportData !== "object") {
    throw new Error("REVERIFIER_REQUIRES_PREVIOUS_REPORT_DATA");
  }

  const updatedSourcesMap = new Map();
  for (const s of previousReportData.sources || []) {
    updatedSourcesMap.set(s.url, { ...s });
  }

  const updatedClaims = [...(previousReportData.claims || [])];
  const updatedComparisonRows = JSON.parse(
    JSON.stringify(previousReportData.comparisonRows || [])
  );
  const stillUnavailable = [];
  const recoveredSources = [];
  const newlyConfirmedClaims = [];
  const driftedClaims = [];

  // 1. Re-verify existing confirmed claims against live sources
  for (let i = 0; i < updatedClaims.length; i += 1) {
    const claim = updatedClaims[i];
    if (!claim?.source?.url || !claim?.excerpt?.quote) continue;

    const nav = await engine.navigate({
      tabId: `reverify-tab-${(i % 3) + 1}`,
      url: claim.source.url,
      actor: "agent",
      signal
    });

    updatedSourcesMap.set(nav.url, {
      url: nav.url,
      title: nav.snapshot.title,
      httpStatus: nav.httpStatus,
      available: nav.available,
      pageDate: nav.pageDate,
      eventDate: nav.eventDate,
      fetchedAt: nav.fetchedAt,
      tabReceipt: nav.tabReceipt
    });

    if (!nav.available) {
      driftedClaims.push({
        claimId: claim.claimId,
        reason: "SOURCE_BECAME_UNAVAILABLE",
        url: nav.url,
        httpStatus: nav.httpStatus
      });
      continue;
    }

    const freshExcerpt = engine.extractExcerpt(nav.tabId, {
      searchTerm: claim.excerpt.quote
    });

    if (!freshExcerpt) {
      driftedClaims.push({
        claimId: claim.claimId,
        reason: "QUOTE_NO_LONGER_PRESENT_IN_SOURCE",
        url: nav.url,
        expectedQuote: claim.excerpt.quote
      });
    } else {
      updatedClaims[i] = {
        ...claim,
        excerpt: freshExcerpt,
        source: {
          ...claim.source,
          title: nav.snapshot.title,
          pageDate: nav.pageDate,
          eventDate: nav.eventDate,
          fetchedAt: nav.fetchedAt
        }
      };
    }
  }

  // 2. Probe previously unavailable sources or recovery probes for unknown criteria
  for (let j = 0; j < recoveryProbes.length; j += 1) {
    const probe = recoveryProbes[j];
    const nav = await engine.navigate({
      tabId: `probe-tab-${(j % 3) + 1}`,
      url: probe.url,
      actor: "agent",
      signal
    });

    updatedSourcesMap.set(nav.url, {
      url: nav.url,
      title: nav.snapshot.title,
      httpStatus: nav.httpStatus,
      available: nav.available,
      pageDate: nav.pageDate,
      eventDate: nav.eventDate,
      fetchedAt: nav.fetchedAt,
      tabReceipt: nav.tabReceipt
    });

    if (!nav.available) {
      stillUnavailable.push({
        url: nav.url,
        httpStatus: nav.httpStatus,
        reason: `HTTP ${nav.httpStatus}`
      });
      continue;
    }

    recoveredSources.push(nav.url);

    if (probe.searchTerm) {
      const exc = engine.extractExcerpt(nav.tabId, {
        searchTerm: probe.searchTerm
      });
      if (exc) {
        const newClaim = {
          claimId: probe.claimId || `recovered-claim-${updatedClaims.length + 1}`,
          optionName: probe.optionName,
          criterion: probe.criterion,
          value: probe.value || exc.quote,
          claim: probe.claimText || `${probe.optionName}: ${probe.criterion} = ${probe.value || exc.quote}`,
          excerpt: exc,
          source: {
            url: nav.url,
            title: nav.snapshot.title,
            pageDate: nav.pageDate,
            eventDate: nav.eventDate,
            fetchedAt: nav.fetchedAt
          }
        };
        updatedClaims.push(newClaim);
        newlyConfirmedClaims.push(newClaim);

        let row = updatedComparisonRows.find((r) => r.optionName === probe.optionName);
        if (!row) {
          row = { optionName: probe.optionName, values: {} };
          updatedComparisonRows.push(row);
        }
        row.values = row.values || {};
        row.values[probe.criterion] = {
          displayValue: probe.value || exc.quote,
          sourceUrl: nav.url,
          startUtf16: exc.startUtf16,
          endUtf16: exc.endUtf16
        };
      }
    }
  }

  const nextReportData = {
    ...previousReportData,
    generatedAt: new Date().toISOString(),
    sources: Array.from(updatedSourcesMap.values()),
    claims: updatedClaims,
    comparisonRows: updatedComparisonRows,
    unavailableSources: stillUnavailable
  };

  const savedReports = await saveResearchReportsViaWorkspace({
    workspaceRoot,
    reportSlug,
    reportData: nextReportData,
    signal
  });

  return {
    status: "reverified",
    recoveredSources,
    newlyConfirmedClaims,
    driftedClaims,
    stillUnavailable,
    savedReports
  };
}

module.exports = {
  reverifyAndRefreshResearchReport
};
