/** Literal, bounded line comparison. Never normalizes whitespace or line endings. */
export type CanvasDiffRow = {
  kind: "equal" | "remove" | "add";
  text: string;
  before: number | null;
  after: number | null;
};
export type CanvasDiff =
  | { limited: true; reason: "bytes" | "lines" | "complexity" }
  | { limited: false; rows: CanvasDiffRow[]; added: number; removed: number };
const MAX_BYTES = 256 * 1024;
const MAX_LINES = 4000;
const MAX_CELLS = 500000;
const lines = (text: string): string[] => text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];

export function compareCanvasText(before: string, after: string): CanvasDiff {
  if (before === after) return { limited: false, rows: [], added: 0, removed: 0 };
  if (new TextEncoder().encode(before).length + new TextEncoder().encode(after).length > MAX_BYTES)
    return { limited: true, reason: "bytes" };
  const a = lines(before),
    b = lines(after);
  if (a.length + b.length > MAX_LINES) return { limited: true, reason: "lines" };
  let prefix = 0,
    suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const n = a.length - prefix - suffix,
    m = b.length - prefix - suffix;
  if ((n + 1) * (m + 1) > MAX_CELLS) return { limited: true, reason: "complexity" };
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i * width + j] =
        a[prefix + i] === b[prefix + j]
          ? 1 + table[(i + 1) * width + j + 1]!
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  const rows: CanvasDiffRow[] = [];
  let i = 0,
    j = 0,
    added = 0,
    removed = 0;
  const equal = () => {
    rows.push({ kind: "equal", text: a[i]!, before: i + 1, after: j + 1 });
    i++;
    j++;
  };
  while (i < prefix) equal();
  while (i < a.length - suffix || j < b.length - suffix) {
    if (i < a.length - suffix && j < b.length - suffix && a[i] === b[j]) equal();
    else if (
      i < a.length - suffix &&
      (j === b.length - suffix ||
        table[(i - prefix + 1) * width + j - prefix]! >=
          table[(i - prefix) * width + j - prefix + 1]!)
    ) {
      rows.push({ kind: "remove", text: a[i]!, before: ++i, after: null });
      removed++;
    } else {
      rows.push({ kind: "add", text: b[j]!, before: null, after: ++j });
      added++;
    }
  }
  while (i < a.length) equal();
  return { limited: false, rows, added, removed };
}

export type CanvasDiffDisplayRow = CanvasDiffRow | { kind: "fold"; count: number };
/** Retain two context lines around each edit, with explicit omitted-line markers. */
export function compactCanvasDiff(rows: CanvasDiffRow[]): CanvasDiffDisplayRow[] {
  const output: CanvasDiffDisplayRow[] = [];
  for (let start = 0; start < rows.length;) {
    if (rows[start]!.kind !== "equal") {
      output.push(rows[start++]!);
      continue;
    }
    let end = start;
    while (end < rows.length && rows[end]!.kind === "equal") end++;
    const head = start > 0 ? Math.min(2, end - start) : 0;
    const tail = end < rows.length ? Math.min(2, end - start - head) : 0;
    output.push(...rows.slice(start, start + head));
    if (end - start - head - tail > 0)
      output.push({ kind: "fold", count: end - start - head - tail });
    output.push(...rows.slice(end - tail, end));
    start = end;
  }
  return output;
}
