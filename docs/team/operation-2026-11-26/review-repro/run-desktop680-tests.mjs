import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
const repo = process.argv[2],
  folder = mkdtempSync(join(tmpdir(), "kosmora-desktop680-review-"));
for (const file of [
  "browser/tab-ownership.cjs",
  "computer-recovery-events.cjs",
  "test/browser-tab-ownership.test.cjs",
  "test/computer-recovery-events.test.cjs"
]) {
  const target = join(folder, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    execFileSync("git", ["show", "origin/review-680:desktop/windows/" + file], { cwd: repo })
  );
}
const r = spawnSync(
  process.execPath,
  ["--test", "test/browser-tab-ownership.test.cjs", "test/computer-recovery-events.test.cjs"],
  { cwd: folder, encoding: "utf8" }
);
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exitCode = r.status ?? 1;
