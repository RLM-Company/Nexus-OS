/* eslint-disable @typescript-eslint/require-await -- PrivacyAdapter keeps Promise results for synchronous stores; fence checks, snapshots and SQLite deletion must not gain an artificial yield. */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { DatabaseSync } from "node:sqlite";
import type {
  PrivacyAdapter,
  PrivacySection,
  BinaryStream,
  OriginalBinary
} from "./coordinator.js";
import type { DocumentAnswerStore, DocumentLibraryStore } from "@cosmora/db";
import type { DocumentAnswerService } from "../../document-answer-service.js";
import type { ManagerWorkCoordinator } from "../../manager-work-coordinator.js";
import type { ResearchStore } from "../../research/research-store.js";
import type { ResearchCoordinator } from "../../research/research-coordinator.js";
import type { MediaService } from "../../media/media-service.js";
import type { CodeAgentService } from "../../code-agent/service.js";

const recordSet = (sql: DatabaseSync, query: string, owner: string): Record<string, unknown>[] =>
  sql.prepare(query).all(owner);
const owned = (sql: DatabaseSync, table: string, owner: string): Record<string, unknown>[] =>
  recordSet(
    sql,
    `SELECT t.* FROM ${table} t JOIN projects p ON p.id=t.project_id WHERE p.owner_id=?`,
    owner
  );
const purge = (sql: DatabaseSync, table: string, owner: string): number =>
  Number(
    sql
      .prepare(
        `DELETE FROM ${table} WHERE project_id IN (SELECT id FROM projects WHERE owner_id=?)`
      )
      .run(owner).changes
  );
const epochValid = (sql: DatabaseSync, owner: string, epoch: number): void => {
  if (
    !sql
      .prepare(
        "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND epoch=? AND state='deleting'"
      )
      .get(owner, epoch)
  )
    throw Error("DELETION_FENCE_REQUIRED");
};
const descriptor = (id: string, name: string, mime: string, data: Uint8Array): OriginalBinary => ({
  id,
  filename: name,
  content_type: mime,
  size_bytes: data.byteLength,
  sha256: createHash("sha256").update(data).digest("hex")
});
const finish = (epoch: number): { drained: true; fence_epoch: number } => ({
  drained: true,
  fence_epoch: epoch
});

export class DocumentsPrivacyAdapter implements PrivacyAdapter {
  readonly id = "documents";
  constructor(
    private readonly sql: DatabaseSync,
    private readonly library: DocumentLibraryStore,
    private readonly answers: DocumentAnswerStore,
    private readonly worker: DocumentAnswerService
  ) {}
  async quiesce(owner: string, epoch: number) {
    await this.worker.quiesce(owner);
    return finish(epoch);
  }
  async resume(owner: string) {
    this.worker.resume(owner);
  }
  async export(owner: string): Promise<PrivacySection> {
    const rows = this.answers.exportOwner(owner);
    const originals: OriginalBinary[] = rows.manifest.map((row) => ({
      id: String(row.id),
      filename: String(row.name),
      content_type: String(row.media_type),
      size_bytes: Number(row.bytes),
      sha256: String(row.sha256)
    }));
    if (rows.manifest.length !== rows.files.length) throw Error("INCOMPLETE_DOCUMENT_ORIGINALS");
    return {
      records: { files: rows.files, chunks: rows.chunks, answers: rows.answers },
      originals,
      complete: true
    };
  }
  async readBinary(owner: string, id: string): Promise<BinaryStream | null> {
    const row = this.sql
      .prepare("SELECT project_id FROM document_library_files WHERE owner_id=? AND id=?")
      .get(owner, id) as { project_id: string } | undefined;
    if (!row) return null;
    const original = this.library.original(row.project_id, owner, id);
    if (!original) return null;
    const data = Buffer.from(original.bytes);
    return {
      stream: Readable.from([data]),
      original: descriptor(id, original.name, original.media_type, data)
    };
  }
  async delete(owner: string, epoch: number) {
    epochValid(this.sql, owner, epoch);
    const count = this.answers.deleteOwner(owner);
    return { deleted_records: count.answers + count.originals };
  }
}

