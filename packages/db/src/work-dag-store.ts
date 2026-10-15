import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WorkDag, WorkDagCreate } from "@cosmora/contracts";
export class WorkDagConflict extends Error {}
export class WorkDagStore {
  constructor(private readonly sqlite: DatabaseSync) {}
  private owned(project: string, owner: string): boolean {
    return Boolean(
      this.sqlite
        .prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ? AND status = 'ACTIVE'")
        .get(project, owner)
    );
  }
  private writable(owner: string): void {
    if (
      this.sqlite
        .prepare("SELECT 1 FROM work_owner_fences WHERE owner_id = ? AND fenced = 1")
        .get(owner)
    )
      throw new WorkDagConflict("OWNER_QUIESCED");
    if (
      this.sqlite
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(owner)
    )
      throw new WorkDagConflict("OWNER_DATA_FENCED");
  }
  projectMode(project: string, owner: string): WorkDag["mode"] {
    const row = this.sqlite
      .prepare("SELECT mode FROM work_project_controls WHERE project_id = ? AND owner_id = ?")
      .get(project, owner) as { mode: WorkDag["mode"] } | undefined;
    return row?.mode ?? "active";
  }
  setProjectMode(project: string, owner: string, mode: WorkDag["mode"]): void {
    this.writable(owner);
    if (!this.owned(project, owner)) throw new WorkDagConflict("PROJECT_NOT_FOUND");
    if (this.projectMode(project, owner) === "cancelled")
      throw new WorkDagConflict("PROJECT_CANCELLED");
    this.sqlite
      .prepare(
        "INSERT INTO work_project_controls VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET mode = excluded.mode"
      )
      .run(project, owner, mode);
  }
  create(project: string, owner: string, actor: string, input: WorkDagCreate): WorkDag {
    this.writable(owner);
    if (!this.owned(project, owner)) throw new WorkDagConflict("PROJECT_NOT_FOUND");
    const previous = this.sqlite
      .prepare(
        "SELECT state_json, request_json FROM work_dags WHERE project_id = ? AND owner_id = ? AND client_request_id = ?"
      )
      .get(project, owner, input.client_request_id) as
      { state_json: string; request_json: string } | undefined;
    if (previous) {
      if (previous.request_json !== JSON.stringify(input))
        throw new WorkDagConflict("IDEMPOTENCY_CONFLICT");
      return JSON.parse(previous.state_json) as WorkDag;
    }
    const count = this.sqlite
      .prepare("SELECT COUNT(*) AS n FROM work_dags WHERE project_id = ?")
      .get(project) as { n: number };
    if (count.n >= 100) throw new WorkDagConflict("DAG_LIMIT");
    const mode = this.projectMode(project, owner);
    if (mode === "cancelled") throw new WorkDagConflict("PROJECT_CANCELLED");
    const at = new Date().toISOString();
    const graph: WorkDag = {
      id: randomUUID(),
      project_id: project,
      owner_id: owner,
      actor_id: actor,
      version: 1,
      client_request_id: input.client_request_id,
      title: input.title,
      mode,
      nodes: input.nodes.map((n) => ({
        ...n,
        status: mode === "paused" || n.depends_on.length ? "blocked" : "pending",
        blocked_reason:
          mode === "paused"
            ? "PROJECT_PAUSED"
            : n.depends_on.length
              ? "DEPENDENCIES:" + n.depends_on.join(",")
              : null,
        attempts: [],
        artifacts: []
      })),
      events: [{ sequence: 1, message: "План сохранён", at }],
      created_at: at,
      updated_at: at
    };
    return this.transaction(() => {
      this.sqlite
        .prepare("INSERT INTO work_dags VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
          graph.id,
          project,
          owner,
          input.client_request_id,
          1,
          JSON.stringify(graph),
          JSON.stringify(input)
        );
      this.checkpoint(graph);
      return graph;
    });
  }
  get(id: string, owner: string): WorkDag | null {
    const row = this.sqlite
      .prepare(
        "SELECT d.state_json FROM work_dags d JOIN projects p ON p.id = d.project_id WHERE d.id = ? AND d.owner_id = ? AND p.owner_id = ?"
      )
      .get(id, owner, owner) as { state_json: string } | undefined;
    return row ? (JSON.parse(row.state_json) as WorkDag) : null;
  }
  list(project: string, owner: string): WorkDag[] {
    return (
      this.sqlite
        .prepare(
          "SELECT id FROM work_dags WHERE project_id = ? AND owner_id = ? ORDER BY rowid DESC LIMIT 100"
        )
        .all(project, owner) as { id: string }[]
    ).flatMap((r) => this.get(r.id, owner) ?? []);
  }
  active(): WorkDag[] {
    return (
      this.sqlite
        .prepare(
          "SELECT state_json FROM work_dags WHERE json_extract(state_json, '$.mode') != 'cancelled'"
        )
        .all() as { state_json: string }[]
    ).map((r) => JSON.parse(r.state_json) as WorkDag);
  }
  save(graph: WorkDag, message: string): WorkDag {
    this.writable(graph.owner_id);
    const next = structuredClone(graph);
    next.version++;
    next.updated_at = new Date().toISOString();
    next.events.push({ sequence: next.events.length + 1, message, at: next.updated_at });
    return this.transaction(() => {
      this.writable(graph.owner_id);
      const result = this.sqlite
        .prepare(
          "UPDATE work_dags SET state_json = ?, version = ? WHERE id = ? AND owner_id = ? AND version = ?"
        )
        .run(JSON.stringify(next), next.version, graph.id, graph.owner_id, graph.version);
      if (!result.changes) throw new WorkDagConflict("STALE_DAG");
      this.checkpoint(next);
      return next;
    });
  }
  checkpoints(
    id: string,
    owner: string
  ): { version: number; at: string; nodes: { id: string; status: string }[] }[] {
    if (!this.get(id, owner)) return [];
    return (
      this.sqlite
        .prepare(
          "SELECT state_json FROM work_dag_checkpoints WHERE graph_id = ? ORDER BY version DESC LIMIT 100"
        )
        .all(id) as { state_json: string }[]
    ).map(
      (r) =>
        JSON.parse(r.state_json) as {
          version: number;
          at: string;
          nodes: { id: string; status: string }[];
        }
    );
  }
  // Used inside ManagerWorkStore's owner fence transaction. No deletion endpoint.
  quiesce(owner: string): void {
    for (const row of this.sqlite
      .prepare("SELECT state_json FROM work_dags WHERE owner_id = ?")
      .all(owner) as { state_json: string }[]) {
      const g = JSON.parse(row.state_json) as WorkDag;
      if (g.mode !== "cancelled") g.mode = "paused";
      if (g.execution && ["running", "waiting"].includes(g.execution.status)) {
        g.execution.status = "paused";
        g.execution.reason = "OWNER_QUIESCED";
      }
      for (const n of g.nodes)
        if (n.status === "running" || (n.attempts.length && n.status === "blocked")) {
          n.status = "cancelled";
          n.blocked_reason = "OWNER_QUIESCED";
        }
      for (const n of g.nodes)
        if (!n.attempts.length && !["failed", "completed", "cancelled"].includes(n.status)) {
          n.status = "blocked";
          n.blocked_reason = "PROJECT_PAUSED";
        }
      g.version++;
      g.updated_at = new Date().toISOString();
      g.events.push({
        sequence: g.events.length + 1,
        message: "Задачи владельца остановлены для операции над данными",
        at: g.updated_at
      });
      this.sqlite
        .prepare("UPDATE work_dags SET state_json = ?, version = ? WHERE id = ?")
        .run(JSON.stringify(g), g.version, g.id);
      this.checkpoint(g);
    }
  }
  private checkpoint(graph: WorkDag): void {
    this.sqlite.prepare("INSERT INTO work_dag_checkpoints VALUES (?, ?, ?)").run(
      graph.id,
      graph.version,
      JSON.stringify({
        version: graph.version,
        at: graph.updated_at,
        nodes: graph.nodes.map((n) => ({ id: n.id, status: n.status })),
        restores_permissions: false
      })
    );
  }
  private transaction<T>(fn: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.sqlite.exec("COMMIT");
      return value;
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
}
