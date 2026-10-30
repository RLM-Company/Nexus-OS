import { WorkSkillStore } from "./work-skill-store.js";
import { WorkDagStore } from "./work-dag-store.js";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreateManagerWork, ManagerWork, ManagerWorkFiles } from "@cosmora/contracts";
import { ProjectMemoryStore } from "./project-memory-store.js";
import { ContextMemoryStore } from "./context-memory-store.js";
import { WorkRuntimeStore } from "./work-runtime-store.js";
import { ProjectStore } from "./project-store.js";

export class ManagerWorkConflict extends Error {}
type WorkPrivacySnapshot = Readonly<{
  owner_id: string;
  work_epoch: number;
  global_epoch: number;
  affected_ids: readonly string[];
}>;

export class ManagerWorkStore {
  private readonly privacySnapshots = new Map<string, WorkPrivacySnapshot>();
  readonly dag: WorkDagStore;
  readonly skills: WorkSkillStore;
  readonly memory: ProjectMemoryStore;
  readonly contextMemory: ContextMemoryStore;
  readonly runtime: WorkRuntimeStore;
  constructor(private readonly sqlite: DatabaseSync) {
    this.dag = new WorkDagStore(sqlite);
    this.skills = new WorkSkillStore(sqlite);
    this.memory = new ProjectMemoryStore(sqlite);
    this.contextMemory = new ContextMemoryStore(sqlite);
    this.runtime = new WorkRuntimeStore(sqlite);
  }

  /** Durable privacy fence: prevents a queued Work task from starting during export/delete. */
  ownerWritable(ownerId: string): boolean {
    return (
      !this.sqlite
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(ownerId) &&
      !this.sqlite
        .prepare("SELECT 1 FROM work_owner_fences WHERE owner_id=? AND fenced=1")
        .get(ownerId)
    );
  }