export class WorkPrivacyAdapter implements PrivacyAdapter {
  readonly id = "work";
  constructor(
    private readonly sql: DatabaseSync,
    private readonly coordinator: ManagerWorkCoordinator
  ) {}
  async quiesce(owner: string, epoch: number) {
    await this.coordinator.quiesceOwner(owner);
    return finish(epoch);
  }
  async resume(owner: string) {
    this.coordinator.resumeOwner(owner);
  }
  async export(owner: string): Promise<PrivacySection> {
    return {
      records: {
        work: recordSet(this.sql, "SELECT * FROM manager_work WHERE owner_id=?", owner),
        skill_settings: recordSet(
          this.sql,
          "SELECT s.* FROM work_skill_settings s JOIN projects p ON p.id=s.project_id WHERE p.owner_id=?",
          owner
        ),
        skill_selections: recordSet(
          this.sql,
          "SELECT s.* FROM work_skill_selections s JOIN projects p ON p.id=s.project_id WHERE p.owner_id=?",
          owner
        ),
        work_skills: recordSet(
          this.sql,
          "SELECT s.* FROM manager_work_skill_snapshots s JOIN manager_work w ON w.id=s.work_id JOIN projects p ON p.id=w.project_id WHERE w.owner_id=? AND p.owner_id=w.owner_id",
          owner
        ),
        plan_skills: recordSet(
          this.sql,
          "SELECT s.* FROM work_dag_skill_snapshots s JOIN work_dags d ON d.id=s.graph_id JOIN projects p ON p.id=d.project_id WHERE d.owner_id=? AND p.owner_id=d.owner_id",
          owner
        ),
        work_files: recordSet(
          this.sql,
          "SELECT f.* FROM manager_work_files f JOIN manager_work w ON w.id=f.execution_id WHERE w.owner_id=?",
          owner
        ),
        checkpoints: recordSet(
          this.sql,
          "SELECT c.* FROM work_checkpoints c JOIN manager_work w ON w.id=c.work_id WHERE w.owner_id=?",
          owner
        ),
        artifacts: owned(this.sql, "work_artifact_versions", owner),
        dags: recordSet(this.sql, "SELECT * FROM work_dags WHERE owner_id=?", owner),
        dag_checkpoints: recordSet(
          this.sql,
          "SELECT c.* FROM work_dag_checkpoints c JOIN work_dags g ON g.id=c.graph_id WHERE g.owner_id=?",
          owner
        ),
        project_controls: recordSet(
          this.sql,
          "SELECT * FROM work_project_controls WHERE owner_id=?",
          owner
        ),
        memory: recordSet(this.sql, "SELECT * FROM project_memory WHERE owner_id=?", owner)
      },
      originals: [],
      complete: true
    };
  }
  async delete(owner: string, epoch: number) {
    epochValid(this.sql, owner, epoch);
    const selectionRows = Number(
      this.sql
        .prepare(
          "DELETE FROM work_skill_selections WHERE project_id IN (SELECT id FROM projects WHERE owner_id=?)"
        )
        .run(owner).changes
    );
    const settingsRows = Number(
      this.sql
        .prepare(
          "DELETE FROM work_skill_settings WHERE project_id IN (SELECT id FROM projects WHERE owner_id=?)"
        )
        .run(owner).changes
    );
    const memory = Number(
      this.sql.prepare("DELETE FROM project_memory WHERE owner_id=?").run(owner).changes
    );
    const works = Number(
      this.sql.prepare("DELETE FROM manager_work WHERE owner_id=?").run(owner).changes
    );
    const dags = Number(
      this.sql.prepare("DELETE FROM work_dags WHERE owner_id=?").run(owner).changes
    );
    const controls = Number(
      this.sql.prepare("DELETE FROM work_project_controls WHERE owner_id=?").run(owner).changes
    );
    // FK cascade removes checkpoints, drafts and artifact versions, including old Work v1.
    return { deleted_records: memory + works + dags + controls + selectionRows + settingsRows };
  }
}

