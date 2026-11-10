/**
 * Contracts for the Koswork Browser Research Cycle (`gemini/koswork-browser-research`).
 *
 * Enforces explicit source provenance (`providerId`, `url`, `canonicalUrl`, `title`,
 * distinct `pageDate` / `eventDate` / `fetchedAt`), UTF-16 excerpt bindings (`startUtf16`, `endUtf16`, `quote`),
 * and epistemic claim classification (bare links without excerpts are never accepted as proof).
 */

export type BrowserSearchActor = "user" | "agent";

export type BrowserClaimEvidenceGrade =
  | "confirmed_multi_source"
  | "confirmed_single_source"
  | "confirmed_with_utf16_excerpt"
  | "conflicting_evidence"
  | "conflicting_evidence_newer"
  | "outdated_superseded"
  | "unverified_bare_link"
  | "source_unavailable";

export interface BrowserSearchReceiptContract {
  searchId: string;
  ownerId: string;
  actor: BrowserSearchActor;
  query: string;
  providerId: string;
  providerEndpoint: string;
  totalResults: number;
  searchedAt: string;
}

export interface BrowserSourceRecordContract {
  sourceId: string;
  searchId: string | null;
  ownerId: string;
  tabId: string;
  receiptId: string;
  url: string;
  canonicalUrl: string;
  title: string;
  httpStatus: number;
  available: boolean;
  pageVersion: number;
  /** Date published/updated as stated on the page itself */
  pageDate: string | null;
  /** Date of the event/effective metric described in the document */
  eventDate: string | null;
  /** ISO-8601 timestamp when Koswork retrieved the page */
  fetchedAt: string;
}

export interface BrowserUtf16ExcerptContract {
  excerptId: string;
  sourceId: string;
  ownerId: string;
  snapshotId: string;
  pageVersion: number;
  startUtf16: number;
  endUtf16: number;
  quote: string;
  quoteSha256: string;
  createdAt: string;
}

export interface BrowserVerifiedClaimContract {
  claimId: string;
  claim: string;
  optionName: string | null;
  criterion: string | null;
  value: string | number | null;
  isOutdated: boolean;
  outdatedNote: string | null;
  evidenceGrade: BrowserClaimEvidenceGrade;
  excerpt: {
    excerptId: string;
    quote: string;
    startUtf16: number;
    endUtf16: number;
    pageVersion: number;
  };
  source: {
    sourceId?: string;
    url: string;
    title: string;
    pageDate: string | null;
    eventDate: string | null;
    fetchedAt: string;
  };
}

export interface BrowserUnconfirmedClaimContract {
  claimId: string;
  claim: string;
  optionName: string | null;
  criterion: string | null;
  candidateUrl: string | null;
  reason: string;
}

export interface BrowserContradictionSideContract {
  value: string | number | null;
  quote: string;
  startUtf16: number;
  endUtf16: number;
  url: string;
  title: string;
  pageDate: string | null;
  eventDate: string | null;
}

export interface BrowserContradictionContract {
  optionName: string | null;
  criterion: string;
  summary: string;
  sideA: BrowserContradictionSideContract;
  sideB: BrowserContradictionSideContract;
}

export interface BrowserResourceMetricsContract {
  maxLiveTabs: number;
  liveTabCount: number;
  hibernatedTabCount: number;
  hibernationEventsCount: number;
  snapshotReuseCount: number;
  ramTelemetry: {
    currentRssMb: number;
    currentHeapUsedMb: number;
    peakRssMb: number;
    peakHeapUsedMb: number;
    externalMb: number;
  };
  latencyTelemetry: {
    totalCompletedOps: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
  };
}

export interface BrowserResearchReportContract {
  reportId: string;
  ownerId: string;
  question: string;
  criteria: string[];
  confirmedClaims: BrowserVerifiedClaimContract[];
  unconfirmedClaims: BrowserUnconfirmedClaimContract[];
  contradictions: BrowserContradictionContract[];
  outdatedFindings: Array<{
    optionName: string | null;
    criterion: string;
    url: string;
    title: string;
    pageDate: string | null;
    eventDate: string | null;
    supersededByDate: string;
    note: string;
  }>;
  unavailableSources: Array<{
    url: string;
    title: string;
    httpStatus: number;
    reason: string;
    fetchedAt: string;
  }>;
  substitutionIncidents: Array<{
    url: string;
    title: string;
    observedPageVersion: number;
    currentPageVersion: number;
    startUtf16: number;
    endUtf16: number;
    expectedText: string;
    actualTextAtOffsets: string;
  }>;
  resourceMetrics: BrowserResourceMetricsContract;
  markdownPath: string;
  htmlPath: string;
  csvPath: string | null;
  createdAt: string;
}
