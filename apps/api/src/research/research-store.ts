import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ResearchRun, ResearchStatus } from "@cosmora/core";

/** Tables must already be installed through managed migration 0028. No runtime DDL. */
export class ResearchStore {
  private readonly fencedOwners = new Set<string>();
  fence(ownerId: string): void { this.fencedOwners.add(ownerId); }
  unfence(ownerId: string): void { this.fencedOwners.delete(ownerId); }
  isFenced(ownerId: string): boolean { return this.fencedOwners.has(ownerId); }
  constructor(private readonly sqlite: DatabaseSync) {
    // Never silently restart external network work after a process crash.
    const interrupted = sqlite.prepare("SELECT id, payload_json FROM research_v1_runs WHERE status IN ('searching', 'reading', 'queued', 'synthesizing')").all() as unknown as Array<{ id: string; payload_json: string }>;
    for (const item of interrupted) {
      const run = JSON.parse(item.payload_json) as ResearchRun;
      // If synthesis may have reached provider, do not re-dispatch after crash.
      if (run.model?.phase === "dispatching" && run.model.usage_state === "committed") {
        run.model.phase = "failed";
        run.error_code = "SYNTHESIS_INTERRUPTED_AFTER_SETTLEMENT";
        run.status = "failed";
        run.stage = "Учёт модели подтверждён, но отчёт не был сохранён; повтор только по запросу владельца.";
      } else if (run.model?.phase === "dispatching") {
        run.model.phase = "uncertain";
        run.model.usage_state = "uncertain";
        run.error_code = "MODEL_USAGE_UNCERTAIN";
        run.status = "failed";
        run.stage = "Модель прервана при перезапуске; резерв расхода удержан. Автоповтор запрещён.";
      } else {
        run.status = "paused";
        run.stage = "Остановлено при перезапуске сервера. Можно продолжить.";
      }
      run.updated_at = new Date().toISOString();
      this.#write(run);
    }
  }
  #write(run: ResearchRun): void {
    this.sqlite.prepare("UPDATE research_v1_runs SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?")
      .run(run.status, JSON.stringify(run), run.updated_at, run.id);
  }
  create(ownerId: string, actorId: string, projectId: string, question: string, id = randomUUID()): ResearchRun {
    if (this.isFenced(ownerId)) throw Error("RESEARCH_OWNER_QUIESCED");
    const count = this.sqlite.prepare("SELECT count(*) as total FROM research_v1_runs WHERE owner_id = ?").get(ownerId) as { total: number };
    if (count.total >= 25) throw new Error("RESEARCH_QUOTA");
    const timestamp = new Date().toISOString();
    const run: ResearchRun = {
      id, owner_id: ownerId, actor_id: actorId, project_id: projectId, question, status: "queued",
      stage: "В очереди", candidates: [], next_index: 0, sources: [], attempts: 0,
      error_code: null, answer: null,
      model: { phase: "pending", run_id: null, usage_state: "none", error_code: null, revision: 0 },
      created_at: timestamp, updated_at: timestamp
    };
    this.sqlite.prepare("INSERT INTO research_v1_runs (id, owner_id, project_id, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(run.id, ownerId, projectId, run.status, JSON.stringify(run), timestamp, timestamp);
    return run;
  }
  delete(id: string, ownerId: string): boolean {
    return this.sqlite.prepare("DELETE FROM research_v1_runs WHERE id = ? AND owner_id = ? AND status IN ('completed', 'failed', 'cancelled', 'paused')").run(id, ownerId).changes === 1;
  }
  get(id: string, ownerId: string): ResearchRun | null {
    const row = this.sqlite.prepare("SELECT payload_json FROM research_v1_runs WHERE id = ? AND owner_id = ?").get(id, ownerId) as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as ResearchRun : null;
  }
  list(ownerId: string): ResearchRun[] {
    return (this.sqlite.prepare("SELECT payload_json FROM research_v1_runs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 25").all(ownerId) as unknown as Array<{ payload_json: string }>).map((row) => JSON.parse(row.payload_json) as ResearchRun);
  }
  /** Owner privacy deletion excludes usage ledger, provider accounting and system audit. */
  deleteOwner(ownerId: string): number {
    if (!this.isFenced(ownerId)) throw Error("RESEARCH_QUIESCE_REQUIRED");
    return Number(this.sqlite.prepare("DELETE FROM research_v1_runs WHERE owner_id = ?").run(ownerId).changes);
  }
  /** Changes are serialized on the synchronous SQLite connection; abort wins over late results. */
  update(id: string, ownerId: string, statuses: ResearchStatus[], change: (run: ResearchRun) => void): ResearchRun | null {
    if (this.isFenced(ownerId)) return null;
    const run = this.get(id, ownerId);
    if (!run || !statuses.includes(run.status)) return null;
    change(run);
    run.updated_at = new Date().toISOString();
    this.#write(run);
    return run;
  }
}
