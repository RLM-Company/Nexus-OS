import type { DatabaseSync } from "node:sqlite";
import type { AccountFinanceSummary, Currency } from "@cosmora/contracts";

type Row = {
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  reserved_tokens: number;
  cost_amount: number | null;
  estimated_cost: number | null;
  currency: string | null;
};
const counter = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const amount = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const currency = (s: unknown): s is Currency => s === "USD" || s === "RUB";
const invalidRow = (row: Row): boolean =>
  (row.input_tokens !== null && !counter(row.input_tokens)) ||
  (row.output_tokens !== null && !counter(row.output_tokens)) ||
  !counter(row.reserved_tokens) ||
  (row.cost_amount !== null && !amount(row.cost_amount)) ||
  (row.estimated_cost !== null && !amount(row.estimated_cost)) ||
  (row.currency !== null && !currency(row.currency)) ||
  !["reserved", "committed", "failed", "cancelled", "uncertain"].includes(row.status);
const add = (a: number, b: number): number => {
  const value = a + b;
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER)
    throw Error("FINANCE_SUMMARY_OVERFLOW");
  return value;
};

/** Read-only, owner-scoped aggregation of the complete ledgers, not the last 150 UI rows.
 * Recorded model calculations are not provider invoices or a currency conversion. */
export function accountFinanceSummary(sqlite: DatabaseSync, owner: string): AccountFinanceSummary {
  sqlite.exec("SAVEPOINT kosmora_finance_snapshot");
  try {
    const report = readFinanceSnapshot(sqlite, owner);
    sqlite.exec("RELEASE kosmora_finance_snapshot");
    return report;
  } catch (error) {
    sqlite.exec("ROLLBACK TO kosmora_finance_snapshot; RELEASE kosmora_finance_snapshot");
    throw error;
  }
}

