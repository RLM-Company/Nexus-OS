import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = resolve(root, "scripts/vps-live-acceptance.mjs");

test("VPS live acceptance wrapper fails closed without the owner password", () => {
  const env = { ...process.env };
  delete env.KOSMORA_OWNER_PASSWORD;
  const run = spawnSync(process.execPath, [script], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 10_000
  });
  const status = run.status;
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  assert.equal(status, 2);
  assert.match(output, /KOSMORA_OWNER_PASSWORD is not set/);
  assert.doesNotMatch(output, /Owner access PASS/);
});
