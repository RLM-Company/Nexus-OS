import type { DatabaseSync } from "node:sqlite";
import type { Currency, ProjectUsageSummary, UsageCurrencyTotal } from "@cosmora/contracts";
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

export class UsageStore {
  readonly #sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.#sqlite = sqlite;
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
