import type { DatabaseSync } from "node:sqlite";

/** Standalone continuation state for a supplier execution cycle.
 *
 * Stored separately from ManagerWork so the active Work contract is unchanged.
 * The work_id is a reference only; raw source files remain in the handoff
 * snapshot and published artifacts. */
export type WorkExecutionCycle = {
  work_id: string;
  owner_id: string;
  stage:
    | "collecting"
    | "extracting"
    | "awaiting_answer"
    | "calculating"
    | "result_ready"
    | "paused"
    | "cancelled";
  version: number;
  question: string | null;
  gaps: Array<{ code: string; path: string; question?: string }>;
  instructions: string[];
  error_code: string | null;
  accepted_inputs: Array<{ name: string; sha256: string }>;
  result_ref: string | null;
  updated_at: string;
};

export class WorkExecutionCycleConflict extends Error {}

export class WorkExecutionCycleStore {
  constructor(private readonly db: DatabaseSync) {}

  get(workId: string, ownerId: string): WorkExecutionCycle | null {
    const row = this.db
      .prepare("SELECT * FROM work_execution_cycles WHERE work_id=? AND owner_id=?")
      .get(workId, ownerId) as Record<string, string | number> | undefined;
    if (!row) return null;
    return {
      work_id: String(row.work_id),
      owner_id: String(row.owner_id),
      stage: String(row.stage) as WorkExecutionCycle["stage"],
      version: Number(row.cycle_version),
      question: row.question === null ? null : String(row.question),
      gaps: JSON.parse(String(row.gaps_json)) as WorkExecutionCycle["gaps"],
      instructions: JSON.parse(String(row.instructions_json)) as string[],
      error_code: row.error_code === null ? null : String(row.error_code),
      accepted_inputs: JSON.parse(
        String(row.accepted_inputs_json)
      ) as WorkExecutionCycle["accepted_inputs"],
      result_ref: row.result_ref === null ? null : String(row.result_ref),
      updated_at: String(row.updated_at)
    };
  }

  /** CAS write. version must be exactly one greater than the stored version,
   * or zero/one for the first record. No ManagerWork row is modified. */
  save(next: WorkExecutionCycle, expectedVersion: number): WorkExecutionCycle {
    if (!Number.isSafeInteger(next.version) || next.version < 1)
      throw new WorkExecutionCycleConflict("INVALID_CYCLE_VERSION");
    const current = this.get(next.work_id, next.owner_id);
    const expected = current?.version ?? 0;
    if (expectedVersion !== expected || next.version !== expected + 1)
      throw new WorkExecutionCycleConflict("STALE_CYCLE");
    const timestamp = new Date().toISOString();
    const value = { ...next, updated_at: timestamp };
    this.db
      .prepare(
        "INSERT INTO work_execution_cycles(work_id,owner_id,stage,cycle_version,question,gaps_json,instructions_json,error_code,accepted_inputs_json,result_ref,created_at,updated_at) " +
          "VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(work_id,owner_id) DO UPDATE SET " +
          "stage=excluded.stage,cycle_version=excluded.cycle_version,question=excluded.question," +
          "gaps_json=excluded.gaps_json,instructions_json=excluded.instructions_json," +
          "error_code=excluded.error_code,accepted_inputs_json=excluded.accepted_inputs_json," +
          "result_ref=excluded.result_ref,updated_at=excluded.updated_at"
      )
      .run(
        value.work_id,
        value.owner_id,
        value.stage,
        value.version,
        value.question,
        JSON.stringify(value.gaps),
        JSON.stringify(value.instructions),
        value.error_code,
        JSON.stringify(value.accepted_inputs),
        value.result_ref,
        timestamp,
        timestamp
      );
    return value;
  }
}
