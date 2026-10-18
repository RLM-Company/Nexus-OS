import { describe, expect, it } from "vitest";
import { diffRows } from "./inline-diff-model";

describe("unified diff presentation", () => {
  it("uses exact hunk positions across context, deleted and inserted lines", () => {
    const rows = diffRows("--- a/a.ts\n+++ b/a.ts\n@@ -8,3 +20,3 @@\n same\n-old\n+new\n tail\n");
    expect(rows.slice(3)).toEqual([
      { text: " same", kind: "context", before: 8, after: 20 },
      { text: "-old", kind: "removed", before: 9 },
      { text: "+new", kind: "added", after: 21 },
      { text: " tail", kind: "context", before: 10, after: 22 }
    ]);
  });
  it("handles zero-count new files and newline markers without inventing old positions", () => {
    const rows = diffRows("@@ -0,0 +1,2 @@\n+one\n\\ No newline at end of file\n+two\n");
    expect(rows.filter((row) => row.kind === "added")).toEqual([
      { text: "+one", kind: "added", after: 1 },
      { text: "+two", kind: "added", after: 2 }
    ]);
  });
  it("resets at file headers and treats incomplete or malformed patches as plain metadata", () => {
    const rows = diffRows(
      "@@ -1 +1 @@\n-a\n+b\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n+unframed\n@@ -9 +12 @@\n-x\n+y"
    );
    expect(rows.find((row) => row.text === "+++ b/x")).toEqual({ text: "+++ b/x", kind: "meta" });
    expect(rows.find((row) => row.text === "+unframed")?.kind).toBe("meta");
    expect(rows.at(-1)).toEqual({ text: "+y", kind: "added", after: 12 });
  });
  it("preserves header-shaped source lines inside a hunk", () => {
    const rows = diffRows("@@ -1 +1 @@\n---actual old\n+++actual new\n");
    expect(rows[1]).toEqual({ text: "---actual old", kind: "removed", before: 1 });
    expect(rows[2]).toEqual({ text: "+++actual new", kind: "added", after: 1 });
  });
});