export class ResearchIntegratedPrivacyAdapter implements PrivacyAdapter {
  readonly id = "research";
  constructor(
    private readonly sql: DatabaseSync,
    private readonly store: ResearchStore,
    private readonly getCoordinator: () => ResearchCoordinator | null
  ) {}
  async quiesce(owner: string, epoch: number) {
    const coordinator = this.getCoordinator();
    if (!coordinator) throw Error("RESEARCH_COORDINATOR_UNAVAILABLE");
    await coordinator.quiesce(owner);
    return finish(epoch);
  }
  async resume(owner: string) {
    this.store.unfence(owner);
  }
  async export(owner: string): Promise<PrivacySection> {
    if (!this.store.isFenced(owner)) throw Error("RESEARCH_UNQUIESCED");
    return { records: { research: this.store.list(owner) }, originals: [], complete: true };
  }
  async delete(owner: string, epoch: number) {
    epochValid(this.sql, owner, epoch);
    return { deleted_records: this.store.deleteOwner(owner) };
  }
}

export class MediaIntegratedPrivacyAdapter implements PrivacyAdapter {
  readonly id = "media";
  constructor(private readonly service: MediaService) {}
  async quiesce(owner: string, epoch: number) {
    if (!this.service.storageReady()) throw Error("MEDIA_STORAGE_UNAVAILABLE");
    await this.service.quiesce(owner);
    return finish(epoch);
  }
  async resume(owner: string) {
    this.service.resume(owner);
  }
  async export(owner: string): Promise<PrivacySection> {
    if (!this.service.storageReady()) throw Error("MEDIA_STORAGE_UNAVAILABLE");
    const jobs = this.service.list(owner);
    const originals: OriginalBinary[] = [];
    for (const job of jobs) {
      if (job.status !== "done" || !job.asset) continue;
      const asset = this.service.asset(job.id, owner);
      if (!asset) throw Error("MEDIA_ORIGINAL_MISSING");
      const label = `media-${job.id}.${asset.extension}`;
      originals.push(descriptor(job.id, label, asset.mime, asset.bytes));
    }
    return { records: { media_jobs: jobs }, originals, complete: true };
  }
  async readBinary(owner: string, id: string): Promise<BinaryStream | null> {
    const asset = this.service.asset(id, owner);
    if (!asset) return null;
    return {
      stream: Readable.from([asset.bytes]),
      original: descriptor(id, `media-${id}.${asset.extension}`, asset.mime, asset.bytes)
    };
  }
  async delete(owner: string, epoch: number) {
    // The lifecycle fence is durable; service uses ownerActive to block late writes.
    void epoch;
    const result = await this.service.deleteOwner(owner);
    return { deleted_records: result.deleted_jobs };
  }
}

export class CodeIntegratedPrivacyAdapter implements PrivacyAdapter {
  readonly id = "code";
  constructor(
    private readonly sql: DatabaseSync,
    private readonly service: CodeAgentService
  ) {}
  async quiesce(owner: string, epoch: number) {
    await this.service.quiesceOwner(owner);
    return finish(epoch);
  }
  async resume(owner: string) {
    this.service.resumeOwner(owner);
  }
  async export(owner: string): Promise<PrivacySection> {
    return {
      records: {
        code_runs: recordSet(
          this.sql,
          "SELECT id,project_id,owner_id,version,state_json,created_at FROM code_agent_runs WHERE owner_id=?",
          owner
        )
      },
      originals: [],
      complete: true
    };
  }
  async delete(owner: string, epoch: number) {
    epochValid(this.sql, owner, epoch);
    return {
      deleted_records: Number(
        this.sql.prepare("DELETE FROM code_agent_runs WHERE owner_id=?").run(owner).changes
      )
    };
  }
}

