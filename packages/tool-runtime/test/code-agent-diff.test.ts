import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCodeAgentUnifiedDiff,
  inspectCodeAgentUnifiedDiff,
  renderCodeAgentUnifiedDiff
} from "../src/code-agent-diff.js";
import { computeCodeAgentSnapshotDigest } from "../src/code-agent-workspace.js";
const sha = "a".repeat(40);
const GIT_INTEGRATION_TIMEOUT_MS = 30_000;
const snapshot = [
  { path: "src/sum.js", content: "// math\nexport const sum = (a,b) => a-b;\n// end\n" }
];
const diff =
  "diff --git a/src/sum.js b/src/sum.js\n--- a/src/sum.js\n+++ b/src/sum.js\n@@ -1,99 +1,1 @@ math\n // math\n-export const sum = (a,b) => a-b;\n+export const sum = (a,b) => a+b;\n // end\n";
const apply = (value = diff, files = snapshot) =>
  applyCodeAgentUnifiedDiff({
    diff: value,
    snapshot: files,
    baseSha: sha,
    expectedBaseSha: sha,
    expectedSnapshotDigest: computeCodeAgentSnapshotDigest(files)
  });
async function gitRoundTrip(
  files: Array<{ path: string; before: string | null; content: string }>,
  patch: string
) {
  const directory = await mkdtemp(join(tmpdir(), "kosmora-diff-git-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: directory });
    // This fixture compares exact snapshot bytes, independently of the user's Git EOL policy.
    execFileSync("git", ["config", "--local", "core.autocrlf", "false"], { cwd: directory });
    for (const f of files)
      if (f.before !== null) {
        await mkdir(dirname(join(directory, f.path)), { recursive: true });
        await writeFile(join(directory, f.path), f.before);
      }
    await writeFile(join(directory, "input.patch"), patch);
    execFileSync("git", ["apply", "--check", "input.patch"], { cwd: directory });
    execFileSync("git", ["apply", "input.patch"], { cwd: directory });
    for (const f of files) expect(await readFile(join(directory, f.path), "utf8")).toBe(f.content);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("bounded exact unified diff application", () => {
  it(
    "corrects only hunk counts, preserves all other bytes and passes actual git apply",
    async () => {
      const result = apply();
      expect(result.normalizedDiff).toBe(diff.replace("-1,99 +1,1", "-1,3 +1,3"));
      expect(result.normalizations).toEqual([
        {
          path: "src/sum.js",
          line: 4,
          before: "@@ -1,99 +1,1 @@ math",
          after: "@@ -1,3 +1,3 @@ math"
        }
      ]);
      expect(result.files[0]!.content).toContain("a+b");
      await gitRoundTrip(result.files, result.normalizedDiff);
    },
    GIT_INTEGRATION_TIMEOUT_MS
  );
  it("never repairs start positions, context, paths or indexes", () => {
    expect(() => apply(diff.replace("-1,99", "-2,99"))).toThrow("PATCH_POSITION");
    expect(() => apply(diff.replace("// math", "// other"))).toThrow("PATCH_CONTEXT");
    expect(() => apply(diff.replace("b/src/sum.js", "b/src/other.js"))).toThrow(
      "PATCH_UNSUPPORTED"
    );
    expect(() => apply(diff.replace("--- a/", "index 1234567..7654321 100644\n--- a/"))).toThrow(
      "PATCH_INDEX"
    );
  });
  it("binds base SHA and entire snapshot, including unchanged support files", () => {
    expect(() =>
      applyCodeAgentUnifiedDiff({
        diff,
        snapshot,
        baseSha: sha,
        expectedBaseSha: "b".repeat(40),
        expectedSnapshotDigest: computeCodeAgentSnapshotDigest(snapshot)
      })
    ).toThrow("PATCH_BASE");
    expect(() =>
      applyCodeAgentUnifiedDiff({
        diff,
        snapshot: [...snapshot, { path: "support.js", content: "other" }],
        baseSha: sha,
        expectedBaseSha: sha,
        expectedSnapshotDigest: computeCodeAgentSnapshotDigest(snapshot)
      })
    ).toThrow("PATCH_SNAPSHOT");
  });
  it.each([
    "../outside.js",
    "/etc/passwd",
    "a/../../file",
    "C:/file",
    "a\\file",
    ".github/workflow.yml",
    ".env",
    "foo//bar",
    "a/./b",
    ".git/config",
    "credentials.json"
  ])("rejects unsafe path %s", (path) => {
    expect(() =>
      inspectCodeAgentUnifiedDiff(
        `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-x\n+y\n`
      )
    ).toThrow("PATCH_PATH");
  });
  it("rejects renamed/deleted files, mode changes, binary patches and malformed/truncated input", () => {
    expect(() => apply(diff.replace("+++ b/src/sum.js", "+++ /dev/null"))).toThrow(
      "PATCH_UNSUPPORTED"
    );
    expect(() =>
      apply(diff.replace("--- a/src", "old mode 100644\nnew mode 100755\n--- a/src"))
    ).toThrow("PATCH_UNSUPPORTED");
    expect(() => apply("GIT binary patch\n")).toThrow("PATCH_FORMAT");
    expect(() => apply(diff.slice(0, -1))).toThrow("PATCH_TRUNCATED");
    expect(() => apply(diff.replace(" // end", "// end"))).toThrow("PATCH_FORMAT");
    expect(() => apply(diff + diff)).toThrow("PATCH_AMBIGUOUS");
  });
  it("rejects ambiguous repeated preimages even if the guessed line number matches", () => {
    const files = [{ path: "src/sum.js", content: "one\nx\ntwo\none\nx\ntwo\n" }];
    expect(() =>
      apply("--- a/src/sum.js\n+++ b/src/sum.js\n@@ -1,3 +1,3 @@\n one\n-x\n+y\n two\n", files)
    ).toThrow("PATCH_AMBIGUOUS");
  });
  it("refuses deleting unrelated text or guessing whitespace/fuzzy positions", () => {
    expect(() => apply(diff.replace("a-b", "a - b"))).toThrow("PATCH_CONTEXT");
    expect(() => apply(diff.replace(" // math", "-// someone else's text"))).toThrow(
      "PATCH_CONTEXT"
    );
  });
  it(
    "handles multiple disjoint hunks but rejects overlapping or inconsistent new offsets",
    async () => {
      const files = [{ path: "src/sum.js", content: "a\nb\nc\nd\ne\nf\ng\nh\n" }];
      const patch =
        "--- a/src/sum.js\n+++ b/src/sum.js\n@@ -1,9 +1,9 @@\n a\n-b\n+B\n c\n@@ -6,9 +6,9 @@\n f\n-g\n+G\n h\n";
      const result = apply(patch, files);
      await gitRoundTrip(result.files, result.normalizedDiff);
      expect(() => apply(patch.replace("+6,9", "+7,9"), files)).toThrow("PATCH_POSITION");
      expect(() => apply(patch.replace("-6,9", "-3,9"), files)).toThrow("PATCH_POSITION");
    },
    GIT_INTEGRATION_TIMEOUT_MS
  );
  it(
    "reads body lines that look like file headers as data instead of guessing file boundaries",
    async () => {
      const before = "-- a/some.js\ncontext\n",
        content = "++ b/some.js\ncontext\n";
      const patch = renderCodeAgentUnifiedDiff([{ path: "src/sum.js", before, content }]);
      const result = apply(patch, [{ path: "src/sum.js", content: before }]);
      await gitRoundTrip(result.files, result.normalizedDiff);
    },
    GIT_INTEGRATION_TIMEOUT_MS
  );
  it(
    "preserves UTF8, CRLF, quoted paths, EOF markers and pure insertions/removals",
    async () => {
      const changes = [
        {
          path: "папка/имя файл.js",
          before: "первый\r\nстарый\r\nпоследний",
          content: "первый\r\nновый\r\nпоследний"
        },
        { path: "empty.js", before: "", content: "new\n" },
        { path: "remove.js", before: "remove\n", content: "" },
        { path: "insert.js", before: "first\nlast\n", content: "first\nadded\nlast\n" }
      ];
      const patch = renderCodeAgentUnifiedDiff(changes);
      const files = changes.map((f) => ({ path: f.path, content: f.before }));
      const result = apply(patch, files);
      expect(result.files).toEqual(changes);
      await gitRoundTrip(changes, patch);
    },
    GIT_INTEGRATION_TIMEOUT_MS
  );
  it(
    "supports an explicitly new file only if absent from the immutable repository tree",
    async () => {
      const patch = renderCodeAgentUnifiedDiff([
        { path: "new.js", before: null, content: "new\n" }
      ]);
      const result = applyCodeAgentUnifiedDiff({
        diff: patch,
        snapshot,
        baseSha: sha,
        expectedBaseSha: sha,
        expectedSnapshotDigest: computeCodeAgentSnapshotDigest(snapshot),
        existingPaths: snapshot.map((f) => f.path)
      });
      await gitRoundTrip(result.files, patch);
      expect(() =>
        applyCodeAgentUnifiedDiff({
          diff: patch,
          snapshot,
          baseSha: sha,
          expectedBaseSha: sha,
          expectedSnapshotDigest: computeCodeAgentSnapshotDigest(snapshot),
          existingPaths: ["new.js"]
        })
      ).toThrow("PATCH_FILE_NOT_READ");
      expect(() => apply(diff, [{ path: "other.js", content: "a" }])).toThrow(
        "PATCH_FILE_NOT_READ"
      );
    },
    GIT_INTEGRATION_TIMEOUT_MS
  );
  it("enforces quotas before any unbounded split/search", () => {
    expect(() => apply("x".repeat(200001))).toThrow("PATCH_LIMIT");
    expect(() => apply(diff.repeat(9))).toThrow("PATCH_AMBIGUOUS");
    expect(() =>
      renderCodeAgentUnifiedDiff(
        Array.from({ length: 9 }, (_, i) => ({ path: `${i}.js`, before: "a", content: "b" }))
      )
    ).toThrow("PATCH_LIMIT");
  });
  it("rejects file/directory shadows and aliases with an explicit path refusal", () => {
    const patches = renderCodeAgentUnifiedDiff([
      { path: "folder", before: null, content: "one\n" },
      { path: "Folder/child.js", before: null, content: "two\n" }
    ]);
    expect(() => inspectCodeAgentUnifiedDiff(patches)).toThrow("PATCH_PATH");
    const added = renderCodeAgentUnifiedDiff([
      { path: "Folder/child.js", before: null, content: "new\n" }
    ]);
    expect(() =>
      applyCodeAgentUnifiedDiff({
        diff: added,
        snapshot,
        baseSha: sha,
        expectedBaseSha: sha,
        expectedSnapshotDigest: computeCodeAgentSnapshotDigest(snapshot),
        existingPaths: ["folder"]
      })
    ).toThrow("PATCH_PATH");
    expect(() => apply(added)).toThrow("PATCH_FILE_NOT_READ");
  });
  it(
    "renders a minimal bounded edit and proves unchanged distant lines remain byte-identical",
    async () => {
      const before = Array.from({ length: 200 }, (_, i) => `line ${i}\n`).join("");
      const content = before.replace("line 100\n", "fixed\n");
      const patch = renderCodeAgentUnifiedDiff([{ path: "src/sum.js", before, content }]);
      expect(patch).toContain("@@ -98,7 +98,7 @@");
      expect(patch.length).toBeLessThan(300);
      await gitRoundTrip(apply(patch, [{ path: "src/sum.js", content: before }]).files, patch);
    },
    GIT_INTEGRATION_TIMEOUT_MS
  );
});
