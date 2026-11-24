import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const scripts = {
  buildRelease: join(root, "scripts/build-release.mjs"),
  rehearse: join(root, "scripts/rehearse-release.mjs")
};
const node = process.execPath;

test("release artifact is reproducible from an exact SHA and extracts cleanly", (t) => {
  // Only run when the tree is clean (the script refuses dirty trees by design).
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8"
  }).trim();
  if (dirty) return t.skip("requires a clean checkout");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const first = mkdtempSync(join(tmpdir(), "kosmora-release-a-"));
  const second = mkdtempSync(join(tmpdir(), "kosmora-release-b-"));
  t.after(() => {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  });
  const build = (out) => {
    execFileSync(node, [scripts.buildRelease, sha, out, "test"], {
      cwd: root,
      stdio: "pipe",
      timeout: 120_000
    });
    return join(out, "kosmora-linux-x64-test");
  };
  const a = build(first);
  const b = build(second);
  const hashA = createHash("sha256")
    .update(readFileSync(join(a, "source.tar.gz")))
    .digest("hex");
  const hashB = createHash("sha256")
    .update(readFileSync(join(b, "source.tar.gz")))
    .digest("hex");
  assert.equal(hashA, hashB, "archive must be byte-identical across builds");
  const manifest = JSON.parse(readFileSync(join(a, "manifest.json"), "utf8"));
  assert.equal(manifest.commit, sha);
  assert.equal(manifest.archive.sha256, hashA);
  assert.equal(manifest.production_deployed, false);
  assert.ok(manifest.migrations.length > 0);
});

test("exact-SHA guard refuses a different commit", (t) => {
  const out = mkdtempSync(join(tmpdir(), "kosmora-release-badsha-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.throws(
    () =>
      execFileSync(node, [scripts.buildRelease, "0".repeat(40), out, "test"], {
        cwd: root,
        stdio: "pipe"
      }),
    /exact 40-hex|commit/i
  );
});

test("rehearsal failure drills report stage, reason and restore command", (t) => {
  if (!existsSync(join(root, "apps/api/dist/server.js"))) {
    return t.skip("requires built API dist");
  }
  const out = mkdtempSync(join(tmpdir(), "kosmora-drill-test-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const drills = [
    { name: "prepare", args: [scripts.rehearse, "--low-disk", "--report-dir"] },
    { name: "migrate", args: [scripts.rehearse, "--fail-at", "migrate", "--report-dir"] }
  ];
  for (const drill of drills) {
    const dir = join(out, drill.name);
    assert.throws(() =>
      execFileSync(node, [...drill.args, dir], { cwd: root, stdio: "pipe", timeout: 30_000 })
    );
    const report = JSON.parse(readFileSync(join(dir, "rehearsal.json"), "utf8"));
    assert.equal(report.status, "failed");
    assert.equal(report.failed_stage, drill.name);
    assert.ok(report.reason);
    assert.match(report.restore_command, /--rollback/);
  }
});
