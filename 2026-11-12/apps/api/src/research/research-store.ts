import { CryptographicAuditBlackbox, type AuditRecord, type AuditVerificationReport, type ComplianceCertificate } from "../../../../packages/db/src/cryptographic-audit-blackbox.js";
import { CuckooFilterIndex } from "../../../../packages/db/src/cuckoo-and-bloom-filter-index.js";
import { RoaringPositionalInvertedIndex } from "../../../../packages/db/src/roaring-positional-inverted-index.js";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type CandidateClaimExtraction,
  type EvidenceCitation,
  type SynthesizedResearchClaim,
  renderDeterministicResearchReportMarkdown,
  sha256Hex,
  synthesizeResearchClaims
} from "./research-synthesis.js";

export type ResearchRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelled"
  | "failed"
  | "completed";

export type ResearchStepKind = "search" | "read_project_docs" | "read_source" | "synthesize";
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

export interface ProjectDocumentLibraryRecord {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  extractedText: string;
  createdAt: string;
}

export interface CanvasResearchArtifactRecord {
  id: string;
  ownerId: string;
  projectId: string | null;
  runId: string;
  title: string;
  kind: "research_report";
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectResearchHandoffRecord {
  messageId: string;
  projectId: string;
  ownerId: string;
  runId: string;
  role: "assistant";
  content: string;
  canvasArtifactId: string | null;
  confirmedCount: number;
  conflictingCount: number;
  unconfirmedCount: number;
  createdAt: string;
}

export interface GroundedResearchQuestionAnswer {
  runId: string;
  question: string;
  status: "confirmed" | "conflicting" | "unconfirmed";
  answerText: string;
  citations: EvidenceCitation[];
}

export interface PromotedResearchMemoryRecord {
  entryId: string;
  ownerId: string;
  projectId: string;
  scope: "project";
  kind: "fact" | "hypothesis";
  title: string;
  content: string;
  creationKey: string;
  version: number;
}

export interface ResearchRunsDiffResult {
  baseRunId: string;
  targetRunId: string;
  newlyConfirmed: Array<{
    subject: string;
    criterion: string;
    newValue: string;
  }>;
  valueChanges: Array<{
    subject: string;
    criterion: string;
    oldValue: string;
    newValue: string;
    oldCategory: string;
    newCategory: string;
  }>;
  changedSources: Array<{
    canonicalUrl: string;
    oldPageVersion: string;
    newPageVersion: string;
  }>;
}

export interface VerifiableResearchBundle {
  schemaVersion: "kosmora.research.bundle.v1";
  exportedAt: string;
  bundleSha256: string;
  payload: {
    originRunId: string;
    query: string;
    status: ResearchRunStatus;
    nextIndex: number;
    expectedTargets: Array<{ subject: string; criterion: string }>;
    sources: Array<{
      originalUrl: string;
      canonicalUrl: string;
      title: string;
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
    }>;
    confirmedClaims: SynthesizedResearchClaim[];
    conflictingClaims: SynthesizedResearchClaim[];
    unconfirmedClaims: SynthesizedResearchClaim[];
  };
}

export interface ResearchCheckpointEnvelope {
  next_index: number;
  plan_model_completed: boolean;
  planned_queries: string[];
  model_calls_count: number;
  canvas_artifact_id: string | null;
  project_message_id: string | null;
  discovered_urls: Array<{
    originalUrl: string;
    canonicalUrl: string;
    depth: number;
    initialExpectedVersion: string | null;
  }>;
}

export interface ResearchRunView {
  id: string;
  ownerId: string;
  projectId: string | null;
  query: string;
  normalizedQuery: string;
  clientRequestId: string | null;
  status: ResearchRunStatus;
  canResume: boolean;
  nextIndex: number;
  canvasArtifactId: string | null;
  projectMessageId: string | null;
  checkpoint: ResearchCheckpointEnvelope;
  progress: {
    currentStepIndex: number;
    nextIndex: number;
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
    modelCallsCount: number;
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
    if (parsed.protocol === "kosmora-doc:") {
      return rawUrl.trim();
    }
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

      CREATE TABLE IF NOT EXISTS project_messages (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS context_memory_entries (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('personal', 'chat', 'project')),
        chat_id TEXT,
        project_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('fact', 'preference', 'decision', 'constraint', 'hypothesis')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        source_chat_message_id TEXT,
        source_project_message_id TEXT,
        source_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        creation_key TEXT,
        creation_sha256 TEXT
      );

      CREATE TABLE IF NOT EXISTS document_library_files (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        extracted_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kosmora_session_audit_blackbox (
        seq INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        record_hash TEXT NOT NULL PRIMARY KEY,
        created_at TEXT NOT NULL,
        UNIQUE (session_id, seq)
      );

      CREATE TABLE IF NOT EXISTS kosmora_probabilistic_filter_snapshots (
        snapshot_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        filter_type TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, namespace, filter_type)
      );

      CREATE TABLE IF NOT EXISTS kosmora_roaring_inverted_snapshots (
        snapshot_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        doc_count INTEGER NOT NULL,
        term_count INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, namespace)
      );

      CREATE TABLE IF NOT EXISTS kosmora_workflow_checkpoints (
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        output_content TEXT,
        state_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (run_id, step_id)
      );