  assertWritable(ownerId: string): void {
    if (
      this.sqlite
        .prepare("SELECT 1 FROM work_owner_fences WHERE owner_id = ? AND fenced = 1")
        .get(ownerId)
    )
      throw new ManagerWorkConflict("OWNER_QUIESCED");
    if (!this.ownerWritable(ownerId)) throw new ManagerWorkConflict("OWNER_DATA_FENCED");
  }
  holds(): string[] {
    return (
      this.sqlite
        .prepare(
          "SELECT json_extract(state_json, '$.owner_budget_hold_id') AS id FROM manager_work WHERE json_extract(state_json, '$.owner_budget_hold_id') IS NOT NULL"
        )
        .all() as { id: string }[]
    ).map((r) => r.id);
  }
  /** Global privacy has already frozen user-data inserts: fence without checkpoints. */
  fencePrivacySnapshot(ownerId: string): WorkPrivacySnapshot {
    const snapshot = this.transaction(() => {
      const global = this.sqlite
        .prepare("SELECT state,epoch FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
        .get(ownerId) as { state: string; epoch: number } | undefined;
      if (global?.state !== "quiescing")
        throw new ManagerWorkConflict("GLOBAL_PRIVACY_FENCE_REQUIRED");
      this.sqlite
        .prepare(
          "INSERT INTO work_owner_fences(owner_id,epoch,fenced) VALUES (?,1,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=epoch+1,fenced=1"
        )
        .run(ownerId);
      const local = this.sqlite
        .prepare("SELECT epoch FROM work_owner_fences WHERE owner_id=?")
        .get(ownerId) as { epoch: number };
      const affected = this.sqlite
        .prepare(
          "SELECT w.id FROM manager_work w JOIN projects p ON p.id=w.project_id WHERE w.owner_id=? AND p.owner_id=? AND json_extract(w.state_json,'$.status') IN ('queued','running')"
        )
        .all(ownerId, ownerId) as { id: string }[];
      return Object.freeze({
        owner_id: ownerId,
        work_epoch: local.epoch,
        global_epoch: global.epoch,
        affected_ids: Object.freeze(affected.map((row) => row.id))
      });
    });
    this.privacySnapshots.set(ownerId, snapshot);
    return snapshot;
  }
  /** Trusted terminal reconciliation of the exact interrupted IDs; never a provider replay. */
  resumePrivacySnapshot(snapshot: WorkPrivacySnapshot): void {
    if (this.privacySnapshots.get(snapshot.owner_id) !== snapshot)
      throw new ManagerWorkConflict("UNKNOWN_PRIVACY_SNAPSHOT");
    this.transaction(() => {
      const global = this.sqlite
        .prepare("SELECT state,epoch FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
        .get(snapshot.owner_id) as { state: string; epoch: number } | undefined;
      if (global?.state !== "active" || global.epoch !== snapshot.global_epoch)
        throw new ManagerWorkConflict("OWNER_DATA_FENCED");
      this.releaseOwnerFence(snapshot.owner_id, snapshot.work_epoch);
      for (const id of snapshot.affected_ids) {
        const work = this.get(id, snapshot.owner_id);
        if (!work) throw new ManagerWorkConflict("PRIVACY_WORK_MISSING");
        if (!["queued", "running"].includes(work.status)) continue;
        this.persist(
          {
            ...work,
            status: "failed",
            pause_requested: true,
            error_code: "OWNER_PRIVACY_INTERRUPTED"
          },
          "Операция с данными прервала работу; новая попытка требует явного действия владельца"
        );
      }
    });
    this.privacySnapshots.delete(snapshot.owner_id);
  }
  fenceOwner(ownerId: string): number {
    return this.transaction(() => {
      this.sqlite
        .prepare(
          "INSERT INTO work_owner_fences(owner_id,epoch,fenced) VALUES (?,1,1) ON CONFLICT(owner_id) DO UPDATE SET epoch = epoch + 1, fenced = 1"
        )
        .run(ownerId);
      const row = this.sqlite
        .prepare("SELECT epoch FROM work_owner_fences WHERE owner_id = ?")
        .get(ownerId) as { epoch: number };
      for (const record of this.sqlite
        .prepare(
          "SELECT state_json FROM manager_work WHERE owner_id = ? AND json_extract(state_json, '$.status') NOT IN ('completed','failed','cancelled')"
        )
        .all(ownerId) as { state_json: string }[]) {
        const state = JSON.parse(record.state_json) as ManagerWork;
        state.status = "cancelled";
        state.error_code = "OWNER_QUIESCED";
        this.persist(state, "Остановлено для операции над данными владельца", true);
      }
      this.dag.quiesce(ownerId);
      return row.epoch;
    });
  }
  releaseOwnerFence(ownerId: string, epoch: number): void {
    if (
      this.sqlite
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(ownerId)
    )
      throw new ManagerWorkConflict("OWNER_DATA_FENCED");
    if (
      !this.sqlite
        .prepare(
          "UPDATE work_owner_fences SET fenced = 0 WHERE owner_id = ? AND epoch = ? AND fenced = 1"
        )
        .run(ownerId, epoch).changes
    )
      throw new ManagerWorkConflict("STALE_OWNER_FENCE");
  }

  private transaction<T>(execute: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = execute();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  // SQLite CAS also excludes a second active work item in the same project.
  claim(state: ManagerWork): ManagerWork | null {
    return this.transaction(() => {
      this.assertWritable(state.owner_id);
      if (this.dag.projectMode(state.project_id, state.owner_id) !== "active") return null;
      const busy = this.sqlite
        .prepare(
          "SELECT id FROM manager_work WHERE project_id = ? AND id != ? AND json_extract(state_json, '$.status') = 'running' LIMIT 1"
        )
        .get(state.project_id, state.id);
      const latest = this.get(state.id, state.owner_id);
      if (latest?.dag_binding && !latest.dag_binding.bound) return null;
      if (busy || !latest || latest.version !== state.version || latest.status !== "queued")
        return null;
      return this.persist({ ...latest, status: "running" });
    });
  }

  create(
    projectId: string,
    ownerId: string,
    actorId: string,
    request: CreateManagerWork,
    dormant = false,
    dagBinding?: ManagerWork["dag_binding"]
  ): ManagerWork | null {
    return this.transaction(() =>
      this.createAccepted(projectId, ownerId, actorId, request, dormant, dagBinding)
    );
  }

  private createAccepted(
    projectId: string,
    ownerId: string,
    actorId: string,
    request: CreateManagerWork,
    dormant: boolean,
    dagBinding?: ManagerWork["dag_binding"]
  ): ManagerWork | null {
    this.assertWritable(ownerId);
    const mode = this.dag.projectMode(projectId, ownerId);
    if (mode === "cancelled") throw new ManagerWorkConflict("PROJECT_CANCELLED");
    if (
      !this.sqlite
        .prepare(
          "SELECT id FROM projects WHERE id = ? AND owner_id = ? AND status IN ('DRAFT','ACTIVE')"
        )
        .get(projectId, ownerId)
    )
      return null;
    const existing = this.sqlite
      .prepare(
        "SELECT state_json FROM manager_work WHERE project_id = ? AND owner_id = ? AND client_request_id = ?"
      )
      .get(projectId, ownerId, request.client_request_id) as { state_json: string } | undefined;
    if (existing) {
      const state = JSON.parse(existing.state_json) as ManagerWork;
      if (JSON.stringify(state.request) !== JSON.stringify(request) || state.actor_id !== actorId)
        throw new ManagerWorkConflict("IDEMPOTENCY_CONFLICT");
      return state;
    }
    const outstanding = this.sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM manager_work WHERE project_id = ? AND owner_id = ? AND json_extract(state_json, '$.status') NOT IN ('completed', 'failed', 'cancelled')"
      )
      .get(projectId, ownerId) as { count: number };
    if (outstanding.count >= 50) throw new ManagerWorkConflict("WORK_QUEUE_LIMIT");
    // Activation, accepted materials and all Work snapshots are one transaction.
    // Queue/fence/snapshot failures cannot leave a draft partially activated.
    this.sqlite
      .prepare("UPDATE projects SET status='ACTIVE' WHERE id=? AND owner_id=? AND status='DRAFT'")
      .run(projectId, ownerId);
    const at = new Date().toISOString();
    const materials = new ProjectStore(this.sqlite).getMaterials(projectId, ownerId);
    const state: ManagerWork = {
      id: randomUUID(),
      project_id: projectId,
      owner_id: ownerId,
      actor_id: actorId,
      ...(dagBinding ? { dag_binding: dagBinding } : {}),
      request,
      ...(materials && (materials.instructions || materials.attachments.length)
        ? {
            materials: { instructions: materials.instructions, attachments: materials.attachments }
          }
        : {}),
      memory_snapshot: this.memory.snapshot(projectId, ownerId),
      status: dormant || mode === "paused" ? "paused" : "queued",
      stage: "plan",
      version: 1,
      pause_requested: false,
      approved: false,
      inflight_run_id: null,
      model_requests: 0,
      reserved_input_tokens: 0,
      reserved_output_tokens: 0,
      plan: null,
      draft: null,
      review: null,
      confirmation_id: null,
      error_code: null,
      events: [{ sequence: 1, stage: "plan", message: "Задача принята", at }],
      created_at: at,
      updated_at: at
    };
    this.sqlite
      .prepare(
        "INSERT INTO manager_work (id, project_id, owner_id, client_request_id, version, state_json) VALUES (?, ?, ?, ?, 1, ?)"
      )
      .run(state.id, projectId, ownerId, request.client_request_id, JSON.stringify(state));
    this.skills.captureWork(state.id, projectId, ownerId, dagBinding?.graph_id);
    this.runtime.checkpoint(state);
    return state;
  }

  get(id: string, ownerId: string): ManagerWork | null {
    const row = this.sqlite
      .prepare(
        "SELECT w.state_json FROM manager_work w JOIN projects p ON p.id = w.project_id WHERE w.id = ? AND w.owner_id = ? AND p.owner_id = ?"
      )
      .get(id, ownerId, ownerId) as { state_json: string } | undefined;
    return row ? (JSON.parse(row.state_json) as ManagerWork) : null;
  }

  list(projectId: string, ownerId: string): ManagerWork[] {
    return (
      this.sqlite
        .prepare(
          "SELECT id FROM manager_work WHERE project_id = ? AND owner_id = ? ORDER BY CASE WHEN json_extract(state_json, '$.status') NOT IN ('completed', 'failed', 'cancelled') THEN 0 ELSE 1 END, rowid DESC LIMIT 80"
        )
        .all(projectId, ownerId) as { id: string }[]
    ).flatMap((row) => this.get(row.id, ownerId) ?? []);
  }

  pending(): ManagerWork[] {
    return (
      this.sqlite
        .prepare(
          "SELECT state_json FROM manager_work WHERE json_extract(state_json, '$.status') = 'queued' AND NOT EXISTS (SELECT 1 FROM manager_work r WHERE r.project_id = manager_work.project_id AND json_extract(r.state_json, '$.status') = 'running') ORDER BY rowid LIMIT 50"
        )
        .all() as { state_json: string }[]
    ).map((row) => JSON.parse(row.state_json) as ManagerWork);
  }

  save(state: ManagerWork, message?: string): ManagerWork {
    return this.transaction(() => this.persist(state, message));
  }

  private persist(state: ManagerWork, message?: string, fencedCancellation = false): ManagerWork {
    if (!fencedCancellation) this.assertWritable(state.owner_id);
    const next = structuredClone(state);
    next.version++;
    next.updated_at = new Date().toISOString();
    if (message)
      next.events.push({
        sequence: next.events.length + 1,
        stage: next.stage,
        message,
        at: next.updated_at
      });
    const result = this.sqlite
      .prepare(
        "UPDATE manager_work SET version = ?, state_json = ? WHERE id = ? AND owner_id = ? AND version = ?"
      )
      .run(next.version, JSON.stringify(next), state.id, state.owner_id, state.version);
    if (Number(result.changes) !== 1) throw new ManagerWorkConflict("STALE_EXECUTION");
    this.runtime.checkpoint(next);
    return next;
  }

  // Internal child runs start as running and have no chat messages. The existing
  // chat dispatcher cannot claim them; all model usage shares the project ledger.
  createModelRun(state: ManagerWork): string {
    return this.transaction(() => {
      this.assertWritable(state.owner_id);
      const latest = this.get(state.id, state.owner_id);
      if (
        !latest ||
        latest.version !== state.version ||
        latest.status !== "running" ||
        latest.inflight_run_id
      )
        throw new ManagerWorkConflict("STALE_EXECUTION");
      const chat = this.sqlite
        .prepare("SELECT id FROM chats WHERE project_id = ? AND kind = 'main'")
        .get(state.project_id) as { id: string } | undefined;
      if (!chat) throw new Error("PROJECT_CHAT_MISSING");
      const id = randomUUID(),
        at = new Date().toISOString();
      this.sqlite
        .prepare(
          "INSERT INTO runs (id, project_id, chat_id, status, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?)"
        )
        .run(id, state.project_id, chat.id, at, at);
      const next = { ...latest, inflight_run_id: id };
      delete next.output_checkpoint;
      this.persist(next);
      return id;
    });
  }

  publish(id: string, ownerId: string, files: ManagerWorkFiles): string[] {
    this.assertWritable(ownerId);
    const state = this.get(id, ownerId);
    if (
      !state ||
      state.stage !== "publish" ||
      state.status !== "running" ||
      JSON.stringify(state.draft) !== JSON.stringify(files)
    )
      throw new ManagerWorkConflict("EXECUTION_NOT_PUBLISHABLE");
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const file of files.files) {
        const previous = this.sqlite
          .prepare("SELECT content FROM manager_work_files WHERE execution_id = ? AND name = ?")
          .get(id, file.name) as { content: string } | undefined;
        if (previous && previous.content !== file.content)
          throw new ManagerWorkConflict("ARTIFACT_CONFLICT");
        this.sqlite
          .prepare(
            "INSERT OR IGNORE INTO manager_work_files (execution_id, name, content) VALUES (?, ?, ?)"
          )
          .run(id, file.name, file.content);
      }
      this.runtime.markPublished(id);
      this.sqlite.exec("COMMIT");
      return files.files.map((file) => file.name);
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  file(id: string, ownerId: string, name: string): string | null {
    if (this.get(id, ownerId)?.status !== "completed") return null;
    const row = this.sqlite
      .prepare("SELECT content FROM manager_work_files WHERE execution_id = ? AND name = ?")
      .get(id, name) as { content: string } | undefined;
    return row?.content ?? null;
  }

  recover(): number {
    const states = (
      this.sqlite
        .prepare(
          "SELECT state_json FROM manager_work WHERE json_extract(state_json, '$.status') = 'running'"
        )
        .all() as { state_json: string }[]
    ).map((row) => JSON.parse(row.state_json) as ManagerWork);
    for (const state of states) {
      // Publication commits files and immutable version flags together. A crash
      // after that commit may leave the work running; finish from durable proof,
      // without invoking the tool again or restoring any policy grant.
      const published =
        state.stage === "publish" &&
        state.draft?.files.length &&
        state.draft.files.every((file) => {
          const record = this.sqlite
            .prepare(
              "SELECT f.content FROM manager_work_files f JOIN work_artifact_versions a ON a.work_id = f.execution_id AND a.name = f.name WHERE f.execution_id = ? AND f.name = ? AND a.published = 1 AND a.content = f.content"
            )
            .get(state.id, file.name) as { content: string } | undefined;
          return record?.content === file.content;
        });
      if (published) {
        state.status = "completed";
        state.stage = "done";
        state.inflight_run_id = null;
        state.error_code = null;
        if (state.task_graph) {
          for (const task of state.task_graph.tasks)
            if (task.stage === "publish") task.status = "completed";
          state.task_graph.completed = state.task_graph.total;
          state.task_graph.waiting_decision = null;
          state.task_graph.next_task_id = null;
        }
        this.save(state, "Завершено по подтверждённым сохранённым файлам; повтор не выполнялся");
        continue;
      }
      // An interrupted provider/tool operation must never be submitted twice.
      state.status = state.inflight_run_id || state.stage === "publish" ? "failed" : "paused";
      state.error_code = state.status === "failed" ? "RECOVERY_REQUIRED" : null;
      if (state.task_graph) {
        for (const task of state.task_graph.tasks) {
          if (task.stage === state.stage && task.status === "running")
            task.status = state.status === "failed" ? "failed" : "waiting";
        }
        state.task_graph.waiting_decision = state.status === "failed" ? "recovery" : "resume";
        state.task_graph.next_task_id =
          state.status === "failed" ? null : state.id + ":" + state.stage;
      }
      this.save(state, "Процесс был прерван; автоматический повтор отключён");
    }
    return states.length;
  }
}
