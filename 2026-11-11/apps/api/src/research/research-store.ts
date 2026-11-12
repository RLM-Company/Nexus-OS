import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type CandidateClaimExtraction,
  type SynthesizedResearchClaim,
  renderDeterministicResearchReportMarkdown,
  sha256Hex
} from "./research-synthesis.js";

export type ResearchRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelled"
  | "failed"
  | "completed";

export type ResearchStepKind = "search" | "read_source" | "synthesize";
export type ResearchStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export interface ResearchStepRecord {
  runId: string;
  stepIndex: number;
  stepKey: string;
  stepKind: ResearchStepKind;
  targetUrl: string | null;
  depth: number;
  status: ResearchStepStatus;
  attempts: number;
  checkpoint: Record<string, unknown>;
  errorCode: string | null;
  updatedAt: string;
}

export interface StoredResearchSource {
  sourceId: string;
  runId: string;
  ownerId: string;
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  domain: string;
  fetchedAt: string;
  publishedAt: string | null;
  pageVersion: string;
  previousPageVersion: string | null;
  pageChanged: boolean;
  contentSha256: string;
  contentText: string;
  depth: number;
  httpStatus: number;
  extractedClaims: CandidateClaimExtraction[];
}

export interface ResearchRunView {
  id: string;
  ownerId: string;
  projectId: string | null;
  query: string;
  normalizedQuery: string;
  clientRequestId: string | null;
  status: ResearchRunStatus;
  progress: {
    currentStepIndex: number;
    totalSteps: number;
    completedSteps: number;
    pendingSteps: number;
    failedSteps: number;
    percent: number;
  };
  budgets: {
    maxDepth: number;
    maxSources: number;
    maxRuntimeMs: number;
    elapsedMs: number;
    depthReached: number;
    sourcesRead: number;
  };
  steps: ResearchStepRecord[];
  sources: StoredResearchSource[];
  confirmedClaims: SynthesizedResearchClaim[];
  conflictingClaims: SynthesizedResearchClaim[];
  unconfirmedClaims: SynthesizedResearchClaim[];
  reportMarkdown: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export function canonicalizeSourceUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ref",
      "_hsenc"
    ];
    for (const p of trackingParams) {
      parsed.searchParams.delete(p);
    }
    parsed.hash = "";
    const sortedParams = Array.from(parsed.searchParams.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    parsed.search = "";
    for (const [k, v] of sortedParams) {
      parsed.searchParams.append(k, v);
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${cleanPath}${parsed.search}`;
  } catch {
    return String(rawUrl ?? "").trim();
  }
}

export function normalizeResearchQuery(query: string): string {
  return String(query ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Canonical persistent SQLite store imported by `apps/api/src/server.ts` and `apps/api/src/app.ts`:
 * `const researchStore = new ResearchStore(database.sqlite);`
 *
 * Compatible with existing `research_runs` table (`google-drive-restore.ts`) and automatically
 * provisions additive columns and checkpoint tables (`research_run_steps`, `research_sources`, `research_claims`).
 */
export class ResearchStore {
  constructor(
    public readonly sqlite: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_owner_data_lifecycle (
        owner_id TEXT PRIMARY KEY NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',
        epoch INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS research_runs (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        project_id TEXT,
        query TEXT NOT NULL,
        status TEXT NOT NULL,
        report_markdown TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS research_run_steps (
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        step_key TEXT NOT NULL,
        step_kind TEXT NOT NULL,
        target_url TEXT,
        depth INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        checkpoint_json TEXT NOT NULL DEFAULT '{}',
        error_code TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (run_id, step_index),
        UNIQUE (run_id, step_key)
      );

      CREATE TABLE IF NOT EXISTS research_sources (
        source_id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        original_url TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        title TEXT NOT NULL,
        domain TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        published_at TEXT,
        page_version TEXT NOT NULL,
        previous_page_version TEXT,
        page_changed INTEGER NOT NULL DEFAULT 0,
        content_sha256 TEXT NOT NULL,
        content_text TEXT NOT NULL,
        extracted_claims_json TEXT NOT NULL DEFAULT '[]',
        depth INTEGER NOT NULL DEFAULT 1,
        http_status INTEGER NOT NULL DEFAULT 200,
        UNIQUE (run_id, canonical_url)
      );

      CREATE TABLE IF NOT EXISTS research_claims (
        claim_id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        criterion TEXT NOT NULL,
        category TEXT NOT NULL,
        resolved_value TEXT NOT NULL,
        conflict_summary TEXT,
        unconfirmed_reason TEXT,
        citations_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        UNIQUE (run_id, subject, criterion)
      );
    `);

    const existingCols = new Set(
      (
        this.sqlite.prepare("PRAGMA table_info(research_runs)").all() as Array<{ name: string }>
      ).map((c) => c.name)
    );

    const additiveCols: Array<[string, string]> = [
      ["normalized_query", "TEXT NOT NULL DEFAULT ''"],
      ["client_request_id", "TEXT"],
      ["current_step_index", "INTEGER NOT NULL DEFAULT 0"],
      ["total_steps", "INTEGER NOT NULL DEFAULT 0"],
      ["max_depth", "INTEGER NOT NULL DEFAULT 2"],
      ["max_sources", "INTEGER NOT NULL DEFAULT 6"],
      ["max_runtime_ms", "INTEGER NOT NULL DEFAULT 15000"],
      ["elapsed_ms", "INTEGER NOT NULL DEFAULT 0"],
      ["depth_reached", "INTEGER NOT NULL DEFAULT 0"],
      ["expected_targets_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["error_code", "TEXT"],
      ["error_message", "TEXT"],
      ["report_json", "TEXT"]
    ];

    for (const [colName, colDef] of additiveCols) {
      if (!existingCols.has(colName)) {
        this.sqlite.exec(`ALTER TABLE research_runs ADD COLUMN ${colName} ${colDef}`);
      }
    }
  }

  public assertOwnerActive(ownerId: string): void {
    if (!ownerId || typeof ownerId !== "string") {
      throw new Error("OWNER_AUTH_REQUIRED");
    }
    const row = this.sqlite
      .prepare("SELECT state FROM kosmora_owner_data_lifecycle WHERE owner_id = ?")
      .get(ownerId) as { state: string } | undefined;
    if (row && row.state !== "active") {
      throw new Error("OWNER_DATA_FENCED");
    }
  }

  public assertProjectAccess(ownerId: string, projectId: string | null): void {
    if (!projectId) return;
    const tableRow = this.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
      .get() as { name: string } | undefined;
    if (!tableRow) return;

    const projRow = this.sqlite
      .prepare("SELECT owner_id FROM projects WHERE id = ?")
      .get(projectId) as { owner_id: string } | undefined;
    if (!projRow) {
      throw new Error("RESEARCH_PROJECT_NOT_FOUND");
    }
    if (projRow.owner_id !== ownerId) {
      throw new Error("RESEARCH_PROJECT_FORBIDDEN");
    }
  }

  /**
   * Finds an existing run for idempotent retries:
   * 1. Exact `(ownerId, projectId, clientRequestId)` match
   * 2. Or an already-active/completed run with the same `(ownerId, projectId, normalizedQuery)` when `deduplicateQuery !== false`.
   */
  public findIdempotentRun(params: {
    ownerId: string;
    projectId: string | null;
    query: string;
    clientRequestId?: string | null;
    deduplicateQuery?: boolean;
  }): ResearchRunView | null {
    const { ownerId, projectId } = params;
    this.assertOwnerActive(ownerId);

    if (params.clientRequestId) {
      const byReq = this.sqlite
        .prepare(
          `SELECT id FROM research_runs
           WHERE owner_id = ? AND IFNULL(project_id, '') = IFNULL(?, '') AND client_request_id = ?
           LIMIT 1`
        )
        .get(ownerId, projectId, params.clientRequestId) as { id: string } | undefined;
      if (byReq) {
        return this.getRunForOwner(byReq.id, ownerId);
      }
    }

    if (params.deduplicateQuery !== false) {
      const norm = normalizeResearchQuery(params.query);
      const byQuery = this.sqlite
        .prepare(
          `SELECT id FROM research_runs
           WHERE owner_id = ? AND IFNULL(project_id, '') = IFNULL(?, '')
             AND normalized_query = ?
             AND status IN ('running', 'completed')
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(ownerId, projectId, norm) as { id: string } | undefined;
      if (byQuery) {
        return this.getRunForOwner(byQuery.id, ownerId);
      }
    }

    return null;
  }

  public createRunWithSteps(input: {
    ownerId: string;
    projectId: string | null;
    query: string;
    clientRequestId?: string | null;
    maxDepth: number;
    maxSources: number;
    maxRuntimeMs: number;
    expectedTargets: Array<{ subject: string; criterion: string }>;
    steps: Array<{
      stepKey: string;
      stepKind: ResearchStepKind;
      targetUrl?: string | null;
      depth?: number;
    }>;
  }): ResearchRunView {
    this.assertOwnerActive(input.ownerId);
    this.assertProjectAccess(input.ownerId, input.projectId);

    const existing = this.findIdempotentRun({
      ownerId: input.ownerId,
      projectId: input.projectId,
      query: input.query,
      clientRequestId: input.clientRequestId,
      deduplicateQuery: true
    });
    if (existing) {
      return existing;
    }

    const runId = `res_run_${randomUUID()}`;
    const ts = this.now();
    const normQuery = normalizeResearchQuery(input.query);

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite
        .prepare(
          `INSERT INTO research_runs (
            id, owner_id, project_id, query, normalized_query, client_request_id,
            status, current_step_index, total_steps, max_depth, max_sources, max_runtime_ms,
            elapsed_ms, depth_reached, expected_targets_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
        )
        .run(
          runId,
          input.ownerId,
          input.projectId,
          input.query,
          normQuery,
          input.clientRequestId ?? null,
          input.steps.length,
          input.maxDepth,
          input.maxSources,
          input.maxRuntimeMs,
          JSON.stringify(input.expectedTargets ?? []),
          ts,
          ts
        );

      const insertStep = this.sqlite.prepare(
        `INSERT INTO research_run_steps (
          run_id, step_index, step_key, step_kind, target_url, depth, status, attempts, checkpoint_json, error_code, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, '{}', NULL, ?)`
      );

      input.steps.forEach((step, idx) => {
        insertStep.run(
          runId,
          idx,
          step.stepKey,
          step.stepKind,
          step.targetUrl ?? null,
          step.depth ?? 1,
          ts
        );
      });

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }

    return this.getRunForOwner(runId, input.ownerId);
  }

  /**
   * Appends discovered source-read steps dynamically after search step completes,
   * deduplicating by canonical URL and respecting `maxSources` and `maxDepth`.
   */
  public registerDiscoveredSourceSteps(
    runId: string,
    ownerId: string,
    candidates: Array<{ url: string; depth: number }>
  ): ResearchStepRecord[] {
    const run = this.requireRunRow(runId, ownerId);
    const existingSteps = this.listSteps(runId);
    const seenCanonicalUrls = new Set<string>();

    for (const s of existingSteps) {
      if (s.targetUrl) {
        seenCanonicalUrls.add(canonicalizeSourceUrl(s.targetUrl));
      }
    }

    const currentReadSteps = existingSteps.filter((s) => s.stepKind === "read_source").length;
    let remainingBudget = Math.max(0, Number(run.max_sources) - currentReadSteps);
    const maxDepth = Number(run.max_depth);

    // Shift synthesize step to the end if it exists and is still pending
    const synthStep = existingSteps.find((s) => s.stepKind === "synthesize");
    const nonSynthSteps = existingSteps.filter((s) => s.stepKind !== "synthesize");
    const toInsert: Array<{ stepKey: string; targetUrl: string; depth: number }> = [];

    for (const cand of candidates) {
      if (remainingBudget <= 0) break;
      if (cand.depth > maxDepth) continue;
      const canonical = canonicalizeSourceUrl(cand.url);
      if (!canonical || seenCanonicalUrls.has(canonical)) continue;
      seenCanonicalUrls.add(canonical);
      remainingBudget -= 1;
      toInsert.push({
        stepKey: `read_source:${canonical}`,
        targetUrl: cand.url,
        depth: cand.depth
      });
    }

    if (toInsert.length === 0) {
      return this.listSteps(runId);
    }

    const ts = this.now();
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      if (synthStep) {
        this.sqlite
          .prepare("DELETE FROM research_run_steps WHERE run_id = ? AND step_key = ?")
          .run(runId, synthStep.stepKey);
      }

      let nextIndex = nonSynthSteps.length;
      const insertStmt = this.sqlite.prepare(
        `INSERT INTO research_run_steps (
          run_id, step_index, step_key, step_kind, target_url, depth, status, attempts, checkpoint_json, error_code, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, '{}', NULL, ?)`
      );

      for (const item of toInsert) {
        insertStmt.run(
          runId,
          nextIndex++,
          item.stepKey,
          "read_source",
          item.targetUrl,
          item.depth,
          ts
        );
      }

      if (synthStep) {
        insertStmt.run(
          runId,
          nextIndex++,
          synthStep.stepKey,
          "synthesize",
          null,
          1,
          ts
        );
      }

      this.sqlite
        .prepare("UPDATE research_runs SET total_steps = ?, updated_at = ? WHERE id = ?")
        .run(nextIndex, ts, runId);

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }

    return this.listSteps(runId);
  }

  public updateRunStatus(
    runId: string,
    ownerId: string,
    patch: {
      status?: ResearchRunStatus;
      currentStepIndex?: number;
      elapsedMs?: number;
      depthReached?: number;
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  ): void {
    const run = this.requireRunRow(runId, ownerId);
    const ts = this.now();
    this.sqlite
      .prepare(
        `UPDATE research_runs
         SET status = ?,
             current_step_index = ?,
             elapsed_ms = ?,
             depth_reached = ?,
             error_code = ?,
             error_message = ?,
             updated_at = ?
         WHERE id = ? AND owner_id = ?`
      )
      .run(
        patch.status ?? run.status,
        patch.currentStepIndex ?? run.current_step_index,
        patch.elapsedMs ?? run.elapsed_ms,
        Math.max(Number(run.depth_reached || 0), Number(patch.depthReached || 0)),
        patch.errorCode !== undefined ? patch.errorCode : run.error_code,
        patch.errorMessage !== undefined ? patch.errorMessage : run.error_message,
        ts,
        runId,
        ownerId
      );
  }

  public checkpointStep(
    runId: string,
    ownerId: string,
    stepKey: string,
    patch: {
      status: ResearchStepStatus;
      incrementAttempts?: boolean;
      checkpoint?: Record<string, unknown>;
      errorCode?: string | null;
    }
  ): ResearchStepRecord {
    this.requireRunRow(runId, ownerId);
    const existing = this.sqlite
      .prepare("SELECT * FROM research_run_steps WHERE run_id = ? AND step_key = ?")
      .get(runId, stepKey) as Record<string, unknown> | undefined;
    if (!existing) {
      throw new Error(`RESEARCH_STEP_NOT_FOUND:${stepKey}`);
    }

    const attempts = Number(existing.attempts || 0) + (patch.incrementAttempts ? 1 : 0);
    const prevCheckpoint = (() => {
      try {
        return JSON.parse(String(existing.checkpoint_json || "{}")) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    const mergedCheckpoint = patch.checkpoint
      ? { ...prevCheckpoint, ...patch.checkpoint }
      : prevCheckpoint;
    const ts = this.now();

    this.sqlite
      .prepare(
        `UPDATE research_run_steps
         SET status = ?, attempts = ?, checkpoint_json = ?, error_code = ?, updated_at = ?
         WHERE run_id = ? AND step_key = ?`
      )
      .run(
        patch.status,
        attempts,
        JSON.stringify(mergedCheckpoint),
        patch.errorCode ?? null,
        ts,
        runId,
        stepKey
      );

    this.sqlite
      .prepare(
        `UPDATE research_runs
         SET current_step_index = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(Number(existing.step_index), ts, runId);

    return this.listSteps(runId).find((s) => s.stepKey === stepKey)!;
  }

  /**
   * Upserts a source snapshot deduplicated by `(runId, canonicalUrl)`.
   * If the page already existed with a different `pageVersion` or `contentSha256`,
   * records `previousPageVersion` and sets `pageChanged = true`.
   */
  public upsertSourceSnapshot(
    runId: string,
    ownerId: string,
    input: {
      originalUrl: string;
      title: string;
      fetchedAt?: string;
      publishedAt?: string | null;
      pageVersion?: string;
      initialExpectedVersion?: string | null;
      contentText: string;
      depth?: number;
      httpStatus?: number;
      extractedClaims?: CandidateClaimExtraction[];
    }
  ): StoredResearchSource {
    this.requireRunRow(runId, ownerId);
    const canonicalUrl = canonicalizeSourceUrl(input.originalUrl);
    const contentSha256 = sha256Hex(input.contentText);
    const computedVersion = input.pageVersion || `pv-${contentSha256.slice(0, 12)}`;
    const fetchedAt = input.fetchedAt || this.now();
    const domain = (() => {
      try {
        return new URL(canonicalUrl).hostname.toLowerCase();
      } catch {
        return "local.fixture";
      }
    })();

    const existing = this.sqlite
      .prepare(
        "SELECT * FROM research_sources WHERE run_id = ? AND canonical_url = ? LIMIT 1"
      )
      .get(runId, canonicalUrl) as Record<string, unknown> | undefined;

    if (!existing) {
      const sourceId = `src_${randomUUID().slice(0, 12)}`;
      const changedFromInitial =
        Boolean(input.initialExpectedVersion) &&
        input.initialExpectedVersion !== computedVersion;
      const previousPageVersion = changedFromInitial
        ? String(input.initialExpectedVersion)
        : null;

      this.sqlite
        .prepare(
          `INSERT INTO research_sources (
            source_id, run_id, owner_id, original_url, canonical_url, title, domain,
            fetched_at, published_at, page_version, previous_page_version, page_changed,
            content_sha256, content_text, extracted_claims_json, depth, http_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sourceId,
          runId,
          ownerId,
          input.originalUrl,
          canonicalUrl,
          input.title,
          domain,
          fetchedAt,
          input.publishedAt ?? null,
          computedVersion,
          previousPageVersion,
          changedFromInitial ? 1 : 0,
          contentSha256,
          input.contentText,
          JSON.stringify(input.extractedClaims ?? []),
          input.depth ?? 1,
          input.httpStatus ?? 200
        );
    } else {
      const oldVersion = String(existing.page_version);
      const oldSha = String(existing.content_sha256);
      const versionChanged = oldVersion !== computedVersion || oldSha !== contentSha256;
      const prevVersion = versionChanged
        ? oldVersion
        : existing.previous_page_version
          ? String(existing.previous_page_version)
          : input.initialExpectedVersion && input.initialExpectedVersion !== computedVersion
            ? String(input.initialExpectedVersion)
            : null;
      const pageChanged =
        versionChanged || Boolean(existing.page_changed) || Boolean(prevVersion);

      this.sqlite
        .prepare(
          `UPDATE research_sources
           SET title = ?,
               fetched_at = ?,
               published_at = ?,
               page_version = ?,
               previous_page_version = ?,
               page_changed = ?,
               content_sha256 = ?,
               content_text = ?,
               extracted_claims_json = ?,
               http_status = ?
           WHERE run_id = ? AND canonical_url = ?`
        )
        .run(
          input.title,
          fetchedAt,
          input.publishedAt ?? (existing.published_at ? String(existing.published_at) : null),
          computedVersion,
          prevVersion,
          pageChanged ? 1 : 0,
          contentSha256,
          input.contentText,
          JSON.stringify(input.extractedClaims ?? []),
          input.httpStatus ?? 200,
          runId,
          canonicalUrl
        );
    }

    return this.listSources(runId).find((s) => s.canonicalUrl === canonicalUrl)!;
  }

  public saveSynthesizedClaimsAndReport(
    runId: string,
    ownerId: string,
    claims: SynthesizedResearchClaim[],
    status: ResearchRunStatus = "completed"
  ): ResearchRunView {
    const runRow = this.requireRunRow(runId, ownerId);
    const sources = this.listSources(runId);
    const ts = this.now();

    const confirmedClaims = claims.filter((c) => c.category === "confirmed");
    const conflictingClaims = claims.filter((c) => c.category === "conflicting");
    const unconfirmedClaims = claims.filter((c) => c.category === "unconfirmed");

    const reportMarkdown = renderDeterministicResearchReportMarkdown({
      runId,
      query: String(runRow.query),
      status,
      sources,
      confirmedClaims,
      conflictingClaims,
      unconfirmedClaims
    });

    const reportJson = JSON.stringify({
      runId,
      query: String(runRow.query),
      status,
      sources: sources.map((s) => ({
        sourceId: s.sourceId,
        title: s.title,
        originalUrl: s.originalUrl,
        canonicalUrl: s.canonicalUrl,
        fetchedAt: s.fetchedAt,
        pageVersion: s.pageVersion,
        previousPageVersion: s.previousPageVersion,
        pageChanged: s.pageChanged
      })),
      confirmedClaims,
      conflictingClaims,
      unconfirmedClaims,
      reportMarkdown
    });

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.prepare("DELETE FROM research_claims WHERE run_id = ?").run(runId);
      const insertClaim = this.sqlite.prepare(
        `INSERT INTO research_claims (
          claim_id, run_id, owner_id, subject, criterion, category,
          resolved_value, conflict_summary, unconfirmed_reason, citations_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const c of claims) {
        insertClaim.run(
          c.claimId,
          runId,
          ownerId,
          c.subject,
          c.criterion,
          c.category,
          c.resolvedValue,
          c.conflictSummary,
          c.unconfirmedReason,
          JSON.stringify(c.citations),
          ts
        );
      }

      this.sqlite
        .prepare(
          `UPDATE research_runs
           SET status = ?, report_markdown = ?, report_json = ?, error_code = NULL, error_message = NULL, updated_at = ?
           WHERE id = ? AND owner_id = ?`
        )
        .run(status, reportMarkdown, reportJson, ts, runId, ownerId);

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }

    return this.getRunForOwner(runId, ownerId);
  }

  public getExpectedTargets(runId: string, ownerId: string): Array<{ subject: string; criterion: string }> {
    const row = this.requireRunRow(runId, ownerId);
    try {
      return JSON.parse(String(row.expected_targets_json || "[]")) as Array<{
        subject: string;
        criterion: string;
      }>;
    } catch {
      return [];
    }
  }

  public getRunForOwner(runId: string, ownerId: string): ResearchRunView {
    this.assertOwnerActive(ownerId);
    const row = this.requireRunRow(runId, ownerId);
    if (row.project_id) {
      this.assertProjectAccess(ownerId, String(row.project_id));
    }
    return this.hydrateRunView(row);
  }

  public listRunsForOwner(ownerId: string, projectId?: string | null): ResearchRunView[] {
    this.assertOwnerActive(ownerId);
    if (projectId) {
      this.assertProjectAccess(ownerId, projectId);
    }

    const rows = projectId
      ? (this.sqlite
          .prepare(
            "SELECT * FROM research_runs WHERE owner_id = ? AND project_id = ? ORDER BY created_at DESC"
          )
          .all(ownerId, projectId) as Array<Record<string, unknown>>)
      : (this.sqlite
          .prepare("SELECT * FROM research_runs WHERE owner_id = ? ORDER BY created_at DESC")
          .all(ownerId) as Array<Record<string, unknown>>);

    return rows.map((r) => this.hydrateRunView(r));
  }

  /**
   * Marks any runs left in `'running'` state after a sudden process crash as `'failed'`
   * with `INTERRUPTED_BY_RESTART`, preserving all completed step checkpoints so `resumeRun`
   * only executes the remaining unfinished steps.
   */
  public recoverInterruptedRuns(): number {
    const ts = this.now();
    const res = this.sqlite
      .prepare(
        `UPDATE research_runs
         SET status = 'failed',
             error_code = 'INTERRUPTED_BY_RESTART',
             error_message = 'Запуск был прерван перезапуском приложения; доступно продолжение с последнего завершённого шага.',
             updated_at = ?
         WHERE status = 'running'`
      )
      .run(ts);

    this.sqlite
      .prepare(
        `UPDATE research_run_steps
         SET status = 'pending', updated_at = ?
         WHERE status = 'running'`
      )
      .run(ts);

    return Number(res.changes || 0);
  }

  public listSteps(runId: string): ResearchStepRecord[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM research_run_steps WHERE run_id = ? ORDER BY step_index ASC")
      .all(runId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      runId: String(r.run_id),
      stepIndex: Number(r.step_index),
      stepKey: String(r.step_key),
      stepKind: String(r.step_kind) as ResearchStepKind,
      targetUrl: r.target_url ? String(r.target_url) : null,
      depth: Number(r.depth ?? 1),
      status: String(r.status) as ResearchStepStatus,
      attempts: Number(r.attempts ?? 0),
      checkpoint: (() => {
        try {
          return JSON.parse(String(r.checkpoint_json || "{}")) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
      errorCode: r.error_code ? String(r.error_code) : null,
      updatedAt: String(r.updated_at)
    }));
  }

  public listSources(runId: string): StoredResearchSource[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM research_sources WHERE run_id = ? ORDER BY fetched_at ASC, source_id ASC")
      .all(runId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      sourceId: String(r.source_id),
      runId: String(r.run_id),
      ownerId: String(r.owner_id),
      originalUrl: String(r.original_url),
      canonicalUrl: String(r.canonical_url),
      title: String(r.title),
      domain: String(r.domain),
      fetchedAt: String(r.fetched_at),
      publishedAt: r.published_at ? String(r.published_at) : null,
      pageVersion: String(r.page_version),
      previousPageVersion: r.previous_page_version ? String(r.previous_page_version) : null,
      pageChanged: Boolean(r.page_changed),
      contentSha256: String(r.content_sha256),
      contentText: String(r.content_text),
      depth: Number(r.depth ?? 1),
      httpStatus: Number(r.http_status ?? 200),
      extractedClaims: (() => {
        try {
          return JSON.parse(String(r.extracted_claims_json || "[]")) as CandidateClaimExtraction[];
        } catch {
          return [];
        }
      })()
    }));
  }

  public listClaims(runId: string): SynthesizedResearchClaim[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM research_claims WHERE run_id = ? ORDER BY claim_id ASC")
      .all(runId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      claimId: String(r.claim_id),
      subject: String(r.subject),
      criterion: String(r.criterion),
      category: String(r.category) as SynthesizedResearchClaim["category"],
      resolvedValue: String(r.resolved_value),
      conflictSummary: r.conflict_summary ? String(r.conflict_summary) : null,
      unconfirmedReason: r.unconfirmed_reason ? String(r.unconfirmed_reason) : null,
      citations: (() => {
        try {
          return JSON.parse(String(r.citations_json || "[]"));
        } catch {
          return [];
        }
      })()
    }));
  }

  private requireRunRow(runId: string, ownerId: string): Record<string, unknown> {
    const row = this.sqlite
      .prepare("SELECT * FROM research_runs WHERE id = ?")
      .get(runId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error("RESEARCH_RUN_NOT_FOUND");
    }
    if (String(row.owner_id) !== ownerId) {
      throw new Error("RESEARCH_RUN_FORBIDDEN");
    }
    return row;
  }

  private hydrateRunView(row: Record<string, unknown>): ResearchRunView {
    const runId = String(row.id);
    const steps = this.listSteps(runId);
    const sources = this.listSources(runId);
    const claims = this.listClaims(runId);

    const completedSteps = steps.filter((s) => s.status === "completed").length;
    const pendingSteps = steps.filter(
      (s) => s.status === "pending" || s.status === "running" || s.status === "cancelled"
    ).length;
    const failedSteps = steps.filter((s) => s.status === "failed").length;
    const totalSteps = Math.max(steps.length, Number(row.total_steps || 0));
    const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    return {
      id: runId,
      ownerId: String(row.owner_id),
      projectId: row.project_id ? String(row.project_id) : null,
      query: String(row.query),
      normalizedQuery: String(row.normalized_query || normalizeResearchQuery(String(row.query))),
      clientRequestId: row.client_request_id ? String(row.client_request_id) : null,
      status: String(row.status) as ResearchRunStatus,
      progress: {
        currentStepIndex: Number(row.current_step_index || 0),
        totalSteps,
        completedSteps,
        pendingSteps,
        failedSteps,
        percent
      },
      budgets: {
        maxDepth: Number(row.max_depth ?? 2),
        maxSources: Number(row.max_sources ?? 6),
        maxRuntimeMs: Number(row.max_runtime_ms ?? 15000),
        elapsedMs: Number(row.elapsed_ms ?? 0),
        depthReached: Number(row.depth_reached ?? 0),
        sourcesRead: sources.length
      },
      steps,
      sources,
      confirmedClaims: claims.filter((c) => c.category === "confirmed"),
      conflictingClaims: claims.filter((c) => c.category === "conflicting"),
      unconfirmedClaims: claims.filter((c) => c.category === "unconfirmed"),
      reportMarkdown: row.report_markdown ? String(row.report_markdown) : null,
      errorCode: row.error_code ? String(row.error_code) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}
