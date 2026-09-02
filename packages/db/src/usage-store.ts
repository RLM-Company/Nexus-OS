import type { DatabaseSync } from "node:sqlite";
import type {
  Currency,
  ProjectUsageLimit,
  ProjectUsageSummary,
  UpdateProjectUsageLimitRequest,
  UsageCurrencyTotal
} from "@cosmora/contracts";
import { LOCAL_OWNER_ID } from "./project-store.js";

type UsageStatus = "reserved" | "committed" | "failed" | "cancelled";

interface UsageRow {
  status: unknown;
  estimated_input_tokens: unknown;
  max_output_tokens: unknown;
  estimated_cost_amount: unknown;
  actual_input_tokens: unknown;
  actual_output_tokens: unknown;
  calculated_cost_amount: unknown;
  currency: unknown;
}

interface UsageLimitRow {
  project_id: unknown;
  version: unknown;
  max_total_tokens: unknown;
  max_cost_amount: unknown;
  currency: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export class UsageLimitConflictError extends Error {
  constructor() {
    super("Project usage limit version changed");
    this.name = "UsageLimitConflictError";
  }
}

const nonNegativeNumber = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid Usage Ledger value: ${field}`);
  }
  return value;
};

const nullableNonNegativeNumber = (value: unknown, field: string): number | null =>
  value === null ? null : nonNegativeNumber(value, field);

const usageStatus = (value: unknown): UsageStatus => {
  if (
    value === "reserved" ||
    value === "committed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new Error("Invalid Usage Ledger value: status");
};

const currency = (value: unknown): Currency => {
  if (value === "USD" || value === "RUB") return value;
  throw new Error("Invalid Usage Ledger value: currency");
};

const usageLimit = (row: UsageLimitRow): ProjectUsageLimit => {
  if (
    typeof row.project_id !== "string" ||
    typeof row.version !== "number" ||
    !Number.isInteger(row.version) ||
    row.version < 1 ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    throw new Error("Invalid project usage limit");
  }
  const maxTotalTokens =
    row.max_total_tokens === null
      ? null
      : nonNegativeNumber(row.max_total_tokens, "max_total_tokens");
  if (maxTotalTokens !== null && (!Number.isInteger(maxTotalTokens) || maxTotalTokens < 1)) {
    throw new Error("Invalid project usage limit: max_total_tokens");
  }
  const amount =
    row.max_cost_amount === null ? null : nonNegativeNumber(row.max_cost_amount, "max_cost_amount");
  if ((amount === null) !== (row.currency === null) || amount === 0) {
    throw new Error("Invalid project usage limit: max_cost");
  }
  return {
    project_id: row.project_id,
    version: row.version,
    max_total_tokens: maxTotalTokens,
    max_cost: amount === null ? null : { amount, currency: currency(row.currency) },
    created_at: row.created_at,
    updated_at: row.updated_at
  };
};

export class UsageStore {
  readonly #sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.#sqlite = sqlite;
  }

  getLimit(projectId: string, ownerId = LOCAL_OWNER_ID): ProjectUsageLimit | null {
    const row = this.#sqlite
      .prepare(
        `SELECT project_id, version, max_total_tokens, max_cost_amount, currency,
          created_at, updated_at
         FROM project_usage_limits WHERE project_id = ? AND owner_id = ?`
      )
      .get(projectId, ownerId) as unknown as UsageLimitRow | undefined;
    return row ? usageLimit(row) : null;
  }

  ensureLimit(
    projectId: string,
    ownerId = LOCAL_OWNER_ID,
    timestamp = new Date().toISOString()
  ): ProjectUsageLimit | null {
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const project = this.#sqlite
        .prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?")
        .get(projectId, ownerId);
      if (!project) {
        this.#sqlite.exec("COMMIT;");
        return null;
      }
      this.#sqlite
        .prepare(
          `INSERT INTO project_usage_limits
            (project_id, owner_id, version, max_total_tokens, max_cost_amount, currency,
             created_at, updated_at)
           VALUES (?, ?, 1, NULL, NULL, NULL, ?, ?)
           ON CONFLICT(project_id) DO NOTHING`
        )
        .run(projectId, ownerId, timestamp, timestamp);
      const limit = this.getLimit(projectId, ownerId);
      this.#sqlite.exec("COMMIT;");
      if (!limit) throw new Error("Project usage limit initialization failed");
      return limit;
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  updateLimit(
    projectId: string,
    input: UpdateProjectUsageLimitRequest,
    ownerId = LOCAL_OWNER_ID,
    timestamp = new Date().toISOString()
  ): ProjectUsageLimit {
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const result = this.#sqlite
        .prepare(
          `UPDATE project_usage_limits
           SET version = version + 1, max_total_tokens = ?, max_cost_amount = ?, currency = ?,
             updated_at = ?
           WHERE project_id = ? AND owner_id = ? AND version = ?`
        )
        .run(
          input.max_total_tokens,
          input.max_cost?.amount ?? null,
          input.max_cost?.currency ?? null,
          timestamp,
          projectId,
          ownerId,
          input.expected_version
        );
      if (Number(result.changes) !== 1) throw new UsageLimitConflictError();
      const limit = this.getLimit(projectId, ownerId);
      if (!limit) throw new Error("Updated project usage limit is missing");
      this.#sqlite.exec("COMMIT;");
      return limit;
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  getProjectSummary(
    projectId: string,
    ownerId = LOCAL_OWNER_ID,
    generatedAt = new Date().toISOString()
  ): ProjectUsageSummary | null {
    const project = this.#sqlite
      .prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?")
      .get(projectId, ownerId);
    if (!project) return null;

    const rows = this.#sqlite
      .prepare(
        `SELECT status, estimated_input_tokens, max_output_tokens, estimated_cost_amount,
          actual_input_tokens, actual_output_tokens, calculated_cost_amount, currency
         FROM model_usage_ledger WHERE project_id = ? ORDER BY created_at ASC, rowid ASC`
      )
      .all(projectId) as unknown as UsageRow[];

    const attempts = { total: rows.length, reserved: 0, committed: 0, failed: 0, cancelled: 0 };
    const tokens = {
      committed_input: 0,
      committed_output: 0,
      reserved_upper_bound: 0,
      unknown_committed_attempts: 0
    };
    const costs = new Map<Currency, UsageCurrencyTotal>();
    let unknownCommittedCostAttempts = 0;
    let unknownReservedCostAttempts = 0;

    const addCost = (
      unit: Currency,
      field: "committed_amount" | "reserved_amount",
      amount: number
    ): void => {
      const total = costs.get(unit) ?? { currency: unit, committed_amount: 0, reserved_amount: 0 };
      total[field] += amount;
      costs.set(unit, total);
    };

    for (const row of rows) {
      const status = usageStatus(row.status);
      attempts[status] += 1;
      if (status === "reserved") {
        tokens.reserved_upper_bound +=
          nonNegativeNumber(row.estimated_input_tokens, "estimated_input_tokens") +
          nonNegativeNumber(row.max_output_tokens, "max_output_tokens");
        const amount = nullableNonNegativeNumber(
          row.estimated_cost_amount,
          "estimated_cost_amount"
        );
        if (amount === null) unknownReservedCostAttempts += 1;
        else addCost(currency(row.currency), "reserved_amount", amount);
      }
      if (status === "committed") {
        const input = nullableNonNegativeNumber(row.actual_input_tokens, "actual_input_tokens");
        const output = nullableNonNegativeNumber(row.actual_output_tokens, "actual_output_tokens");
        if (input === null || output === null) tokens.unknown_committed_attempts += 1;
        tokens.committed_input += input ?? 0;
        tokens.committed_output += output ?? 0;
        const amount = nullableNonNegativeNumber(
          row.calculated_cost_amount,
          "calculated_cost_amount"
        );
        if (amount === null) unknownCommittedCostAttempts += 1;
        else addCost(currency(row.currency), "committed_amount", amount);
      }
    }

    return {
      project_id: projectId,
      generated_at: generatedAt,
      attempts,
      tokens,
      costs: [...costs.values()].sort((left, right) => left.currency.localeCompare(right.currency)),
      unknown_committed_cost_attempts: unknownCommittedCostAttempts,
      unknown_reserved_cost_attempts: unknownReservedCostAttempts
    };
  }
}
