import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32" || !process.argv.includes("--run")) {
  console.error(
    "Explicit Windows test: node scripts/run-computer-control-live.mjs --run --electron <pinned electron.exe>. Opens only a disposable input fixture; no installer or paid AI."
  );
  process.exit(2);
}
const electronArgument = process.argv.indexOf("--electron");
const executable = electronArgument >= 0 ? process.argv[electronArgument + 1] : undefined;
if (!executable || !isAbsolute(executable) || !existsSync(executable))
  throw Error("Pinned Electron executable required");
const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const folder = mkdtempSync(join(tmpdir(), "koswork-computer-live-"));
const output = join(folder, "result.json");
const fixtureName = process.argv.includes("--browser")
  ? "computer-browser-live.cjs"
  : process.argv.includes("--document")
    ? "computer-document-live.cjs"
    : "computer-control-live.cjs";
const child = spawn(
  executable,
  ["--no-error-dialogs", join(repo, "desktop/windows/ci", fixtureName)],
  {
    cwd: repo,
    windowsHide: true,
    shell: false,
    env: { ...process.env, KOSWORK_COMPUTER_LIVE_TEST: "1", KOSWORK_COMPUTER_LIVE_OUTPUT: output },
    stdio: ["ignore", "ignore", "pipe"]
  }
);
let diagnostic = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  diagnostic = (diagnostic + chunk).slice(-12000);
});
const timeout = setTimeout(() => child.kill(), 70000);
const exit = await new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("close", (code) => resolveExit(code));
}).finally(() => clearTimeout(timeout));
if (!existsSync(output)) {
  console.error(diagnostic);
  throw Error("Computer fixture did not produce a result");
}
const result = JSON.parse(readFileSync(output, "utf8"));
console.log(JSON.stringify({ ...result, output }, null, 2));
process.exitCode = result.passed === true && exit === 0 ? 0 : 1;
