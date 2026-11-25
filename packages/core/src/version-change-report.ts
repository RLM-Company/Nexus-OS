import { createHash } from "node:crypto";
import { parseDataWorkspace } from "@cosmora/contracts/data-workspace";
import { compareTables, TableComparisonError, type TableAlignment } from "./table-comparison.js";

/** 1-based column numbers, matching compareTables' TableAlignment. */
export type VersionKey = { before_columns: number[]; after_columns: number[] };
export type VersionSource = {
  label: string;
  source: string;
  /** Optional explicit metadata; inferred from the workspace when absent. */
  period?: string;
  units?: string;
  method?: string;
};
export type VersionChangeInput = {
  before: VersionSource;
  after: VersionSource;
  key: VersionKey;
  previous_report?: string;
};
export type DuplicateKey = {
  side: "before" | "after";
  key: string;
  rows: number[];
};
export type UncomparableRow = {
  side: "before" | "after";
  row: number;
  reason: "empty_key" | "duplicate_key" | "no_pair" | "invalid_source";
  detail: string;
};
export type DefinitionChange = {
  field: "period" | "units" | "method" | "schema";
  before: string | null;
  after: string | null;
  detail?: string;
};
export class VersionReportError extends Error {
  constructor(
    readonly code: "VERSION_REPORT_INVALID" | "VERSION_REPORT_TOO_LARGE",
    readonly detail?: string
  ) {
    super(code);
  }
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const MAX_REPORT_BYTES = 1_000_000;

function metaFromWorkspace(source: string): {
  period: string | null;
  units: string | null;
  method: string | null;
} {
  const ws = parseDataWorkspace(source);
  // A data workspace has no dedicated metadata fields. Derive honest hints:
  // column names/types are schema, not a claim about period/units/method.
  const fields = new Set(ws.table.headers.map((h) => h.toLowerCase()));
  const period =
    [...fields].find((h) => /period|период|month|месяц|quarter|квартал|year|год/.test(h)) ?? null;
  const units = [...fields].find((h) => /unit|ед\.изм|units|валюта|currency/.test(h)) ?? null;
  const method = [...fields].find((h) => /method|метод|методика/.test(h)) ?? null;
  return { period, units, method };
}

function keyOf(values: string[]): string {
  return JSON.stringify(values);
}

function collectDuplicates(
  source: string,
  side: "before" | "after",
  columns: number[]
): { duplicates: DuplicateKey[]; uncomparable: UncomparableRow[] } {
  const ws = parseDataWorkspace(source);
  const width = ws.table.headers.length;
  if (columns.some((c) => !Number.isInteger(c) || c < 1 || c > width))
    throw new VersionReportError("VERSION_REPORT_INVALID", `${side}: key column out of range`);
  const seen = new Map<string, number[]>();
  const duplicates: DuplicateKey[] = [];
  const uncomparable: UncomparableRow[] = [];
  for (let row = 0; row < ws.table.rows.length; row++) {
    const values = columns.map((c) => ws.table.rows[row]![c - 1]!);
    if (values.some((v) => !v.trim())) {
      uncomparable.push({
        side,
        row: row + 1,
        reason: "empty_key",
        detail: "Пустой ключ сопоставления"
      });
      continue;
    }
    const key = keyOf(values);
    const rows = seen.get(key);
    if (rows) {
      rows.push(row + 1);
      // Record once when the group becomes a duplicate.
      if (rows.length === 2) duplicates.push({ side, key, rows: [...rows] });
      else duplicates.find((d) => d.side === side && d.key === key)!.rows.push(row + 1);
      uncomparable.push({ side, row: row + 1, reason: "duplicate_key", detail: `Ключ ${key}` });
    } else seen.set(key, [row + 1]);
  }
  return { duplicates, uncomparable };
}

/** Remove rows that cannot be matched, keeping the first occurrence of each key. */
function comparableSource(source: string, columns: number[]): string {
  const ws = parseDataWorkspace(source);
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const row of ws.table.rows) {
    const values = columns.map((c) => row[c - 1]!);
    if (values.some((v) => !v.trim())) continue;
    const key = keyOf(values);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([...row]);
  }
  return JSON.stringify({ ...ws, table: { ...ws.table, rows } });
}

function definitionChanges(
  before: VersionSource,
  after: VersionSource,
  beforeMeta: ReturnType<typeof metaFromWorkspace>,
  afterMeta: ReturnType<typeof metaFromWorkspace>,
  schemaChanges: Array<{ column: number; before: unknown; after: unknown }>
): DefinitionChange[] {
  const changes: DefinitionChange[] = [];
  for (const field of ["period", "units", "method"] as const) {
    const b = before[field] ?? beforeMeta[field];
    const a = after[field] ?? afterMeta[field];
    if (b !== a) changes.push({ field, before: b, after: a });
  }
  for (const change of schemaChanges)
    changes.push({
      field: "schema",
      before: JSON.stringify(change.before),
      after: JSON.stringify(change.after),
      detail: `column ${change.column}`
    });
  return changes;
}

function affectedConclusions(previous: string | undefined): string[] {
  if (!previous) return [];
  return previous
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]/.test(line) && /\[S\d+\]|row|строка|record|запись/i.test(line))
    .map((line) => line.trim())
    .slice(0, 40);
}

