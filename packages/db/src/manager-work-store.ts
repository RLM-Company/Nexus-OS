import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreateManagerWork, ManagerWork, ManagerWorkFiles } from "@cosmora/contracts";
import { ProjectMemoryStore } from "./project-memory-store.js";
import { WorkRuntimeStore } from "./work-runtime-store.js";
import { ProjectStore } from "./project-store.js";

export class ManagerWorkConflict extends Error {}

export class ManagerWorkStore {
  readonly memory: ProjectMemoryStore;
  readonly runtime: WorkRuntimeStore;
  constructor(private readonly sqlite: DatabaseSync) {
    this.memory = new ProjectMemoryStore(sqlite);
    this.runtime = new WorkRuntimeStore(sqlite);
  }

  /** Durable privacy fence: prevents a queued Work task from starting during export/delete. */
  ownerWritable(ownerId: string): boolean {
    return !this.sqlite.prepare(
      "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'"
    ).get(ownerId);
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
      const busy = this.sqlite
        .prepare(
          "SELECT id FROM manager_work WHERE project_id = ? AND id != ? AND json_extract(state_json, '$.status') = 'running' LIMIT 1"
        )
        .get(state.project_id, state.id);
      const latest = this.get(state.id, state.owner_id);
      if (busy || !latest || latest.version !== state.version || latest.status !== "queued")
        return null;
      return this.persist({ ...latest, status: "running" });
    });
  }

  create(
    projectId: string,
    ownerId: string,
    actorId: string,
    request: CreateManagerWork
  ): ManagerWork | null {
    if (
      !this.sqlite
        .prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ? AND status = 'ACTIVE'")
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
    const at = new Date().toISOString();
    const materials = new ProjectStore(this.sqlite).getMaterials(projectId, ownerId);
    const state: ManagerWork = {
      id: randomUUID(),
      project_id: projectId,
      owner_id: ownerId,
      actor_id: actorId,
      request,
      ...(materials && (materials.instructions || materials.attachments.length)
        ? {
            materials: { instructions: materials.instructions, attachments: materials.attachments }
          }
        : {}),
      memory_snapshot: this.memory.snapshot(projectId, ownerId),
      status: "queued",
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
    this.transaction(() => {
      this.sqlite
        .prepare(
          "INSERT INTO manager_work (id, project_id, owner_id, client_request_id, version, state_json) VALUES (?, ?, ?, ?, 1, ?)"
        )
        .run(state.id, projectId, ownerId, request.client_request_id, JSON.stringify(state));
      this.runtime.checkpoint(state);
    });
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

  private persist(state: ManagerWork, message?: string): ManagerWork {
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
    return id;
  }

  publish(id: string, ownerId: string, files: ManagerWorkFiles): string[] {
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
