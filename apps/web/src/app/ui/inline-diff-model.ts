export type DiffRow = {
  text: string;
  kind: "context" | "added" | "removed" | "meta" | "hunk";
  before?: number;
  after?: number;
};

/** Read-only presentation of unified diff. It never applies, normalizes or repairs a patch. */
export function diffRows(text: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let before: number | undefined;
  let after: number | undefined;
  let oldRemaining = 0,
    newRemaining = 0;
  for (const line of text.replace(/\n$/, "").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (
      hunk &&
      [hunk[1], hunk[2] ?? 1, hunk[3], hunk[4] ?? 1].every((value) =>
        Number.isSafeInteger(Number(value))
      )
    ) {
      before = Number(hunk[1]);
      after = Number(hunk[3]);
      oldRemaining = Number(hunk[2] ?? 1);
      newRemaining = Number(hunk[4] ?? 1);
      rows.push({ text: line, kind: "hunk" });
    } else if (
      before !== undefined &&
      after !== undefined &&
      (oldRemaining > 0 || newRemaining > 0) &&
      line[0] === "+" &&
      newRemaining > 0
    ) {
      rows.push({ text: line, kind: "added", after: after++ });
      newRemaining--;
    } else if (
      before !== undefined &&
      after !== undefined &&
      (oldRemaining > 0 || newRemaining > 0) &&
      line[0] === "-" &&
      oldRemaining > 0
    ) {
      rows.push({ text: line, kind: "removed", before: before++ });
      oldRemaining--;
    } else if (
      before !== undefined &&
      after !== undefined &&
      line[0] === " " &&
      oldRemaining > 0 &&
      newRemaining > 0
    ) {
      rows.push({ text: line, kind: "context", before: before++, after: after++ });
      oldRemaining--;
      newRemaining--;
    } else {
      rows.push({ text: line, kind: "meta" });
      // A newline marker does not consume hunk lines. Other headers reset counters.
      if (!line.startsWith("\\")) {
        before = undefined;
        after = undefined;
        oldRemaining = 0;
        newRemaining = 0;
      }
    }
  }
  return rows;
}
