import type { GithubIssueContext } from "../github-issue-context.js";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { GithubDraft, GithubFileChange } from "../github-integration.js";
import type { CodeAgentCheckResult } from "@cosmora/tool-runtime";
import type { ModelOutputCheckpoint } from "@cosmora/contracts";

export type CodeAgentStatus =
  | "running"
  | "proposed"
  | "review"
  | "checking"
  | "checked"
  | "publishing"
  | "published"
  | "uncertain"
  | "failed"
  | "cancelled";
export interface CodeAgentRun {
  id: string;
  client_request_id?: string;
  request_digest?: string;
  project_id: string;
  owner_id: string;
  actor_id: string;
  version: number;
  status: CodeAgentStatus;
  task: string;
  issue_context?: GithubIssueContext;
  base_branch: string;
  base_sha: string;
  workspace_scope: string;
  repository: string;
  requested_files: string[];
  snapshot: GithubFileChange[];
  model_run_ids?: string[];
  proposal?: Array<GithubFileChange & { before: string | null }>;
  proposal_hash?: string;
  summary?: string;
  repository_paths?: string[];
  proposal_diff?: string;
  proposal_snapshot_digest?: string;
  proposal_normalizations?: Array<{ path: string; line: number; before: string; after: string }>;
  patch_diagnostic?: { code: string; path?: string; line?: number };
  /** Owner-only recovery draft. Never validated, executed or published as a proposal. */
  rejected_proposal_text?: string;
  output_checkpoint?: ModelOutputCheckpoint;
  auto_check_requested?: "syntax" | "node-test";
  proposal_check?: (CodeAgentCheckResult & { proposal_hash: string }) | undefined;
  draft_id?: string;
  draft?: GithubDraft;
  publication_token?: string | undefined;
  check?: (CodeAgentCheckResult & { review_hash: string }) | undefined;
  error?: string | undefined;
  provider_diagnostic?: string | undefined;
  log: Array<{ at: string; event: string }>;
  created_at: string;
}
export class CodeAgentError extends Error {}
export class CodeAgentStore {
  constructor(readonly sqlite: DatabaseSync) {
    // Managed schema migration 0030 creates the existing feature table; no runtime DDL.
  }
  create(input: Omit<CodeAgentRun, "id" | "version" | "created_at" | "log">): CodeAgentRun {
    if (
      Number(
        this.sqlite
          .prepare("SELECT COUNT(*) AS n FROM code_agent_runs WHERE project_id=? AND owner_id=?")
          .get(input.project_id, input.owner_id)?.n
      ) >= 200
    )
      throw new CodeAgentError("RUN_LIMIT");
    const run: CodeAgentRun = {
      ...input,
      id: randomUUID(),
      version: 1,
      created_at: new Date().toISOString(),
      log: []
    };
    this.sqlite
      .prepare("INSERT INTO code_agent_runs VALUES (?, ?, ?, ?, ?, ?)")
      .run(run.id, run.project_id, run.owner_id, run.version, JSON.stringify(run), run.created_at);
    return run;
  }
  findRequest(owner: string, requestId: string): CodeAgentRun | null {
    const row = this.sqlite
      .prepare(
        "SELECT state_json FROM code_agent_runs WHERE owner_id=? AND json_extract(state_json,'$.client_request_id')=?"
      )
      .get(owner, requestId);
    return row ? (JSON.parse(String(row.state_json)) as CodeAgentRun) : null;
  }
  get(id: string, owner: string): CodeAgentRun | null {
    const row = this.sqlite
      .prepare("SELECT state_json FROM code_agent_runs WHERE id=? AND owner_id=?")
      .get(id, owner);
    return row ? (JSON.parse(String(row.state_json)) as CodeAgentRun) : null;
  }
  list(project: string, owner: string): CodeAgentRun[] {
    return this.sqlite
      .prepare(
        "SELECT state_json FROM code_agent_runs WHERE project_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 20"
      )
      .all(project, owner)
      .map((row) => JSON.parse(String(row.state_json)) as CodeAgentRun);
  }
  save(run: CodeAgentRun, event?: string): CodeAgentRun {
    const next = {
      ...run,
      version: run.version + 1,
      log: event ? [...run.log, { at: new Date().toISOString(), event }].slice(-100) : run.log
    };
    const result = this.sqlite
      .prepare(
        "UPDATE code_agent_runs SET version=?, state_json=? WHERE id=? AND owner_id=? AND version=?"
      )
      .run(next.version, JSON.stringify(next), run.id, run.owner_id, run.version);
    if (result.changes !== 1) throw new CodeAgentError("STALE_RUN");
    return next;
  }
  recover(): void {
    const rows = this.sqlite.prepare("SELECT state_json FROM code_agent_runs").all();
    for (const row of rows) {
      const run = JSON.parse(String(row.state_json)) as CodeAgentRun;
      if (["running", "checking"].includes(run.status))
        this.save(
          { ...run, status: "failed", error: "INTERRUPTED" },
          "Работа прервана перезапуском; автоматический повтор отключён"
        );
      if (run.status === "publishing")
        this.save(
          { ...run, status: "uncertain", error: "RECONCILIATION_REQUIRED" },
          "Проверьте результат публикации чтением GitHub"
        );
    }
  }
  createModelRun(run: CodeAgentRun): string {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(run.id, run.owner_id);
      if (!current || current.status !== "running") throw new CodeAgentError("EXECUTION_STOPPED");
      const chat = this.sqlite
        .prepare("SELECT id FROM chats WHERE project_id=? AND kind='main'")
        .get(current.project_id);
      if (!chat) throw new CodeAgentError("PROJECT_CHAT_MISSING");
      const id = randomUUID(),
        at = new Date().toISOString();
      this.sqlite
        .prepare(
          "INSERT INTO runs (id,project_id,chat_id,status,created_at,updated_at) VALUES (?,?,?,'running',?,?)"
        )
        .run(id, current.project_id, String(chat.id), at, at);
      const next = { ...current, model_run_ids: [...(current.model_run_ids ?? []), id] };
      delete next.output_checkpoint;
      this.save(next);
      this.sqlite.exec("COMMIT");
      return id;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  modelRunReferences(): Array<{ owner: string; id: string }> {
    return this.sqlite
      .prepare("SELECT state_json FROM code_agent_runs")
      .all()
      .flatMap((row) => {
        const run = JSON.parse(String(row.state_json)) as CodeAgentRun;
        return (run.model_run_ids ?? []).map((id) => ({ owner: run.owner_id, id }));
      });
  }
}
