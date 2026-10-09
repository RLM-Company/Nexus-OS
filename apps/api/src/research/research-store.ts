import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ResearchRun, ResearchStatus } from "@cosmora/core";

/** Fixture schema mirrors canonical migration 0028; production constructors never run DDL. */
export const RESEARCH_SQL = `
CREATE TABLE IF NOT EXISTS research_v1_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS research_v1_owner_idx ON research_v1_runs(owner_id, created_at DESC);
`;

export class ResearchStore {
  constructor(private readonly sqlite: DatabaseSync) {
    // Never silently restart external network work after a process crash.
    const interrupted = sqlite
      .prepare(
        "SELECT id, payload_json FROM research_v1_runs WHERE status IN ('searching', 'reading', 'queued')"
      )
      .all() as unknown as Array<{ id: string; payload_json: string }>;
    for (const item of interrupted) {
      const run = JSON.parse(item.payload_json) as ResearchRun;
      run.status = "paused";
      run.stage = "Остановлено при перезапуске сервера. Можно продолжить.";
      run.updated_at = new Date().toISOString();
      this.#write(run);
    }
  }
  #write(run: ResearchRun): void {
    this.sqlite
      .prepare(
        "UPDATE research_v1_runs SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?"
      )
      .run(run.status, JSON.stringify(run), run.updated_at, run.id);
  }
  create(
    ownerId: string,
    actorId: string,
    projectId: string,
    question: string,
    id: string = randomUUID()
  ): ResearchRun {
    const count = this.sqlite
      .prepare("SELECT count(*) as total FROM research_v1_runs WHERE owner_id = ?")
      .get(ownerId) as { total: number };
    if (count.total >= 25) throw new Error("RESEARCH_QUOTA");
    const timestamp = new Date().toISOString();
    const run: ResearchRun = {
      id,
      owner_id: ownerId,
      actor_id: actorId,
      project_id: projectId,
      question,
      status: "queued",
      stage: "В очереди",
      candidates: [],
      next_index: 0,
      sources: [],
      attempts: 0,
      error_code: null,
      created_at: timestamp,
      updated_at: timestamp
    };
    this.sqlite
      .prepare(
        "INSERT INTO research_v1_runs (id, owner_id, project_id, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(run.id, ownerId, projectId, run.status, JSON.stringify(run), timestamp, timestamp);
    return run;
  }
  delete(id: string, ownerId: string): boolean {
    return (
      this.sqlite
        .prepare(
          "DELETE FROM research_v1_runs WHERE id = ? AND owner_id = ? AND status IN ('completed', 'failed', 'cancelled', 'paused')"
        )
        .run(id, ownerId).changes === 1
    );
  }
  get(id: string, ownerId: string): ResearchRun | null {
    const row = this.sqlite
      .prepare("SELECT payload_json FROM research_v1_runs WHERE id = ? AND owner_id = ?")
      .get(id, ownerId) as { payload_json: string } | undefined;
    return row ? (JSON.parse(row.payload_json) as ResearchRun) : null;
  }
  list(ownerId: string): ResearchRun[] {
    return (
      this.sqlite
        .prepare(
          "SELECT payload_json FROM research_v1_runs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 25"
        )
        .all(ownerId) as unknown as Array<{ payload_json: string }>
    ).map((row) => JSON.parse(row.payload_json) as ResearchRun);
  }
  /** Changes are serialized on the synchronous SQLite connection; abort wins over late results. */
  update(
    id: string,
    ownerId: string,
    statuses: ResearchStatus[],
    change: (run: ResearchRun) => void
  ): ResearchRun | null {
    const run = this.get(id, ownerId);
    if (!run || !statuses.includes(run.status)) return null;
    change(run);
    run.updated_at = new Date().toISOString();
    this.#write(run);
    return run;
  }
}