      CREATE TABLE IF NOT EXISTS canvas_artifacts (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        project_id TEXT,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
      ["next_index", "INTEGER NOT NULL DEFAULT 0"],
      ["checkpoint_json", "TEXT NOT NULL DEFAULT '{}'"],
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

  public listProjectLibraryDocuments(
    ownerId: string,
    projectId: string | null
  ): ProjectDocumentLibraryRecord[] {
    if (!projectId) return [];
    this.assertOwnerActive(ownerId);
    this.assertProjectAccess(ownerId, projectId);

    const rows = this.sqlite
      .prepare(
        `SELECT * FROM document_library_files
         WHERE owner_id = ? AND project_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(ownerId, projectId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      ownerId: String(r.owner_id),
      name: String(r.name),
      mediaType: String(r.media_type),
      bytes: Number(r.bytes ?? 0),
      sha256: String(r.sha256),
      extractedText: String(r.extracted_text ?? ""),
      createdAt: String(r.created_at)
    }));
  }

  public exportRunToCanvasArtifact(
    runId: string,
    ownerId: string,
    options?: { title?: string }
  ): CanvasResearchArtifactRecord {
    this.assertOwnerActive(ownerId);
    const row = this.requireRunRow(runId, ownerId);
    const run = this.hydrateRunView(row);
    if (!run.reportMarkdown) {
      throw new Error("RESEARCH_REPORT_NOT_READY");
    }

    const ts = this.now();
    const title = options?.title?.trim() || `Исследовательский отчёт: ${run.query}`;
    const existingArtifactId = run.checkpoint.canvas_artifact_id;

    if (existingArtifactId) {
      const existingRow = this.sqlite
        .prepare("SELECT * FROM canvas_artifacts WHERE id = ? AND owner_id = ?")
        .get(existingArtifactId, ownerId) as Record<string, unknown> | undefined;
      if (existingRow) {
        this.sqlite
          .prepare(
            "UPDATE canvas_artifacts SET title = ?, content = ?, updated_at = ? WHERE id = ? AND owner_id = ?"
          )
          .run(title, run.reportMarkdown, ts, existingArtifactId, ownerId);

        return {
          id: existingArtifactId,
          ownerId,
          projectId: run.projectId,
          runId,
          title,
          kind: "research_report",
          content: run.reportMarkdown,
          createdAt: String(existingRow.created_at),
          updatedAt: ts
        };
      }
    }

    const artifactId = `cnv_res_${randomUUID().slice(0, 12)}`;
    this.sqlite
      .prepare(
        `INSERT INTO canvas_artifacts (id, owner_id, project_id, title, kind, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'research_report', ?, ?, ?)`
      )
      .run(artifactId, ownerId, run.projectId, title, run.reportMarkdown, ts, ts);

    this.updateRunCheckpointEnvelope(runId, ownerId, {
      canvas_artifact_id: artifactId
    });

    return {
      id: artifactId,
      ownerId,
      projectId: run.projectId,
      runId,
      title,
      kind: "research_report",
      content: run.reportMarkdown,
      createdAt: ts,
      updatedAt: ts
    };
  }

  public handoffRunToProjectMessages(
    runId: string,
    ownerId: string
  ): ProjectResearchHandoffRecord {
    this.assertOwnerActive(ownerId);
    const row = this.requireRunRow(runId, ownerId);
    const run = this.hydrateRunView(row);
    if (!run.projectId) {
      throw new Error("RESEARCH_PROJECT_REQUIRED_FOR_HANDOFF");
    }
    this.assertProjectAccess(ownerId, run.projectId);
    if (!run.reportMarkdown) {
      throw new Error("RESEARCH_REPORT_NOT_READY");
    }

    const ts = this.now();
    const existingMsgId = run.checkpoint.project_message_id;

    if (existingMsgId) {
      const existingMsg = this.sqlite
        .prepare("SELECT * FROM project_messages WHERE id = ? AND project_id = ?")
        .get(existingMsgId, run.projectId) as Record<string, unknown> | undefined;
      if (existingMsg) {
        this.sqlite
          .prepare("UPDATE project_messages SET content = ? WHERE id = ? AND project_id = ?")
          .run(run.reportMarkdown, existingMsgId, run.projectId);
        return {
          messageId: existingMsgId,
          projectId: run.projectId,
          ownerId,
          runId,
          role: "assistant",
          content: run.reportMarkdown,
          canvasArtifactId: run.canvasArtifactId,
          confirmedCount: run.confirmedClaims.length,
          conflictingCount: run.conflictingClaims.length,
          unconfirmedCount: run.unconfirmedClaims.length,
          createdAt: String(existingMsg.created_at)
        };
      }
    }

    const messageId = `pmsg_res_${randomUUID().slice(0, 12)}`;
    this.sqlite
      .prepare(
        `INSERT INTO project_messages (id, project_id, role, content, created_at)
         VALUES (?, ?, 'assistant', ?, ?)`
      )
      .run(messageId, run.projectId, run.reportMarkdown, ts);

    this.updateRunCheckpointEnvelope(runId, ownerId, {
      project_message_id: messageId
    });

    return {
      messageId,
      projectId: run.projectId,
      ownerId,
      runId,
      role: "assistant",
      content: run.reportMarkdown,
      canvasArtifactId: run.canvasArtifactId,
      confirmedCount: run.confirmedClaims.length,
      conflictingCount: run.conflictingClaims.length,
      unconfirmedCount: run.unconfirmedClaims.length,
      createdAt: ts
    };
  }

  public promoteRunClaimsToContextMemory(
    runId: string,
    ownerId: string
  ): { promoted: PromotedResearchMemoryRecord[]; skippedUnconfirmedCount: number } {
    this.assertOwnerActive(ownerId);
    const run = this.getRunForOwner(runId, ownerId);
    if (!run.projectId) {
      throw new Error("RESEARCH_PROJECT_REQUIRED_FOR_MEMORY_PROMOTION");
    }
    this.assertProjectAccess(ownerId, run.projectId);

    const ts = this.now();
    const promoted: PromotedResearchMemoryRecord[] = [];
    const promotable = [...run.confirmedClaims, ...run.conflictingClaims];

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const claim of promotable) {
        const kind: "fact" | "hypothesis" =
          claim.category === "confirmed" ? "fact" : "hypothesis";
        const creationKey = `research_claim:${run.id}:${claim.subject}:${claim.criterion}`;
        const title = `${claim.subject} — ${claim.criterion}`;
        const content =
          claim.category === "confirmed"
            ? `${claim.subject} (${claim.criterion}): ${claim.resolvedValue}. Цитата: «${claim.citations[0]?.verbatimQuote ?? ""}» (${claim.citations[0]?.originalUrl ?? ""})`
            : `${claim.conflictSummary ?? claim.resolvedValue}. Требует проверки (конфликт источников).`;
        const sourceJson = JSON.stringify({
          runId: run.id,
          claimId: claim.claimId,
          category: claim.category,
          citations: claim.citations
        });
        const creationSha256 = sha256Hex(`${title}:::${content}`);

        const existing = this.sqlite
          .prepare(
            `SELECT id, version, content FROM context_memory_entries
             WHERE owner_id = ? AND project_id = ? AND creation_key = ? LIMIT 1`
          )
          .get(ownerId, run.projectId, creationKey) as
          | { id: string; version: number; content: string }
          | undefined;

        if (existing) {
          const nextVer =
            existing.content !== content ? Number(existing.version) + 1 : Number(existing.version);
          this.sqlite
            .prepare(
              `UPDATE context_memory_entries
               SET kind = ?, title = ?, content = ?, source_json = ?, version = ?, updated_at = ?, creation_sha256 = ?
               WHERE id = ? AND owner_id = ?`
            )
            .run(
              kind,
              title,
              content,
              sourceJson,
              nextVer,
              ts,
              creationSha256,
              existing.id,
              ownerId
            );
          promoted.push({
            entryId: existing.id,
            ownerId,
            projectId: run.projectId,
            scope: "project",
            kind,
            title,
            content,
            creationKey,
            version: nextVer
          });
        } else {
          const entryId = `cmem_res_${randomUUID().slice(0, 12)}`;
          this.sqlite
            .prepare(
              `INSERT INTO context_memory_entries (
                id, owner_id, scope, chat_id, project_id, kind, title, content,
                pinned, expires_at, source_chat_message_id, source_project_message_id,
                source_json, version, created_at, updated_at, creation_key, creation_sha256
              ) VALUES (?, ?, 'project', NULL, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, 1, ?, ?, ?, ?)`
            )
            .run(
              entryId,
              ownerId,
              run.projectId,
              kind,
              title,
              content,
              run.projectMessageId,
              sourceJson,
              ts,
              ts,
              creationKey,
              creationSha256
            );
          promoted.push({
            entryId,
            ownerId,
            projectId: run.projectId,
            scope: "project",
            kind,
            title,
            content,
            creationKey,
            version: 1
          });
        }
      }
      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }

    return {
      promoted,
      skippedUnconfirmedCount: run.unconfirmedClaims.length
    };
  }

  public diffRuns(
    baseRunId: string,
    targetRunId: string,
    ownerId: string
  ): ResearchRunsDiffResult {
    const baseRun = this.getRunForOwner(baseRunId, ownerId);
    const targetRun = this.getRunForOwner(targetRunId, ownerId);

    const baseClaims = new Map<string, SynthesizedResearchClaim>();
    for (const c of [
      ...baseRun.confirmedClaims,
      ...baseRun.conflictingClaims,
      ...baseRun.unconfirmedClaims
    ]) {
      baseClaims.set(`${c.subject}:::${c.criterion}`, c);
    }

    const newlyConfirmed: ResearchRunsDiffResult["newlyConfirmed"] = [];
    const valueChanges: ResearchRunsDiffResult["valueChanges"] = [];

    for (const tc of [
      ...targetRun.confirmedClaims,
      ...targetRun.conflictingClaims,
      ...targetRun.unconfirmedClaims
    ]) {
      const key = `${tc.subject}:::${tc.criterion}`;
      const bc = baseClaims.get(key);
      if ((!bc || bc.category === "unconfirmed") && tc.category === "confirmed") {
        newlyConfirmed.push({
          subject: tc.subject,
          criterion: tc.criterion,
          newValue: tc.resolvedValue
        });
      } else if (bc && bc.resolvedValue !== tc.resolvedValue) {
        valueChanges.push({
          subject: tc.subject,
          criterion: tc.criterion,
          oldValue: bc.resolvedValue,
          newValue: tc.resolvedValue,
          oldCategory: bc.category,
          newCategory: tc.category
        });
      }
    }

    const baseSources = new Map<string, StoredResearchSource>();
    for (const s of baseRun.sources) {
      baseSources.set(s.canonicalUrl, s);
    }

    const changedSources: ResearchRunsDiffResult["changedSources"] = [];
    for (const ts of targetRun.sources) {
      const bs = baseSources.get(ts.canonicalUrl);
      if (bs && bs.pageVersion !== ts.pageVersion) {
        changedSources.push({
          canonicalUrl: ts.canonicalUrl,
          oldPageVersion: bs.pageVersion,
          newPageVersion: ts.pageVersion
        });
      }
    }

    return {
      baseRunId,
      targetRunId,
      newlyConfirmed,
      valueChanges,
      changedSources
    };
  }

  /**
   * Exports a cryptographically verifiable portable bundle (`kosmora.research.bundle.v1`)
   * with `bundleSha256` covering all source snapshots and synthesized claims.
   */
  public exportVerifiableBundle(
    runId: string,
    ownerId: string
  ): VerifiableResearchBundle {
    const run = this.getRunForOwner(runId, ownerId);
    const expectedTargets = this.getExpectedTargets(runId, ownerId);

    const payload: VerifiableResearchBundle["payload"] = {
      originRunId: run.id,
      query: run.query,
      status: run.status,
      nextIndex: run.nextIndex,
      expectedTargets,
      sources: run.sources.map((s) => ({
        originalUrl: s.originalUrl,
        canonicalUrl: s.canonicalUrl,
        title: s.title,
        fetchedAt: s.fetchedAt,
        publishedAt: s.publishedAt,
        pageVersion: s.pageVersion,
        previousPageVersion: s.previousPageVersion,
        pageChanged: s.pageChanged,
        contentSha256: s.contentSha256,
        contentText: s.contentText,
        depth: s.depth,
        httpStatus: s.httpStatus,
        extractedClaims: s.extractedClaims
      })),
      confirmedClaims: run.confirmedClaims,
      conflictingClaims: run.conflictingClaims,
      unconfirmedClaims: run.unconfirmedClaims
    };

    const bundleSha256 = sha256Hex(JSON.stringify(payload));
    return {
      schemaVersion: "kosmora.research.bundle.v1",
      exportedAt: this.now(),
      bundleSha256,
      payload
    };
  }

  /**
   * Verifies `bundleSha256` and every source snapshot's `contentSha256` + UTF-16 quote slice
   * before materializing the imported research run under `(ownerId, projectId)` with fresh IDs.
   */
  public importVerifiableBundle(
    ownerId: string,
    projectId: string | null,
    bundle: VerifiableResearchBundle
  ): ResearchRunView {
    this.assertOwnerActive(ownerId);
    this.assertProjectAccess(ownerId, projectId);

    if (
      !bundle ||
      bundle.schemaVersion !== "kosmora.research.bundle.v1" ||
      !bundle.payload
    ) {
      throw new Error("RESEARCH_BUNDLE_INVALID_SCHEMA");
    }

    const computedBundleSha = sha256Hex(JSON.stringify(bundle.payload));
    if (computedBundleSha !== bundle.bundleSha256) {
      throw new Error("RESEARCH_BUNDLE_HASH_MISMATCH");
    }

    // Verify every source snapshot's content hash and every citation's exact UTF-16 slice
    for (const src of bundle.payload.sources) {
      if (sha256Hex(src.contentText) !== src.contentSha256) {
        throw new Error("RESEARCH_BUNDLE_EVIDENCE_CORRUPT");
      }
      for (const cand of src.extractedClaims) {
        const quote = String(cand.verbatimQuote ?? "");
        if (!quote || !src.contentText.includes(quote)) {
          throw new Error("RESEARCH_BUNDLE_EVIDENCE_CORRUPT");
        }
      }
    }

    const created = this.createRunWithSteps({
      ownerId,
      projectId,
      query: bundle.payload.query,
      clientRequestId: `import_${bundle.bundleSha256.slice(0, 16)}_${randomUUID().slice(0, 8)}`,
      maxDepth: 2,
      maxSources: Math.max(6, bundle.payload.sources.length),
      maxRuntimeMs: 15000,
      expectedTargets: bundle.payload.expectedTargets,
      steps: [
        { stepKey: "search:initial", stepKind: "search", depth: 1 },
        { stepKey: "synthesize:final", stepKind: "synthesize", depth: 1 }
      ]
    });

    for (const src of bundle.payload.sources) {
      this.upsertSourceSnapshot(created.id, ownerId, {
        originalUrl: src.originalUrl,
        title: src.title,
        fetchedAt: src.fetchedAt,
        publishedAt: src.publishedAt,
        pageVersion: src.pageVersion,
        initialExpectedVersion: src.previousPageVersion,
        contentText: src.contentText,
        depth: src.depth,
        httpStatus: src.httpStatus,
        extractedClaims: src.extractedClaims
      });
    }

    const sourcesForSynth = this.listSources(created.id);
    const synthesized = synthesizeResearchClaims({
      runId: created.id,
      expectedTargets: bundle.payload.expectedTargets,
      sources: sourcesForSynth
    });

    this.checkpointStep(created.id, ownerId, "search:initial", { status: "completed" });
    this.checkpointStep(created.id, ownerId, "synthesize:final", { status: "completed" });
    this.updateRunStatus(created.id, ownerId, {
      nextIndex: bundle.payload.sources.length
    });

    return this.saveSynthesizedClaimsAndReport(
      created.id,
      ownerId,
      synthesized.allClaims,
      "completed"
    );
  }


  /**
   * Resolves a conflicting (or unconfirmed) claim by selecting one of its verified citations
   * (`winningSourceId` matching `sourceId` or `canonicalUrl`) and recording an immutable
   * `ClaimResolutionAudit` trail without requiring any external database migration.
   */

  /**
   * Restores a research privacy export section (`runs`, `steps`, `sources`, `claims`)
   * into fresh run IDs under `ownerId` (with optional `projectIdMap`), preserving
   * `next_index`, `checkpoint_json`, and step checkpoints so interrupted runs can be
   * resumed after a workspace restore without re-reading completed sources.
   */


  /**
   * Rebuilds and persists the owner's `RoaringPositionalInvertedIndex` (`namespace = "research_evidence"`)
   * in `kosmora_roaring_inverted_snapshots` across all verified research sources and claim quotes.
   */

  /**
   * Synchronizes the owner's `CuckooFilterIndex` (`namespace = "research_evidence"`)
   * in `kosmora_probabilistic_filter_snapshots` across all canonical source URLs,
   * `(canonicalUrl, pageVersion)` pairs, and verified `quoteSha256` fingerprints.
   */

  /**
   * Builds the Cross-Citation Knowledge Graph and Source Authority Ranking for `runId`:
   * - Computes per-source authority scores (`confirmedSupportCount * 2 + winningResolutionCount * 3 + conflictingSupportCount`).
   * - Emits directed citation edges (`sourceId -> claimId` with `verbatimQuote` and `quoteSha256`),
   *   inter-source contradiction pairs, and isolated unconfirmed claims.
   */
  public buildRunCitationGraph(
    runId: string,
    ownerId: string
  ): {
    runId: string;
    sourceNodes: Array<{
      sourceId: string;
      title: string;
      originalUrl: string;
      canonicalUrl: string;
      domain: string;
      pageVersion: string;
      confirmedSupportCount: number;
      conflictingSupportCount: number;
      winningResolutionCount: number;
      authorityScore: number;
    }>;
    claimNodes: Array<{
      claimId: string;
      subject: string;
      criterion: string;
      category: "confirmed" | "conflicting" | "unconfirmed";
      resolvedValue: string;
      citationCount: number;
    }>;
    citationEdges: Array<{
      sourceId: string;
      claimId: string;
      claimedValue: string;
      verbatimQuote: string;
      quoteSha256: string;
      pageVersion: string;
    }>;
    contradictionPairs: Array<{
      claimId: string;
      subject: string;
      criterion: string;
      sourceA: { sourceId: string; title: string; claimedValue: string; verbatimQuote: string };
      sourceB: { sourceId: string; title: string; claimedValue: string; verbatimQuote: string };
    }>;
    isolatedUnconfirmedClaims: Array<{
      claimId: string;
      subject: string;
      criterion: string;
      unconfirmedReason: string | null;
    }>;
  } {
    const run = this.getRunForOwner(runId, ownerId);
    const allClaims = [
      ...run.confirmedClaims,
      ...run.conflictingClaims,
      ...run.unconfirmedClaims
    ];

    const confirmedCountBySource = new Map<string, number>();
    const conflictingCountBySource = new Map<string, number>();
    const winningResBySource = new Map<string, number>();
    const citationEdges: Array<{
      sourceId: string;
      claimId: string;
      claimedValue: string;
      verbatimQuote: string;
      quoteSha256: string;
      pageVersion: string;
    }> = [];
    const contradictionPairs: Array<{
      claimId: string;
      subject: string;
      criterion: string;
      sourceA: { sourceId: string; title: string; claimedValue: string; verbatimQuote: string };
      sourceB: { sourceId: string; title: string; claimedValue: string; verbatimQuote: string };
    }> = [];

    for (const claim of allClaims) {
      if (claim.resolutionAudit?.winningSourceId) {
        winningResBySource.set(
          claim.resolutionAudit.winningSourceId,
          (winningResBySource.get(claim.resolutionAudit.winningSourceId) ?? 0) + 1
        );
      }
      for (const cit of claim.citations) {
        citationEdges.push({
          sourceId: cit.sourceId,
          claimId: claim.claimId,
          claimedValue: cit.claimedValue,
          verbatimQuote: cit.verbatimQuote,
          quoteSha256: cit.quoteSha256,
          pageVersion: cit.pageVersion
        });
        if (claim.category === "confirmed") {
          confirmedCountBySource.set(
            cit.sourceId,
            (confirmedCountBySource.get(cit.sourceId) ?? 0) + 1
          );
        } else if (claim.category === "conflicting") {
          conflictingCountBySource.set(
            cit.sourceId,
            (conflictingCountBySource.get(cit.sourceId) ?? 0) + 1
          );
        }
      }

      if (claim.category === "conflicting" && claim.citations.length >= 2) {
        for (let i = 0; i < claim.citations.length; i++) {
          for (let j = i + 1; j < claim.citations.length; j++) {
            const ca = claim.citations[i]!;
            const cb = claim.citations[j]!;
            if (ca.claimedValue !== cb.claimedValue) {
              contradictionPairs.push({
                claimId: claim.claimId,
                subject: claim.subject,
                criterion: claim.criterion,
                sourceA: {
                  sourceId: ca.sourceId,
                  title: ca.sourceTitle,
                  claimedValue: ca.claimedValue,
                  verbatimQuote: ca.verbatimQuote
                },
                sourceB: {
                  sourceId: cb.sourceId,
                  title: cb.sourceTitle,
                  claimedValue: cb.claimedValue,
                  verbatimQuote: cb.verbatimQuote
                }
              });
            }
          }
        }
      }
    }

    const sourceNodes = run.sources
      .map((src) => {
        const confirmedSupportCount = confirmedCountBySource.get(src.sourceId) ?? 0;
        const conflictingSupportCount = conflictingCountBySource.get(src.sourceId) ?? 0;
        const winningResolutionCount = winningResBySource.get(src.sourceId) ?? 0;
        const authorityScore =
          confirmedSupportCount * 2 + winningResolutionCount * 3 + conflictingSupportCount;
        return {
          sourceId: src.sourceId,
          title: src.title,
          originalUrl: src.originalUrl,
          canonicalUrl: src.canonicalUrl,
          domain: src.domain,
          pageVersion: src.pageVersion,
          confirmedSupportCount,
          conflictingSupportCount,
          winningResolutionCount,
          authorityScore
        };
      })
      .sort((a, b) => b.authorityScore - a.authorityScore);

    const claimNodes = allClaims.map((c) => ({
      claimId: c.claimId,
      subject: c.subject,
      criterion: c.criterion,
      category: c.category,
      resolvedValue: c.resolvedValue,
      citationCount: c.citations.length
    }));

    const isolatedUnconfirmedClaims = run.unconfirmedClaims.map((c) => ({
      claimId: c.claimId,
      subject: c.subject,
      criterion: c.criterion,
      unconfirmedReason: c.unconfirmedReason
    }));

    return {
      runId: run.id,
      sourceNodes,
      claimNodes,
      citationEdges,
      contradictionPairs,
      isolatedUnconfirmedClaims
    };
  }

  public recordRunAuditEvent(
    runId: string,
    ownerId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): AuditRecord {
    const blackbox = new CryptographicAuditBlackbox(this.sqlite);
    return blackbox.recordAuditEvent({
      sessionId: `research:${runId}`,
      ownerId,
      eventType,
      payload
    });
  }

  public getRunCryptographicAuditTrail(
    runId: string,
    ownerId: string
  ): {
    runId: string;
    verification: AuditVerificationReport;
    certificate: ComplianceCertificate;
    events: AuditRecord[];
  } {
    this.getRunForOwner(runId, ownerId);
    const sessionId = `research:${runId}`;
    const blackbox = new CryptographicAuditBlackbox(this.sqlite);
    const verification = blackbox.verifyAuditChain(sessionId, ownerId);
    const certificate = blackbox.exportComplianceCertificate(sessionId, ownerId);
    const rows = this.sqlite
      .prepare(
        "SELECT seq, session_id, owner_id, event_type, payload_json, payload_sha256, prev_hash, record_hash, created_at FROM kosmora_session_audit_blackbox WHERE session_id = ? AND owner_id = ? ORDER BY seq ASC"
      )
      .all(sessionId, ownerId) as Array<Record<string, unknown>>;

    const events: AuditRecord[] = rows.map((r) => ({
      seq: Number(r.seq),
      sessionId: String(r.session_id),
      ownerId: String(r.owner_id),
      eventType: String(r.event_type),
      payload: (() => {
        try {
          return JSON.parse(String(r.payload_json || "{}"));
        } catch {
          return {};
        }
      })(),
      payloadSha256: String(r.payload_sha256),
      prevHash: String(r.prev_hash),
      recordHash: String(r.record_hash),
      createdAt: String(r.created_at)
    }));

    return {
      runId,
      verification,
      certificate,
      events
    };
  }

  public syncOwnerProbabilisticFilter(ownerId: string): {
    snapshotId: string;
    itemCount: number;
    loadFactor: number;
  } {
    this.assertOwnerActive(ownerId);
    const filter = new CuckooFilterIndex({ capacity: 1024 });
    const runs = this.listRunsForOwner(ownerId);
    const insertedKeys = new Set<string>();

    const addOnce = (key: string) => {
      if (!insertedKeys.has(key)) {
        insertedKeys.add(key);
        filter.insert(key);
      }
    };

    for (const run of runs) {
      for (const src of run.sources) {
        addOnce(`url:${src.canonicalUrl}`);
        addOnce(`version:${src.canonicalUrl}@${src.pageVersion}`);
      }
      for (const claim of [...run.confirmedClaims, ...run.conflictingClaims]) {
        for (const cit of claim.citations) {
          addOnce(`quote:${cit.quoteSha256}`);
        }
      }
    }

    const snapshotId = filter.saveToSqlite(this.sqlite, ownerId, "research_evidence");
    return {
      snapshotId,
      itemCount: filter.count,
      loadFactor: filter.loadFactor
    };
  }

  /**
   * Performs O(1) probabilistic Cuckoo Filter lookups (backed by `kosmora_probabilistic_filter_snapshots`)
   * to check whether URLs, page versions, or verbatim quotes have already been ingested by `ownerId`.
   */
  public checkEvidenceSeen(
    ownerId: string,
    input: {
      urls?: string[];
      pageVersions?: Array<{ url: string; pageVersion: string }>;
      quotes?: string[];
    }
  ): {
    snapshotId: string;
    itemCount: number;
    loadFactor: number;
    urls: Array<{ url: string; canonicalUrl: string; seen: boolean }>;
    pageVersions: Array<{
      url: string;
      canonicalUrl: string;
      pageVersion: string;
      seen: boolean;
    }>;
    quotes: Array<{ quote: string; quoteSha256: string; seen: boolean }>;
  } {
    this.assertOwnerActive(ownerId);
    const { snapshotId } = this.syncOwnerProbabilisticFilter(ownerId);
    const filter =
      CuckooFilterIndex.loadFromSqlite(this.sqlite, ownerId, "research_evidence") ??
      new CuckooFilterIndex({ capacity: 1024 });

    const urls = (input.urls ?? []).map((rawUrl) => {
      const canonicalUrl = canonicalizeSourceUrl(rawUrl);
      return {
        url: rawUrl,
        canonicalUrl,
        seen: filter.lookup(`url:${canonicalUrl}`)
      };
    });

    const pageVersions = (input.pageVersions ?? []).map((pv) => {
      const canonicalUrl = canonicalizeSourceUrl(pv.url);
      return {
        url: pv.url,
        canonicalUrl,
        pageVersion: pv.pageVersion,
        seen: filter.lookup(`version:${canonicalUrl}@${pv.pageVersion}`)
      };
    });

    const quotes = (input.quotes ?? []).map((rawQuote) => {
      const trimmed = String(rawQuote ?? "").trim();
      const quoteSha256 = sha256Hex(trimmed);
      return {
        quote: trimmed,
        quoteSha256,
        seen: filter.lookup(`quote:${quoteSha256}`)
      };
    });

    return {
      snapshotId,
      itemCount: filter.count,
      loadFactor: filter.loadFactor,
      urls,
      pageVersions,
      quotes
    };
  }

  public syncOwnerEvidenceInvertedIndex(ownerId: string): {
    snapshotId: string;
    indexedDocsCount: number;
  } {
    this.assertOwnerActive(ownerId);
    const index = new RoaringPositionalInvertedIndex(ownerId, "research_evidence");
    const runs = this.listRunsForOwner(ownerId);
    let indexedDocsCount = 0;

    for (const run of runs) {
      const claimTags = new Set<string>();
      for (const c of run.confirmedClaims) {
        claimTags.add("category:confirmed");
        for (const cit of c.citations) {
          claimTags.add(`source:${cit.sourceId}`);
        }
      }
      for (const c of run.conflictingClaims) {
        claimTags.add("category:conflicting");
      }

      for (const src of run.sources) {
        const externalDocId = `${run.id}:::${src.sourceId}`;
        const tags: string[] = [
          `run:${run.id}`,
          `domain:${src.domain}`,
          `version:${src.pageVersion}`
        ];
        if (run.projectId) {
          tags.push(`project:${run.projectId}`);
        }
        if (src.pageChanged) {
          tags.push("page_changed:true");
        }
        const confirmedHere = run.confirmedClaims.some((c) =>
          c.citations.some((cit) => cit.canonicalUrl === src.canonicalUrl)
        );
        const conflictingHere = run.conflictingClaims.some((c) =>
          c.citations.some((cit) => cit.canonicalUrl === src.canonicalUrl)
        );
        if (confirmedHere) tags.push("category:confirmed");
        if (conflictingHere) tags.push("category:conflicting");

        index.indexDocument({
          externalDocId,
          title: src.title,
          content: src.contentText,
          tags
        });
        indexedDocsCount += 1;
      }
    }

    const snapshotId = index.saveToSqlite(this.sqlite);
    return { snapshotId, indexedDocsCount };
  }

  /**
   * Searches the owner's verified research evidence using `RoaringPositionalInvertedIndex`
   * stored in `kosmora_roaring_inverted_snapshots` (supporting exact/proximity phrase search
   * and boolean/tag filtering across runs and projects).
   */
  public searchOwnerEvidence(
    ownerId: string,
    query: {
      phrase?: string;
      maxSlop?: number;
      mustTerms?: string[];
      shouldTerms?: string[];
      mustNotTerms?: string[];
      projectId?: string | null;
      category?: "confirmed" | "conflicting";
    }
  ): {
    snapshotId: string;
    hits: Array<{
      runId: string;
      projectId: string | null;
      sourceId: string;
      title: string;
      originalUrl: string;
      canonicalUrl: string;
      pageVersion: string;
      fetchedAt: string;
      matchCount: number;
      positions: number[];
      score: number;
      matchedQuotes: string[];
    }>;
  } {
    this.assertOwnerActive(ownerId);
    if (query.projectId) {
      this.assertProjectAccess(ownerId, query.projectId);
    }

    const { snapshotId } = this.syncOwnerEvidenceInvertedIndex(ownerId);
    const loaded =
      RoaringPositionalInvertedIndex.loadFromSqlite(
        this.sqlite,
        ownerId,
        "research_evidence"
      ) ?? new RoaringPositionalInvertedIndex(ownerId, "research_evidence");

    const requiredTags: string[] = [];
    if (query.projectId) {
      requiredTags.push(`project:${query.projectId}`);
    }
    if (query.category) {
      requiredTags.push(`category:${query.category}`);
    }

    const runsById = new Map<string, ResearchRunView>();
    for (const r of this.listRunsForOwner(ownerId)) {
      runsById.set(r.id, r);
    }

    const hits: Array<{
      runId: string;
      projectId: string | null;
      sourceId: string;
      title: string;
      originalUrl: string;
      canonicalUrl: string;
      pageVersion: string;
      fetchedAt: string;
      matchCount: number;
      positions: number[];
      score: number;
      matchedQuotes: string[];
    }> = [];

    if (query.phrase && query.phrase.trim().length > 0) {
      const phraseHits = loaded.queryPhrase(query.phrase.trim(), {
        maxSlop: query.maxSlop ?? 0,
        requiredTags: requiredTags.length > 0 ? requiredTags : undefined
      });

      for (const ph of phraseHits) {
        const [runId, sourceId] = ph.externalDocId.split(":::");
        const run = runsById.get(runId);
        const src = run?.sources.find((s) => s.sourceId === sourceId);
        if (!run || !src) continue;
        const matchedQuotes = [
          ...run.confirmedClaims.flatMap((c) => c.citations),
          ...run.conflictingClaims.flatMap((c) => c.citations)
        ]
          .filter((cit) => cit.canonicalUrl === src.canonicalUrl)
          .map((cit) => cit.verbatimQuote);

        hits.push({
          runId: run.id,
          projectId: run.projectId,
          sourceId: src.sourceId,
          title: src.title,
          originalUrl: src.originalUrl,
          canonicalUrl: src.canonicalUrl,
          pageVersion: src.pageVersion,
          fetchedAt: src.fetchedAt,
          matchCount: ph.matchCount,
          positions: ph.positions,
          score: ph.score,
          matchedQuotes
        });
      }
    } else {
      const boolDocs = loaded.queryBooleanFilter({
        mustTerms: query.mustTerms,
        shouldTerms: query.shouldTerms,
        mustNotTerms: query.mustNotTerms,
        requiredTags: requiredTags.length > 0 ? requiredTags : undefined
      });

      for (const doc of boolDocs) {
        const [runId, sourceId] = doc.externalDocId.split(":::");
        const run = runsById.get(runId);
        const src = run?.sources.find((s) => s.sourceId === sourceId);
        if (!run || !src) continue;
        const matchedQuotes = [
          ...run.confirmedClaims.flatMap((c) => c.citations),
          ...run.conflictingClaims.flatMap((c) => c.citations)
        ]
          .filter((cit) => cit.canonicalUrl === src.canonicalUrl)
          .map((cit) => cit.verbatimQuote);

        hits.push({
          runId: run.id,
          projectId: run.projectId,
          sourceId: src.sourceId,
          title: src.title,
          originalUrl: src.originalUrl,
          canonicalUrl: src.canonicalUrl,
          pageVersion: src.pageVersion,
          fetchedAt: src.fetchedAt,
          matchCount: 1,
          positions: [],
          score: 1,
          matchedQuotes
        });
      }
    }

    return { snapshotId, hits };
  }

  public getWorkflowStepCheckpoint(
    workflowRunId: string,
    stepId: string
  ): {
    workflowRunId: string;
    stepId: string;
    attempt: number;
    status: string;
    outputContent: string | null;
    state: Record<string, unknown>;
    updatedAt: string;
  } | null {
    const row = this.sqlite
      .prepare(
        "SELECT * FROM kosmora_workflow_checkpoints WHERE run_id = ? AND step_id = ? LIMIT 1"
      )
      .get(workflowRunId, stepId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      workflowRunId: String(row.run_id),
      stepId: String(row.step_id),
      attempt: Number(row.attempt ?? 1),
      status: String(row.status),
      outputContent: row.output_content ? String(row.output_content) : null,
      state: (() => {
        try {
          return JSON.parse(String(row.state_json || "{}")) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
      updatedAt: String(row.updated_at)
    };
  }

  public saveWorkflowStepCheckpoint(input: {
    workflowRunId: string;
    stepId: string;
    attempt: number;
    status: string;
    outputContent: string | null;
    state: Record<string, unknown>;
  }): {
    workflowRunId: string;
    stepId: string;
    attempt: number;
    status: string;
    outputContent: string | null;
    state: Record<string, unknown>;
    updatedAt: string;
  } {
    const ts = this.now();
    this.sqlite
      .prepare(
        `INSERT INTO kosmora_workflow_checkpoints (
          run_id, step_id, attempt, status, output_content, state_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, step_id) DO UPDATE SET
          attempt = excluded.attempt,
          status = excluded.status,
          output_content = excluded.output_content,
          state_json = excluded.state_json,
          updated_at = excluded.updated_at`
      )
      .run(
        input.workflowRunId,
        input.stepId,
        input.attempt,
        input.status,
        input.outputContent,
        JSON.stringify(input.state),
        ts
      );
    return this.getWorkflowStepCheckpoint(input.workflowRunId, input.stepId)!;
  }

  public restoreFromPrivacySection(
    ownerId: string,
    section: {
      runs?: Array<Record<string, unknown>>;
      steps?: Array<Record<string, unknown>>;
      sources?: Array<Record<string, unknown>>;
      claims?: Array<Record<string, unknown>>;
      research_runs?: Array<Record<string, unknown>>;
      research_run_steps?: Array<Record<string, unknown>>;
      research_sources?: Array<Record<string, unknown>>;
      research_claims?: Array<Record<string, unknown>>;
    },
    projectIdMap: Record<string, string> = {}
  ): Record<string, string> {
    this.assertOwnerActive(ownerId);
    const ts = this.now();
    const runMap: Record<string, string> = {};
    const rawRuns = section.runs ?? section.research_runs ?? [];
    const rawSteps = section.steps ?? section.research_run_steps ?? [];
    const rawSources = section.sources ?? section.research_sources ?? [];
    const rawClaims = section.claims ?? section.research_claims ?? [];

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const insertRun = this.sqlite.prepare(
        `INSERT INTO research_runs (
          id, owner_id, project_id, query, normalized_query, client_request_id,
          status, next_index, checkpoint_json, current_step_index, total_steps,
          max_depth, max_sources, max_runtime_ms, elapsed_ms, depth_reached,
          expected_targets_json, report_markdown, report_json, error_code, error_message,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const run of rawRuns) {
        const oldId = String(run.id ?? "");
        if (!oldId) continue;
        const newId = `res_run_${randomUUID()}`;
        runMap[oldId] = newId;
        const oldProjId = run.project_id ? String(run.project_id) : null;
        const mappedProjId = oldProjId ? (projectIdMap[oldProjId] ?? oldProjId) : null;
        const rawStatus = String(run.status ?? "completed");
        const restoredStatus =
          rawStatus === "running" || rawStatus === "queued" ? "paused" : rawStatus;
        const q = String(run.query ?? "");
        insertRun.run(
          newId,
          ownerId,
          mappedProjId,
          q,
          String(run.normalized_query ?? normalizeResearchQuery(q)),
          null,
          restoredStatus,
          Number(run.next_index ?? 0),
          String(run.checkpoint_json ?? "{}"),
          Number(run.current_step_index ?? 0),
          Number(run.total_steps ?? 0),
          Number(run.max_depth ?? 2),
          Number(run.max_sources ?? 6),
          Number(run.max_runtime_ms ?? 15000),
          Number(run.elapsed_ms ?? 0),
          Number(run.depth_reached ?? 0),
          String(run.expected_targets_json ?? "[]"),
          run.report_markdown ? String(run.report_markdown) : null,
          run.report_json ? String(run.report_json) : null,
          run.error_code ? String(run.error_code) : null,
          run.error_message ? String(run.error_message) : null,
          String(run.created_at ?? ts),
          ts
        );
      }

      const insertStep = this.sqlite.prepare(
        `INSERT INTO research_run_steps (
          run_id, step_index, step_key, step_kind, target_url, depth, status, attempts, checkpoint_json, error_code, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const st of rawSteps) {
        const mappedRunId = runMap[String(st.run_id ?? "")];
        if (!mappedRunId) continue;
        const rawStepStatus = String(st.status ?? "pending");
        const stepStatus = rawStepStatus === "running" ? "pending" : rawStepStatus;
        insertStep.run(
          mappedRunId,
          Number(st.step_index ?? 0),
          String(st.step_key ?? ""),
          String(st.step_kind ?? "read_source"),
          st.target_url ? String(st.target_url) : null,
          Number(st.depth ?? 1),
          stepStatus,
          Number(st.attempts ?? 0),
          String(st.checkpoint_json ?? "{}"),
          st.error_code ? String(st.error_code) : null,
          ts
        );
      }

      const insertSource = this.sqlite.prepare(
        `INSERT INTO research_sources (
          source_id, run_id, owner_id, original_url, canonical_url, title, domain,
          fetched_at, published_at, page_version, previous_page_version, page_changed,
          content_sha256, content_text, extracted_claims_json, depth, http_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const src of rawSources) {
        const mappedRunId = runMap[String(src.run_id ?? "")];
        if (!mappedRunId) continue;
        insertSource.run(
          `src_${randomUUID().slice(0, 12)}`,
          mappedRunId,
          ownerId,
          String(src.original_url ?? ""),
          String(src.canonical_url ?? ""),
          String(src.title ?? ""),
          String(src.domain ?? "local.fixture"),
          String(src.fetched_at ?? ts),
          src.published_at ? String(src.published_at) : null,
          String(src.page_version ?? ""),
          src.previous_page_version ? String(src.previous_page_version) : null,
          Number(src.page_changed ? 1 : 0),
          String(src.content_sha256 ?? ""),
          String(src.content_text ?? ""),
          String(src.extracted_claims_json ?? "[]"),
          Number(src.depth ?? 1),
          Number(src.http_status ?? 200)
        );
      }

      const insertClaim = this.sqlite.prepare(
        `INSERT INTO research_claims (
          claim_id, run_id, owner_id, subject, criterion, category,
          resolved_value, conflict_summary, unconfirmed_reason, citations_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const clm of rawClaims) {
        const mappedRunId = runMap[String(clm.run_id ?? "")];
        if (!mappedRunId) continue;
        insertClaim.run(
          `clm_${mappedRunId}_${randomUUID().slice(0, 8)}`,
          mappedRunId,
          ownerId,
          String(clm.subject ?? ""),
          String(clm.criterion ?? ""),
          String(clm.category ?? "unconfirmed"),
          String(clm.resolved_value ?? ""),
          clm.conflict_summary ? String(clm.conflict_summary) : null,
          clm.unconfirmed_reason ? String(clm.unconfirmed_reason) : null,
          String(clm.citations_json ?? "[]"),
          String(clm.created_at ?? ts)
        );
      }

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }

    return runMap;
  }

  public resolveConflictingClaim(
    runId: string,
    ownerId: string,
    claimId: string,
    input: {
      winningSourceId: string;
      resolutionNote?: string;
    }
  ): ResearchRunView {
    const run = this.getRunForOwner(runId, ownerId);
    const allClaims = this.listClaims(runId);
    const targetIdx = allClaims.findIndex((c) => c.claimId === claimId);
    if (targetIdx < 0) {
      throw new Error("RESEARCH_CLAIM_NOT_FOUND");
    }

    const claim = allClaims[targetIdx];
    const winningQuery = String(input.winningSourceId ?? "").trim();
    const winningCitation = claim.citations.find(
      (cit) =>
        cit.sourceId === winningQuery ||
        cit.canonicalUrl === winningQuery ||
        cit.originalUrl === winningQuery
    );
    if (!winningCitation) {
      throw new Error("RESEARCH_INVALID_WINNING_SOURCE");
    }

    const note =
      String(input.resolutionNote ?? "").trim() ||
      "Подтверждено владельцем исследования по приоритетному проверенному источнику.";

    allClaims[targetIdx] = {
      ...claim,
      category: "confirmed",
      resolvedValue: winningCitation.claimedValue,
      resolutionAudit: {
        resolvedBy: ownerId,
        resolvedAt: this.now(),
        previousCategory: claim.category,
        winningSourceId: winningCitation.sourceId,
        winningCanonicalUrl: winningCitation.canonicalUrl,
        winningPageVersion: winningCitation.pageVersion,
        winningClaimedValue: winningCitation.claimedValue,
        resolutionNote: note
      }
    };

    this.recordRunAuditEvent(runId, ownerId, "research.claim.conflict_resolved", {
      claimId,
      winningSourceId: winningCitation.sourceId,
      winningPageVersion: winningCitation.pageVersion,
      winningClaimedValue: winningCitation.claimedValue,
      resolutionNote: note
    });
    return this.saveSynthesizedClaimsAndReport(runId, ownerId, allClaims, run.status);
  }

  public answerGroundedQuestionFromRun(
    runId: string,
    ownerId: string,
    question: string
  ): GroundedResearchQuestionAnswer {
    const run = this.getRunForOwner(runId, ownerId);
    const qNorm = normalizeResearchQuery(question);
    const allClaims = [
      ...run.confirmedClaims,
      ...run.conflictingClaims,
      ...run.unconfirmedClaims
    ];

    const matchedClaim = allClaims.find(
      (c) =>
        qNorm.includes(c.criterion.toLowerCase()) ||
        c.criterion.toLowerCase().includes(qNorm)
    );

    if (!matchedClaim || matchedClaim.category === "unconfirmed") {
      return {
        runId: run.id,
        question,
        status: "unconfirmed",
        answerText: "не удалось установить",
        citations: []
      };
    }

    if (matchedClaim.category === "conflicting") {
      return {
        runId: run.id,
        question,
        status: "conflicting",
        answerText: `${matchedClaim.resolvedValue} (${matchedClaim.conflictSummary})`,
        citations: matchedClaim.citations
      };
    }

    return {
      runId: run.id,
      question,
      status: "confirmed",
      answerText: `${matchedClaim.subject} — ${matchedClaim.criterion}: ${matchedClaim.resolvedValue}`,
      citations: matchedClaim.citations
    };
  }

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
    const initialCheckpoint: ResearchCheckpointEnvelope = {
      next_index: 0,
      plan_model_completed: false,
      planned_queries: [],
      model_calls_count: 0,
      canvas_artifact_id: null,
      project_message_id: null,
      discovered_urls: []
    };

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite
        .prepare(
          `INSERT INTO research_runs (
            id, owner_id, project_id, query, normalized_query, client_request_id,
            status, next_index, checkpoint_json, current_step_index, total_steps,
            max_depth, max_sources, max_runtime_ms,
            elapsed_ms, depth_reached, expected_targets_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, 0, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
        )
        .run(
          runId,
          input.ownerId,
          input.projectId,
          input.query,
          normQuery,
          input.clientRequestId ?? null,
          JSON.stringify(initialCheckpoint),
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

    this.recordRunAuditEvent(runId, input.ownerId, "research.run.created", {
      query: input.query,
      projectId: input.projectId,
      maxDepth: input.maxDepth,
      maxSources: input.maxSources
    });
    return this.getRunForOwner(runId, input.ownerId);
  }

  public updateRunCheckpointEnvelope(
    runId: string,
    ownerId: string,
    patch: Partial<ResearchCheckpointEnvelope>
  ): ResearchCheckpointEnvelope {
    const row = this.requireRunRow(runId, ownerId);
    const current = this.parseCheckpointEnvelope(row);
    const updated: ResearchCheckpointEnvelope = {
      next_index: patch.next_index !== undefined ? patch.next_index : current.next_index,
      plan_model_completed:
        patch.plan_model_completed !== undefined
          ? patch.plan_model_completed
          : current.plan_model_completed,
      planned_queries:
        patch.planned_queries !== undefined ? patch.planned_queries : current.planned_queries,
      model_calls_count:
        patch.model_calls_count !== undefined
          ? patch.model_calls_count
          : current.model_calls_count,
      canvas_artifact_id:
        patch.canvas_artifact_id !== undefined
          ? patch.canvas_artifact_id
          : current.canvas_artifact_id,
      project_message_id:
        patch.project_message_id !== undefined
          ? patch.project_message_id
          : current.project_message_id,
      discovered_urls:
        patch.discovered_urls !== undefined ? patch.discovered_urls : current.discovered_urls
    };

    const ts = this.now();
    this.sqlite
      .prepare(
        `UPDATE research_runs
         SET next_index = ?, checkpoint_json = ?, updated_at = ?
         WHERE id = ? AND owner_id = ?`
      )
      .run(updated.next_index, JSON.stringify(updated), ts, runId, ownerId);

    return updated;
  }

  public registerDiscoveredSourceSteps(
    runId: string,
    ownerId: string,
    candidates: Array<{
      url: string;
      depth: number;
      initialExpectedVersion?: string | null;
    }>
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

    const synthStep = existingSteps.find((s) => s.stepKind === "synthesize");
    const nonSynthSteps = existingSteps.filter((s) => s.stepKind !== "synthesize");
    const toInsert: Array<{
      stepKey: string;
      targetUrl: string;
      canonicalUrl: string;
      depth: number;
      initialExpectedVersion: string | null;
    }> = [];

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
        canonicalUrl: canonical,
        depth: cand.depth,
        initialExpectedVersion: cand.initialExpectedVersion ?? null
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
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, ?)`
      );

      for (const item of toInsert) {
        insertStmt.run(
          runId,
          nextIndex++,
          item.stepKey,
          "read_source",
          item.targetUrl,
          item.depth,
          JSON.stringify(
            item.initialExpectedVersion
              ? { initialExpectedVersion: item.initialExpectedVersion, discoveredAt: ts }
              : {}
          ),
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
          "{}",
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

    const envelope = this.parseCheckpointEnvelope(run);
    this.updateRunCheckpointEnvelope(runId, ownerId, {
      discovered_urls: [
        ...envelope.discovered_urls,
        ...toInsert.map((i) => ({
          originalUrl: i.targetUrl,
          canonicalUrl: i.canonicalUrl,
          depth: i.depth,
          initialExpectedVersion: i.initialExpectedVersion
        }))
      ]
    });

    return this.listSteps(runId);
  }

  public updateRunStatus(
    runId: string,
    ownerId: string,
    patch: {
      status?: ResearchRunStatus;
      nextIndex?: number;
      currentStepIndex?: number;
      elapsedMs?: number;
      depthReached?: number;
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  ): void {
    const run = this.requireRunRow(runId, ownerId);
    const ts = this.now();
    const nextIdx =
      patch.nextIndex !== undefined ? patch.nextIndex : Number(run.next_index ?? 0);

    if (patch.nextIndex !== undefined) {
      this.updateRunCheckpointEnvelope(runId, ownerId, { next_index: patch.nextIndex });
    }

    this.sqlite
      .prepare(
        `UPDATE research_runs
         SET status = ?,
             next_index = ?,
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
        nextIdx,
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

    const readSteps = this.listSteps(runId).filter((s) => s.stepKind === "read_source");
    let nextReadIdx = 0;
    for (let i = 0; i < readSteps.length; i++) {
      if (readSteps[i].status === "completed") {
        nextReadIdx = i + 1;
      } else {
        break;
      }
    }

    this.updateRunCheckpointEnvelope(runId, ownerId, { next_index: nextReadIdx });
    this.sqlite
      .prepare(
        `UPDATE research_runs
         SET current_step_index = ?, next_index = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(Number(existing.step_index), nextReadIdx, ts, runId);

    return this.listSteps(runId).find((s) => s.stepKey === stepKey)!;
  }

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
        const u = new URL(canonicalUrl);
        return u.protocol === "kosmora-doc:" ? "project.document_library" : u.hostname.toLowerCase();
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
        const storedCitationsPayload = c.resolutionAudit
          ? { citations: c.citations, resolutionAudit: c.resolutionAudit }
          : c.citations;
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
          JSON.stringify(storedCitationsPayload),
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

    this.recordRunAuditEvent(runId, ownerId, "research.claims.synthesized", {
      status,
      confirmedCount: confirmedClaims.length,
      conflictingCount: conflictingClaims.length,
      unconfirmedCount: unconfirmedClaims.length
    });
    this.syncOwnerEvidenceInvertedIndex(ownerId);
    this.syncOwnerProbabilisticFilter(ownerId);
    return this.getRunForOwner(runId, ownerId);
  }

  public getExpectedTargets(
    runId: string,
    ownerId: string
  ): Array<{ subject: string; criterion: string }> {
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

    return rows.map((r) => {
      const parsed = (() => {
        try {
          return JSON.parse(String(r.citations_json || "[]"));
        } catch {
          return [];
        }
      })();
      const citations = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.citations)
          ? parsed.citations
          : [];
      const resolutionAudit =
        !Array.isArray(parsed) && parsed?.resolutionAudit ? parsed.resolutionAudit : null;

      return {
        claimId: String(r.claim_id),
        subject: String(r.subject),
        criterion: String(r.criterion),
        category: String(r.category) as SynthesizedResearchClaim["category"],
        resolvedValue: String(r.resolved_value),
        conflictSummary: r.conflict_summary ? String(r.conflict_summary) : null,
        unconfirmedReason: r.unconfirmed_reason ? String(r.unconfirmed_reason) : null,
        citations,
        resolutionAudit
      };
    });
  }

  private parseCheckpointEnvelope(row: Record<string, unknown>): ResearchCheckpointEnvelope {
    const fallbackNextIndex = Number(row.next_index ?? 0);
    try {
      const parsed = JSON.parse(String(row.checkpoint_json || "{}")) as Partial<ResearchCheckpointEnvelope>;
      return {
        next_index:
          typeof parsed.next_index === "number" ? parsed.next_index : fallbackNextIndex,
        plan_model_completed: Boolean(parsed.plan_model_completed),
        planned_queries: Array.isArray(parsed.planned_queries)
          ? parsed.planned_queries.map(String)
          : [],
        model_calls_count: Number(parsed.model_calls_count ?? 0),
        canvas_artifact_id:
          typeof parsed.canvas_artifact_id === "string" ? parsed.canvas_artifact_id : null,
        project_message_id:
          typeof parsed.project_message_id === "string" ? parsed.project_message_id : null,
        discovered_urls: Array.isArray(parsed.discovered_urls) ? parsed.discovered_urls : []
      };
    } catch {
      return {
        next_index: fallbackNextIndex,
        plan_model_completed: false,
        planned_queries: [],
        model_calls_count: 0,
        canvas_artifact_id: null,
        project_message_id: null,
        discovered_urls: []
      };
    }
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
    const checkpoint = this.parseCheckpointEnvelope(row);
    const status = String(row.status) as ResearchRunStatus;

    const completedSteps = steps.filter((s) => s.status === "completed").length;
    const pendingSteps = steps.filter(
      (s) => s.status === "pending" || s.status === "running" || s.status === "cancelled"
    ).length;
    const failedSteps = steps.filter((s) => s.status === "failed").length;
    const totalSteps = Math.max(steps.length, Number(row.total_steps || 0));
    const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
    const nextIndex = Number(row.next_index ?? checkpoint.next_index ?? 0);
    const canResume =
      status === "failed" || status === "cancelled" || status === "paused";

    return {
      id: runId,
      ownerId: String(row.owner_id),
      projectId: row.project_id ? String(row.project_id) : null,
      query: String(row.query),
      normalizedQuery: String(row.normalized_query || normalizeResearchQuery(String(row.query))),
      clientRequestId: row.client_request_id ? String(row.client_request_id) : null,
      status,
      canResume,
      nextIndex,
      canvasArtifactId: checkpoint.canvas_artifact_id,
      projectMessageId: checkpoint.project_message_id,
      checkpoint,
      progress: {
        currentStepIndex: Number(row.current_step_index || 0),
        nextIndex,
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
        sourcesRead: sources.length,
        modelCallsCount: checkpoint.model_calls_count
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
