import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { SqlAnalyticsQuerySpec, SqlAnalyticsQueryResult } from "./kosmora-skills-bus.js";

/** Bounded SQLite analytics over an explicit dataset. No network or production database access. */
export function queryReadOnlyDataset(spec: SqlAnalyticsQuerySpec): SqlAnalyticsQueryResult {
  if (spec.dialect !== "sqlite" || !Array.isArray(spec.rows_dataset))
    throw new Error("SQL_ADAPTER_REQUIRED: provide a SQLite rows_dataset");
  if (!Number.isSafeInteger(spec.max_rows) || spec.max_rows < 1 || spec.max_rows > 2000)
    throw new Error("SQL_RESULT_LIMIT_INVALID");
  if (spec.rows_dataset.length > 2000 || JSON.stringify(spec.rows_dataset).length > 2_000_000)
    throw new Error("SQL_DATASET_TOO_LARGE");
  const sql = spec.sql.trim().replace(/;$/, "");
  const tokens = sql.replace(/'(?:''|[^'])*'/g, "''");
  if (
    sql.length > 8000 ||
    !/^SELECT\b/i.test(tokens) ||
    /;|--|\/\*|\*\//.test(tokens) ||
    (tokens.match(/\bSELECT\b/gi)?.length ?? 0) !== 1 ||
    /\b(?:JOIN|WITH|UNION|INTERSECT|EXCEPT|RECURSIVE|PRAGMA|ATTACH|DETACH|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|VACUUM|sqlite_\w*)\b/i.test(
      tokens
    ) ||
    /\bFROM\s+(?!items\b)/i.test(tokens) ||
    /\bFROM\s+items\s*(?:AS\s+\w+)?\s*,/i.test(tokens)
  )
    throw new Error("SQL_READ_ONLY_SUBSET_REQUIRED");
  const functions = new Set([
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "abs",
    "round",
    "lower",
    "upper",
    "length",
    "coalesce",
    "nullif",
    "ifnull",
    "in"
  ]);
  for (const match of tokens.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi))
    if (!functions.has(match[1]!.toLowerCase())) throw new Error("SQL_FUNCTION_NOT_ALLOWED");
  const columns = [...new Set(spec.rows_dataset.flatMap((row) => Object.keys(row)))];
  if (columns.length > 64 || columns.some((c) => !c || c.length > 128))
    throw new Error("SQL_COLUMNS_INVALID");
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const start = Date.now(),
    db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE items (${(columns.length ? columns : ["_empty"]).map(quote).join(",")})`);
    if (columns.length) {
      const insert = db.prepare(`INSERT INTO items VALUES (${columns.map(() => "?").join(",")})`);
      for (const row of spec.rows_dataset)
        insert.run(
          ...columns.map((column) => {
            const value = row[column];
            if (value == null) return null;
            if (typeof value === "boolean") return Number(value);
            if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value)))
              return value;
            throw new Error("SQL_CELL_TYPE_UNSUPPORTED");
          })
        );
    }
    db.exec("PRAGMA query_only=ON");
    const statement = db.prepare(sql);
    const rows: Array<Record<string, unknown>> = [];
    let truncated = false;
    for (const row of statement.iterate()) {
      if (rows.length === spec.max_rows) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
    return {
      query_id: randomUUID(),
      columns: statement.columns().map((c) => c.name),
      rows,
      row_count: rows.length,
      truncated,
      execution_ms: Date.now() - start,
      explain_plan_summary: plan.map((row) => String(row.detail)).join("; ")
    };
  } finally {
    db.close();
  }
}