function readFinanceSnapshot(sqlite: DatabaseSync, owner: string): AccountFinanceSummary {
  const result: AccountFinanceSummary = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    cost_basis: "recorded_calculation",
    provider_invoice_reconciled: false,
    coverage: "empty",
    attempts: { total: 0, committed: 0, unsettled: 0, cancelled_before_dispatch: 0 },
    tokens: {
      actual_input: 0,
      actual_output: 0,
      unknown_committed_attempts: 0,
      unsettled_upper_bound: 0
    },
    currencies: [],
    unknown_cost: { committed_attempts: 0, unsettled_attempts: 0 },
    holds: { reserved: 0, uncertain: 0, orphaned_attempts: 0, orphaned_upper_bound: 0 },
    invalid_records: 0
  };
  const totals = new Map<Currency, AccountFinanceSummary["currencies"][number]>();
  const rows = sqlite
    .prepare(
      `
    SELECT u.status,u.actual_input_tokens input_tokens,u.actual_output_tokens output_tokens,
      u.estimated_input_tokens+u.max_output_tokens reserved_tokens,
      u.calculated_cost_amount cost_amount,u.estimated_cost_amount estimated_cost,u.currency
    FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id WHERE c.owner_id=?
    UNION ALL SELECT u.status,u.actual_input_tokens,u.actual_output_tokens,u.estimated_input_tokens+u.max_output_tokens,
      u.calculated_cost_amount,u.estimated_cost_amount,u.currency
    FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id WHERE p.owner_id=?
    UNION ALL SELECT status,actual_input_tokens,actual_output_tokens,estimated_input_tokens+max_output_tokens,
      calculated_cost_amount,estimated_cost_amount,currency FROM kosmora_retained_accounting WHERE owner_id=?
    UNION ALL SELECT 'committed',input_tokens,output_tokens,input_tokens+output_tokens,cost_amount,NULL,currency
      FROM kosmora_auxiliary_model_usage WHERE owner_id=?
    UNION ALL SELECT status,input_tokens,output_tokens,reserved_tokens,NULL,NULL,NULL
      FROM kosmora_relay_usage WHERE owner_id=?
    UNION ALL SELECT status,input_tokens,output_tokens,reserved_tokens,NULL,NULL,NULL
      FROM kosmora_media_usage WHERE owner_id=? AND status<>'cancelled'
  `
    )
    .iterate(owner, owner, owner, owner, owner, owner);
  // iterate() bounds working memory regardless of the owner's history size.
  for (const raw of rows) {
    const row = raw as Row;
    const invalid = invalidRow(row);
    result.attempts.total++;
    const committed = row.status === "committed";
    if (committed) result.attempts.committed++;
    else result.attempts.unsettled++;
    const validUsage = counter(row.input_tokens) && counter(row.output_tokens);
    if (committed && validUsage) {
      result.tokens.actual_input = add(result.tokens.actual_input, row.input_tokens!);
      result.tokens.actual_output = add(result.tokens.actual_output, row.output_tokens!);
    } else if (committed) result.tokens.unknown_committed_attempts++;
    if (!committed || !validUsage) {
      if (counter(row.reserved_tokens))
        result.tokens.unsettled_upper_bound = add(
          result.tokens.unsettled_upper_bound,
          row.reserved_tokens
        );
    }
    const value = committed ? row.cost_amount : row.estimated_cost;
    if (invalid || (committed && !validUsage) || !amount(value) || !currency(row.currency)) {
      if (committed) result.unknown_cost.committed_attempts++;
      else result.unknown_cost.unsettled_attempts++;
    } else {
      const total = totals.get(row.currency) ?? {
        currency: row.currency,
        calculated_committed_amount: 0,
        estimated_unsettled_amount: 0,
        priced_committed_attempts: 0,
        priced_unsettled_attempts: 0
      };
      if (committed) {
        total.calculated_committed_amount = add(total.calculated_committed_amount, value);
        total.priced_committed_attempts++;
      } else {
        total.estimated_unsettled_amount = add(total.estimated_unsettled_amount, value);
        total.priced_unsettled_attempts++;
      }
      totals.set(row.currency, total);
    }
    if (invalid) result.invalid_records++;
  }
  result.attempts.cancelled_before_dispatch = Number(
    (
      sqlite
        .prepare(
          "SELECT count(*) n FROM kosmora_media_usage WHERE owner_id=? AND status='cancelled'"
        )
        .get(owner) as { n: number }
    ).n
  );
  // A hold shadowing an existing ledger row is not another paid attempt.
  for (const raw of sqlite
    .prepare(
      `SELECT h.status,h.max_tokens,
    NOT EXISTS (SELECT 1 FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id WHERE c.owner_id=h.owner_id AND u.run_id=h.run_id AND u.attempt=h.attempt)
    AND NOT EXISTS (SELECT 1 FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id WHERE p.owner_id=h.owner_id AND u.run_id=h.run_id AND u.attempt=h.attempt)
    AND NOT EXISTS (SELECT 1 FROM kosmora_auxiliary_model_usage a WHERE a.owner_id=h.owner_id AND a.run_id=h.run_id AND a.attempt=h.attempt)
    AND NOT EXISTS (SELECT 1 FROM kosmora_media_usage m WHERE m.owner_id=h.owner_id AND m.hold_id=h.id)
    AND NOT EXISTS (SELECT 1 FROM kosmora_retained_accounting r WHERE r.owner_id=h.owner_id AND r.run_id=h.run_id AND r.attempt=h.attempt)
    AS orphaned FROM kosmora_usage_holds h WHERE h.owner_id=?`
    )
    .iterate(owner)) {
    const h = raw as { status: string; max_tokens: number; orphaned: number };
    if (h.status === "reserved") result.holds.reserved++;
    else result.holds.uncertain++;
    if (h.orphaned) {
      result.holds.orphaned_attempts++;
      if (counter(h.max_tokens))
        result.holds.orphaned_upper_bound = add(result.holds.orphaned_upper_bound, h.max_tokens);
      else result.invalid_records++;
    }
  }
  result.currencies = [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  const known = result.currencies.reduce(
    (n, c) => n + c.priced_committed_attempts + c.priced_unsettled_attempts,
    0
  );
  const unknown =
    result.unknown_cost.committed_attempts +
    result.unknown_cost.unsettled_attempts +
    result.holds.orphaned_attempts;
  result.coverage =
    result.attempts.total === 0 && !result.holds.reserved && !result.holds.uncertain
      ? "empty"
      : unknown === 0 && result.invalid_records === 0
        ? "complete"
        : known > 0
          ? "partial"
          : "unknown";
  return result;
}