export class AgentStudioPrivacyAdapter implements PrivacyAdapter {
  readonly id = "agent-studio";
  constructor(private readonly sql: DatabaseSync) {}
  async quiesce(_owner: string, epoch: number) {
    return finish(epoch);
  }
  async export(owner: string): Promise<PrivacySection> {
    return {
      records: {
        blueprints: recordSet(this.sql, "SELECT * FROM agent_blueprints WHERE owner_id=?", owner),
        instances: recordSet(this.sql, "SELECT * FROM agent_instances WHERE owner_id=?", owner),
        mutations: recordSet(
          this.sql,
          "SELECT * FROM agent_studio_mutations WHERE owner_id=?",
          owner
        ),
        decisions: recordSet(
          this.sql,
          "SELECT * FROM agent_studio_decision_events WHERE owner_id=?",
          owner
        )
      },
      originals: [],
      complete: true
    };
  }
  async delete(owner: string, epoch: number) {
    epochValid(this.sql, owner, epoch);
    let n = 0;
    for (const table of ["agent_studio_decision_events", "agent_studio_mutations"])
      n += Number(this.sql.prepare(`DELETE FROM ${table} WHERE owner_id=?`).run(owner).changes);
    // Self-referencing FK RESTRICT: remove leaves before their parents.
    while (true) {
      const result = this.sql
        .prepare(
          `DELETE FROM agent_instances WHERE owner_id=? AND NOT EXISTS (
        SELECT 1 FROM agent_instances child WHERE child.parent_instance_id=agent_instances.instance_id)`
        )
        .run(owner);
      if (!result.changes) break;
      n += Number(result.changes);
    }
    const left = this.sql
      .prepare("SELECT 1 FROM agent_instances WHERE owner_id=? LIMIT 1")
      .get(owner);
    if (left) throw Error("AGENT_INSTANCE_DEPENDENCIES_REMAIN");
    n += Number(
      this.sql.prepare("DELETE FROM agent_blueprints WHERE owner_id=?").run(owner).changes
    );
    return { deleted_records: n };
  }
}

export class PolicyProjectsPrivacyAdapter implements PrivacyAdapter {
  readonly id = "policy-projects";
  private readonly tables = [
    "policy_decisions",
    "policy_operations",
    "confirmation_requests",
    "permission_contracts",
    "autonomy_profiles"
  ] as const;
  constructor(private readonly sql: DatabaseSync) {}
  async quiesce(_owner: string, epoch: number) {
    return finish(epoch);
  }
  async export(owner: string): Promise<PrivacySection> {
    return {
      records: Object.fromEntries(
        this.tables.map((table) => [
          table,
          owned(this.sql, table, owner).map((row) =>
            table === "confirmation_requests"
              ? Object.fromEntries(Object.entries(row).filter(([k]) => k !== "challenge_nonce"))
              : row
          )
        ])
      ),
      originals: [],
      complete: true
    };
  }
  async delete(owner: string, epoch: number) {
    epochValid(this.sql, owner, epoch);
    let n = 0;
    // Archive owner-scoped operation/decision audit BEFORE project FK cascades.
    for (const table of ["policy_decisions", "policy_operations"] as const)
      for (const row of owned(this.sql, table, owner)) {
        const key = String(row[table === "policy_decisions" ? "decision_id" : "operation_id"]);
        this.sql
          .prepare(
            `INSERT OR IGNORE INTO kosmora_retained_policy_audit(owner_id,source,source_id,payload_json)
          VALUES(?,?,?,?)`
          )
          .run(owner, table, key, JSON.stringify(row));
      }
    for (const table of this.tables) n += purge(this.sql, table, owner);
    return { deleted_records: n };
  }
}