function link(side: "before" | "after", row: number | null): string {
  return row === null ? "—" : `${side} row ${row}`;
}

export function buildVersionChangeReport(input: VersionChangeInput) {
  const { before, after, key, previous_report } = input;
  if (
    !before ||
    !after ||
    typeof before.source !== "string" ||
    typeof after.source !== "string" ||
    !key ||
    key.before_columns.length !== key.after_columns.length
  )
    throw new VersionReportError("VERSION_REPORT_INVALID");

  let beforeParsed, afterParsed;
  try {
    beforeParsed = parseDataWorkspace(before.source);
    afterParsed = parseDataWorkspace(after.source);
  } catch (error) {
    throw new VersionReportError("VERSION_REPORT_INVALID", String((error as Error)?.message));
  }
  const beforeDup = collectDuplicates(before.source, "before", key.before_columns);
  const afterDup = collectDuplicates(after.source, "after", key.after_columns);
  const duplicates: DuplicateKey[] = [...beforeDup.duplicates, ...afterDup.duplicates];
  const uncomparable: UncomparableRow[] = [...beforeDup.uncomparable, ...afterDup.uncomparable];
  const beforeMeta = metaFromWorkspace(before.source);
  const afterMeta = metaFromWorkspace(after.source);

  const alignment: TableAlignment = {
    kind: "key",
    before_columns: key.before_columns,
    after_columns: key.after_columns
  };
  let comparison;
  try {
    comparison = compareTables(
      comparableSource(before.source, key.before_columns),
      comparableSource(after.source, key.after_columns),
      { alignment, include_values: true, limit: 200 }
    );
  } catch (error) {
    if (error instanceof TableComparisonError)
      throw new VersionReportError("VERSION_REPORT_INVALID", error.code);
    throw error;
  }
  const definitions = definitionChanges(
    before,
    after,
    beforeMeta,
    afterMeta,
    comparison.schema_changes
  );
  const conclusions = affectedConclusions(previous_report);

  const lines: string[] = [
    "# Отчёт «Что изменилось»",
    "",
    `Формат: kosmora.version-change-report.v1. Ключ: before ${key.before_columns.join(",")} → after ${key.after_columns.join(",")}.`,
    "",
    "## Источники",
    "",
    `- **${before.label}**: ${beforeParsed.table.rows.length} строк, ${beforeParsed.table.headers.length} колонок, SHA256 \`${sha(before.source)}\``,
    `- **${after.label}**: ${afterParsed.table.rows.length} строк, ${afterParsed.table.headers.length} колонок, SHA256 \`${sha(after.source)}\``,
    "",
    "## Определения и методика",
    "",
    definitions.length
      ? "**Внимание:** определения periods/units/method или схема изменились — числовые сравнения могут быть некорректными."
      : "Период, единицы и методика совпадают; схема без изменений.",
    ...definitions.map(
      (d) =>
        `- ${d.field}: \`${d.before ?? "—"}\` → \`${d.after ?? "—"}\`${d.detail ? ` (${d.detail})` : ""}`
    ),
    "",
    "## Изменения строк",
    "",
    `Добавлено: ${comparison.summary.added_rows}, удалено: ${comparison.summary.removed_rows}, изменено: ${comparison.summary.changed_rows}, без изменений: ${comparison.summary.unchanged_rows}.`,
    ""
  ];
  for (const change of comparison.changes) {
    const marker =
      change.kind === "added" ? "ADDED" : change.kind === "removed" ? "REMOVED" : "CHANGED";
    lines.push(
      `### ${marker} — ${link("before", change.before_row)} → ${link("after", change.after_row)}`
    );
    if (change.changed_columns.length)
      lines.push(`Изменённые колонки: ${change.changed_columns.join(", ")}.`);
    if (change.before) lines.push(`- Прежде: \`${JSON.stringify(change.before)}\``);
    if (change.after) lines.push(`- Стало: \`${JSON.stringify(change.after)}\``);
    lines.push("");
  }
  lines.push("## Дубли ключей", "");
  if (duplicates.length)
    for (const d of duplicates)
      lines.push(`- ${d.side}: ключ \`${d.key}\` в строках ${d.rows.join(", ")}`);
  else lines.push("Нет.");
  lines.push("", "## Несопоставимые строки", "");
  if (uncomparable.length)
    for (const u of uncomparable) lines.push(`- ${u.side} row ${u.row}: ${u.reason} — ${u.detail}`);
  else lines.push("Нет.");
  lines.push("", "## Затронутые выводы из предыдущего отчёта", "");
  lines.push(
    ...(conclusions.length
      ? conclusions
      : ["Предыдущий отчёт не передан или не содержит ссылок на записи."])
  );
  lines.push("");

  const markdown = lines.join("\n");
  if (Buffer.byteLength(markdown, "utf8") > MAX_REPORT_BYTES)
    throw new VersionReportError("VERSION_REPORT_TOO_LARGE");
  return {
    format: "kosmora.version-change-report.v1" as const,
    markdown,
    duplicate_keys: duplicates,
    uncomparable,
    definition_changes: definitions,
    affected_conclusions: conclusions,
    summary: comparison.summary,
    source: {
      before: { label: before.label, sha256: sha(before.source) },
      after: { label: after.label, sha256: sha(after.source) }
    },
    truncated: !comparison.detail.all_changes_included
  };
}
