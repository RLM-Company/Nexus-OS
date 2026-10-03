import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

const fixtureKey = "sk-" + "S".repeat(32);
const temporaryRoot = realpathSync(tmpdir());
function repository(run) {
  const directory = mkdtempSync(join(temporaryRoot, "cosmora-secret-scan-"));
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  try {
    git("init", "--quiet");
    mkdirSync(join(directory, "scripts"));
    copyFileSync(
      new URL("../check-secrets.mjs", import.meta.url),
      join(directory, "scripts/check-secrets.mjs")
    );
    writeFileSync(join(directory, ".gitignore"), ".env\nprivate/\n");
    const scan = () =>
      spawnSync(process.execPath, ["scripts/check-secrets.mjs"], {
        cwd: directory,
        encoding: "utf8"
      });
    run({ directory, git, scan });
  } finally {
    const cleanupTarget = realpathSync(directory);
    assert.equal(dirname(cleanupTarget), temporaryRoot);
    assert.ok(basename(cleanupTarget).startsWith("cosmora-secret-scan-"));
    rmSync(cleanupTarget, { recursive: true, force: true });
  }
}

test("ignored runtime credentials do not become source findings", () =>
  repository(({ directory, scan }) => {
    writeFileSync(join(directory, ".env"), `MODEL_API_KEY=${fixtureKey}\n`);
    const result = scan();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Secret scan passed/);
  }));

test("new non-ignored source containing a key fails without printing the key", () =>
  repository(({ directory, scan }) => {
    writeFileSync(join(directory, "runtime.json"), JSON.stringify({ credential: fixtureKey }));
    const result = scan();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /runtime.json: OpenAI-style key/);
    assert.ok(!result.stderr.includes(fixtureKey));
  }));

test("force-adding an ignored environment file still fails", () =>
  repository(({ directory, git, scan }) => {
    writeFileSync(join(directory, ".env"), `MODEL_API_KEY=${fixtureKey}\n`);
    git("add", "-f", ".env");
    const result = scan();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /configured model credential/);
    assert.ok(!result.stderr.includes(fixtureKey));
  }));

test("a clean working copy cannot hide a credential already staged for commit", () =>
  repository(({ directory, git, scan }) => {
    writeFileSync(join(directory, "runtime.json"), JSON.stringify({ credential: fixtureKey }));
    git("add", "runtime.json");
    writeFileSync(
      join(directory, "runtime.json"),
      JSON.stringify({ credential: "replace-privately" })
    );
    const result = scan();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /runtime.json \(staged\): OpenAI-style key/);
    assert.ok(!result.stderr.includes(fixtureKey));
  }));

test("tracked source in a directory previously excluded by name is checked", () =>
  repository(({ directory, git, scan }) => {
    mkdirSync(join(directory, "data"));
    writeFileSync(join(directory, "data/config.json"), JSON.stringify({ credential: fixtureKey }));
    git("add", "data/config.json");
    assert.equal(scan().status, 1);
  }));

test("example credentials remain allowed", () =>
  repository(({ directory, scan }) => {
    writeFileSync(
      join(directory, ".env.example"),
      "MODEL_API_KEY=replace-privately-never-commit\n"
    );
    assert.equal(scan().status, 0);
  }));
