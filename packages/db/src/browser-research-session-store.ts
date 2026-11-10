import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  BrowserResearchReportContract,
  BrowserSearchReceiptContract,
  BrowserSourceRecordContract,
  BrowserUnconfirmedClaimContract,
  BrowserUtf16ExcerptContract,
  BrowserVerifiedClaimContract
} from "../../contracts/src/koswork-browser-research.ts";

/**
 * Durable SQLite Session & Provenance Store for the Koswork Browser Research Cycle
 * (`packages/db/src/browser-research-session-store.ts`).
 *
 * Persists:
 * 1. Search queries with explicit `provider_id` / `provider_endpoint` (no fake "proprietary internet index")
 * 2. Opened sources with distinct `page_date`, `event_date`, and `fetched_at`
 * 3. UTF-16 code unit excerpts (`start_utf16`, `end_utf16`, `quote`, `quote_sha256`)
 * 4. Multi-site research reports (`claim -> excerpt -> source`), rejecting bare links without excerpts
 * 5. Complete owner-scoped privacy purge (`purgeOwnerBrowserResearchData`)
 */
export class KosworkBrowserResearchSessionStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.ensureSchema();
  }

  public ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS koswork_browser_searches (
        search_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        actor TEXT NOT NULL CHECK (actor IN ('user', 'agent')),
        query TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        provider_endpoint TEXT NOT NULL,
        total_results INTEGER NOT NULL DEFAULT 0,
        searched_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_koswork_browser_searches_owner
        ON koswork_browser_searches(owner_id, searched_at DESC);

      CREATE TABLE IF NOT EXISTS koswork_browser_sources (
        source_id TEXT PRIMARY KEY,
        search_id TEXT,
        owner_id TEXT NOT NULL,
        tab_id TEXT NOT NULL,
        receipt_id TEXT NOT NULL,
        url TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        title TEXT NOT NULL,
        http_status INTEGER NOT NULL DEFAULT 200,
        available INTEGER NOT NULL DEFAULT 1,
        page_version INTEGER NOT NULL DEFAULT 1,
        page_date TEXT,
        event_date TEXT,
        fetched_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_koswork_browser_sources_owner
        ON koswork_browser_sources(owner_id, fetched_at DESC);

      CREATE TABLE IF NOT EXISTS koswork_browser_excerpts (
        excerpt_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        page_version INTEGER NOT NULL DEFAULT 1,
        start_utf16 INTEGER NOT NULL,
        end_utf16 INTEGER NOT NULL,
        quote TEXT NOT NULL,
        quote_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK (end_utf16 > start_utf16 AND start_utf16 >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_koswork_browser_excerpts_source
        ON koswork_browser_excerpts(source_id, start_utf16);

      CREATE TABLE IF NOT EXISTS koswork_browser_research_reports (
        report_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        question TEXT NOT NULL,
        criteria_json TEXT NOT NULL,
        confirmed_claims_json TEXT NOT NULL,
        unconfirmed_claims_json TEXT NOT NULL,
        contradictions_json TEXT NOT NULL,
        outdated_findings_json TEXT NOT NULL,
        unavailable_sources_json TEXT NOT NULL,
        substitution_incidents_json TEXT NOT NULL,
        resource_metrics_json TEXT NOT NULL,
        markdown_path TEXT NOT NULL,
        html_path TEXT NOT NULL,
        csv_path TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  public recordSearch(input: BrowserSearchReceiptContract): BrowserSearchReceiptContract {
    if (!input.providerId || input.providerId === "koswork-proprietary-internet-index") {
      throw new Error("INVALID_SEARCH_PROVIDER_PROVENANCE: Must specify real search provider origin");
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO koswork_browser_searches
          (search_id, owner_id, actor, query, provider_id, provider_endpoint, total_results, searched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.searchId,
        input.ownerId,
        input.actor,
        input.query,
        input.providerId,
        input.providerEndpoint,
        input.totalResults,
        input.searchedAt
      );
    return input;
  }

  public recordSourceVisit(input: BrowserSourceRecordContract): BrowserSourceRecordContract {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO koswork_browser_sources
          (source_id, search_id, owner_id, tab_id, receipt_id, url, canonical_url, title,
           http_status, available, page_version, page_date, event_date, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.sourceId,
        input.searchId,
        input.ownerId,
        input.tabId,
        input.receiptId,
        input.url,
        input.canonicalUrl,
        input.title,
        input.httpStatus,
        input.available ? 1 : 0,
        input.pageVersion,
        input.pageDate,
        input.eventDate,
        input.fetchedAt
      );
    return input;
  }

  public recordExcerpt(
    input: Omit<BrowserUtf16ExcerptContract, "quoteSha256"> & { quoteSha256?: string }
  ): BrowserUtf16ExcerptContract {
    if (input.endUtf16 <= input.startUtf16 || input.startUtf16 < 0) {
      throw new Error("INVALID_UTF16_EXCERPT_OFFSETS");
    }
    const quoteSha256 =
      input.quoteSha256 ??
      crypto.createHash("sha256").update(input.quote, "utf8").digest("hex");

    const record: BrowserUtf16ExcerptContract = {
      ...input,
      quoteSha256
    };

    this.db
      .prepare(
        `INSERT OR REPLACE INTO koswork_browser_excerpts
          (excerpt_id, source_id, owner_id, snapshot_id, page_version, start_utf16, end_utf16,
           quote, quote_sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.excerptId,
        record.sourceId,
        record.ownerId,
        record.snapshotId,
        record.pageVersion,
        record.startUtf16,
        record.endUtf16,
        record.quote,
        record.quoteSha256,
        record.createdAt
      );
    return record;
  }

  /**
   * Verifies a candidate claim against stored sources and UTF-16 excerpts.
   * Enforces the rule that a bare link without a verified UTF-16 excerpt is NEVER proof of a claim.
   */
  public verifyClaimLinkage(params: {
    ownerId: string;
    claimId: string;
    claim: string;
    optionName?: string | null;
    criterion?: string | null;
    value?: string | number | null;
    sourceId?: string | null;
    excerptId?: string | null;
    candidateUrl?: string | null;
  }):
    | { verified: true; confirmed: BrowserVerifiedClaimContract }
    | { verified: false; unconfirmed: BrowserUnconfirmedClaimContract } {
    if (!params.sourceId || !params.excerptId) {
      return {
        verified: false,
        unconfirmed: {
          claimId: params.claimId,
          claim: params.claim,
          optionName: params.optionName ?? null,
          criterion: params.criterion ?? null,
          candidateUrl: params.candidateUrl ?? null,
          reason:
            "Отсутствует привязка к выдержке (excerptId): сама по себе ссылка не является доказательством утверждения."
        }
      };
    }

    const srcRow = this.db
      .prepare(
        `SELECT * FROM koswork_browser_sources WHERE source_id = ? AND owner_id = ?`
      )
      .get(params.sourceId, params.ownerId) as Record<string, unknown> | undefined;

    if (!srcRow || Number(srcRow.available) === 0 || Number(srcRow.http_status) >= 400) {
      return {
        verified: false,
        unconfirmed: {
          claimId: params.claimId,
          claim: params.claim,
          optionName: params.optionName ?? null,
          criterion: params.criterion ?? null,
          candidateUrl: srcRow ? String(srcRow.url) : (params.candidateUrl ?? null),
          reason: "Источник недоступен (HTTP 404/503 или сбой соединения)."
        }
      };
    }

    const excRow = this.db
      .prepare(
        `SELECT * FROM koswork_browser_excerpts WHERE excerpt_id = ? AND source_id = ? AND owner_id = ?`
      )
      .get(params.excerptId, params.sourceId, params.ownerId) as Record<string, unknown> | undefined;

    if (!excRow || !String(excRow.quote || "").trim()) {
      return {
        verified: false,
        unconfirmed: {
          claimId: params.claimId,
          claim: params.claim,
          optionName: params.optionName ?? null,
          criterion: params.criterion ?? null,
          candidateUrl: String(srcRow.url),
          reason: "Выдержка не найдена в открытом источнике."
        }
      };
    }

    return {
      verified: true,
      confirmed: {
        claimId: params.claimId,
        claim: params.claim,
        optionName: params.optionName ?? null,
        criterion: params.criterion ?? null,
        value: params.value ?? null,
        isOutdated: false,
        outdatedNote: null,
        evidenceGrade: "confirmed_with_utf16_excerpt",
        excerpt: {
          excerptId: String(excRow.excerpt_id),
          quote: String(excRow.quote),
          startUtf16: Number(excRow.start_utf16),
          endUtf16: Number(excRow.end_utf16),
          pageVersion: Number(excRow.page_version)
        },
        source: {
          sourceId: String(srcRow.source_id),
          url: String(srcRow.url),
          title: String(srcRow.title),
          pageDate: srcRow.page_date ? String(srcRow.page_date) : null,
          eventDate: srcRow.event_date ? String(srcRow.event_date) : null,
          fetchedAt: String(srcRow.fetched_at)
        }
      }
    };
  }

  public saveResearchReport(report: BrowserResearchReportContract): BrowserResearchReportContract {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO koswork_browser_research_reports
          (report_id, owner_id, question, criteria_json, confirmed_claims_json,
           unconfirmed_claims_json, contradictions_json, outdated_findings_json,
           unavailable_sources_json, substitution_incidents_json, resource_metrics_json,
           markdown_path, html_path, csv_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        report.reportId,
        report.ownerId,
        report.question,
        JSON.stringify(report.criteria),
        JSON.stringify(report.confirmedClaims),
        JSON.stringify(report.unconfirmedClaims),
        JSON.stringify(report.contradictions),
        JSON.stringify(report.outdatedFindings),
        JSON.stringify(report.unavailableSources),
        JSON.stringify(report.substitutionIncidents),
        JSON.stringify(report.resourceMetrics),
        report.markdownPath,
        report.htmlPath,
        report.csvPath,
        report.createdAt
      );
    return report;
  }

  public getResearchReport(
    reportId: string,
    ownerId: string
  ): BrowserResearchReportContract | null {
    const row = this.db
      .prepare(
        `SELECT * FROM koswork_browser_research_reports WHERE report_id = ? AND owner_id = ?`
      )
      .get(reportId, ownerId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      reportId: String(row.report_id),
      ownerId: String(row.owner_id),
      question: String(row.question),
      criteria: JSON.parse(String(row.criteria_json)),
      confirmedClaims: JSON.parse(String(row.confirmed_claims_json)),
      unconfirmedClaims: JSON.parse(String(row.unconfirmed_claims_json)),
      contradictions: JSON.parse(String(row.contradictions_json)),
      outdatedFindings: JSON.parse(String(row.outdated_findings_json)),
      unavailableSources: JSON.parse(String(row.unavailable_sources_json)),
      substitutionIncidents: JSON.parse(String(row.substitution_incidents_json)),
      resourceMetrics: JSON.parse(String(row.resource_metrics_json)),
      markdownPath: String(row.markdown_path),
      htmlPath: String(row.html_path),
      csvPath: row.csv_path ? String(row.csv_path) : null,
      createdAt: String(row.created_at)
    };
  }

  public purgeOwnerBrowserResearchData(ownerId: string): {
    deletedSearches: number;
    deletedSources: number;
    deletedExcerpts: number;
    deletedReports: number;
  } {
    const rExcerpts = this.db
      .prepare(`DELETE FROM koswork_browser_excerpts WHERE owner_id = ?`)
      .run(ownerId);
    const rSources = this.db
      .prepare(`DELETE FROM koswork_browser_sources WHERE owner_id = ?`)
      .run(ownerId);
    const rSearches = this.db
      .prepare(`DELETE FROM koswork_browser_searches WHERE owner_id = ?`)
      .run(ownerId);
    const rReports = this.db
      .prepare(`DELETE FROM koswork_browser_research_reports WHERE owner_id = ?`)
      .run(ownerId);

    return {
      deletedSearches: Number(rSearches.changes),
      deletedSources: Number(rSources.changes),
      deletedExcerpts: Number(rExcerpts.changes),
      deletedReports: Number(rReports.changes)
    };
  }
}
