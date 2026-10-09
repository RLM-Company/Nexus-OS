import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { GithubDraft, GithubFileChange } from "../github-integration.js";
import type { CodeAgentCheckResult } from "@cosmora/tool-runtime";

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
  project_id: string;
  owner_id: string;
  actor_id: string;
  version: number;
  status: CodeAgentStatus;
  task: string;
  base_branch: string;
  base_sha: string;
  workspace_scope: string;
  repository: string;
  requested_files: string[];
  snapshot: GithubFileChange[];
  proposal?: Array<GithubFileChange & { before: string | null }>;
  proposal_hash?: string;
  summary?: string;
  draft_id?: string;
  draft?: GithubDraft;
  publication_token?: string;
  check?: CodeAgentCheckResult & { review_hash: string };
  error?: string;
  log: Array<{ at: string; event: string }>;
  created_at: string;
}
export class CodeAgentError extends Error {}
export class CodeAgentStore {
  constructor(readonly sqlite: DatabaseSync) {
    // Dedicated feature table; no mutation of the shared schema/migrations.
    sqlite.exec(`CREATE TABLE IF NOT EXISTS code_agent_runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      owner_id TEXT NOT NULL, version INTEGER NOT NULL, state_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS code_agent_project ON code_agent_runs(project_id, owner_id, created_at);`);
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
    const chat = this.sqlite
      .prepare("SELECT id FROM chats WHERE project_id=? AND kind='main'")
      .get(run.project_id);
    if (!chat) throw new CodeAgentError("PROJECT_CHAT_MISSING");
    const id = randomUUID(),
      at = new Date().toISOString();
    this.sqlite
      .prepare(
        "INSERT INTO runs (id,project_id,chat_id,status,created_at,updated_at) VALUES (?,?,?,'running',?,?)"
      )
      .run(id, run.project_id, String(chat.id), at, at);
    return id;
  }
}
