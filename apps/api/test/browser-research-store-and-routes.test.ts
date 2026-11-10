import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { KosworkBrowserResearchSessionStore } from "../../../packages/db/src/browser-research-session-store.ts";
import { createBrowserResearchRoutesController } from "../src/browser-research-routes.ts";

test("KosworkBrowserResearchSessionStore & Routes: persists search provenance, distinct pageDate/eventDate/fetchedAt, UTF-16 excerpts, rejects bare links, and purges owner data", () => {
  const db = new DatabaseSync(":memory:");
  const store = new KosworkBrowserResearchSessionStore(db);
  const controller = createBrowserResearchRoutesController({ store });

  // 1. Reject fabricated "proprietary internet index"
  assert.throws(
    () =>
      controller.postSearchReceipt({
        searchId: "srch-fake",
        ownerId: "owner-1",
        actor: "agent",
        query: "Option Alpha",
        providerId: "koswork-proprietary-internet-index",
        providerEndpoint: "koswork://index",
        totalResults: 5,
        searchedAt: "2026-11-07T20:00:00Z"
      }),
    /INVALID_SEARCH_PROVIDER_PROVENANCE/
  );

  // 2. Record legitimate search receipt
  const search = controller.postSearchReceipt({
    searchId: "srch-001",
    ownerId: "owner-1",
    actor: "user",
    query: "Option Alpha SLA и цена",
    providerId: "duckduckgo-html",
    providerEndpoint: "https://html.duckduckgo.com/html/",
    totalResults: 5,
    searchedAt: "2026-11-07T20:01:00Z"
  });
  assert.equal(search.providerId, "duckduckgo-html");

  // 3. Record source visit with distinct pageDate, eventDate, and fetchedAt
  const source = controller.postSourceVisit({
    sourceId: "src-001",
    searchId: "srch-001",
    ownerId: "owner-1",
    tabId: "tab-1",
    receiptId: "rcpt-tab-1-v1",
    url: "https://corpus.local/site-1?utm_source=ddg&id=alpha",
    canonicalUrl: "https://corpus.local/site-1?id=alpha",
    title: "Официальная спецификация Option Alpha",
    httpStatus: 200,
    available: true,
    pageVersion: 1,
    pageDate: "2026-10-15",
    eventDate: "2026-11-01",
    fetchedAt: "2026-11-07T20:01:05Z"
  });
  assert.equal(source.pageDate, "2026-10-15");
  assert.equal(source.eventDate, "2026-11-01");
  assert.equal(source.fetchedAt, "2026-11-07T20:01:05Z");

  // 4. Record UTF-16 excerpt
  const excerpt = controller.postExcerpt({
    excerptId: "exc-001",
    sourceId: "src-001",
    ownerId: "owner-1",
    snapshotId: "snap-tab-1-v1",
    pageVersion: 1,
    startUtf16: 84,
    endUtf16: 162,
    quote: "для пакета Option Alpha базовая цена составляет $49/мес при годовой подписке.",
    createdAt: "2026-11-07T20:01:06Z"
  });
  assert.equal(excerpt.quoteSha256.length, 64);

  // 5. Verify claim with valid UTF-16 excerpt succeeds
  const verified = controller.postVerifyClaim({
    ownerId: "owner-1",
    claimId: "claim-1",
    claim: "Option Alpha стоит $49/мес",
    optionName: "Option Alpha",
    criterion: "Цена",
    value: "$49/мес",
    sourceId: "src-001",
    excerptId: "exc-001"
  });
  assert.equal(verified.verified, true);
  if (verified.verified) {
    assert.equal(verified.confirmed.source.pageDate, "2026-10-15");
    assert.equal(verified.confirmed.source.eventDate, "2026-11-01");
    assert.equal(verified.confirmed.excerpt.startUtf16, 84);
  }

  // 6. Verify bare link without excerpt is rejected (`verified: false`)
  const bareLinkAttempt = controller.postVerifyClaim({
    ownerId: "owner-1",
    claimId: "claim-bare",
    claim: "Option Alpha бесплатен навсегда",
    candidateUrl: "https://corpus.local/site-1?id=alpha",
    sourceId: "src-001",
    excerptId: null
  });
  assert.equal(bareLinkAttempt.verified, false);
  if (!bareLinkAttempt.verified) {
    assert.ok(bareLinkAttempt.unconfirmed.reason.includes("ссылка не является доказательством"));
  }

  // 7. Save and retrieve full research report, then purge owner data
  controller.postSaveReport({
    reportId: "rep-001",
    ownerId: "owner-1",
    question: "Сравнение Option Alpha и Option Beta",
    criteria: ["Цена", "SLA"],
    confirmedClaims: verified.verified ? [verified.confirmed] : [],
    unconfirmedClaims: !bareLinkAttempt.verified ? [bareLinkAttempt.unconfirmed] : [],
    contradictions: [],
    outdatedFindings: [],
    unavailableSources: [],
    substitutionIncidents: [],
    resourceMetrics: {
      maxLiveTabs: 3,
      liveTabCount: 3,
      hibernatedTabCount: 2,
      hibernationEventsCount: 2,
      snapshotReuseCount: 5,
      ramTelemetry: {
        currentRssMb: 48.2,
        currentHeapUsedMb: 9.1,
        peakRssMb: 49.0,
        peakHeapUsedMb: 9.8,
        externalMb: 1.5
      },
      latencyTelemetry: {
        totalCompletedOps: 10,
        p50Ms: 1.2,
        p95Ms: 4.5,
        maxMs: 6.0
      }
    },
    markdownPath: "reports/rep-001.md",
    htmlPath: "reports/rep-001.html",
    csvPath: "reports/rep-001-comparison.csv",
    createdAt: "2026-11-07T20:02:00Z"
  });

  const loaded = controller.getReport("rep-001", "owner-1");
  assert.ok(loaded);
  assert.equal(loaded.confirmedClaims.length, 1);
  assert.equal(loaded.unconfirmedClaims.length, 1);

  const purged = controller.deleteOwnerResearchData("owner-1");
  assert.equal(purged.deletedSearches, 1);
  assert.equal(purged.deletedSources, 1);
  assert.equal(purged.deletedExcerpts, 1);
  assert.equal(purged.deletedReports, 1);
  assert.equal(controller.getReport("rep-001", "owner-1"), null);
});
