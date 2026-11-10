"use strict";
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

test(
  "installer lifecycle refuses a developer machine before reading or changing files",
  { skip: process.platform !== "win32" },
  (t) => {
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      path.join(__dirname, "../ci/nsis-lifecycle.ps1"),
      "-Mode",
      "Fresh",
      "-CurrentInstaller",
      "missing-installer.exe",
      "-CurrentVersion",
      "0.9.0",
      "-WorkRoot",
      path.join(__dirname, "never-created")
    ];
    const options = {
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, GITHUB_ACTIONS: "false", RUNNER_ENVIRONMENT: "local" }
    };
    let result = spawnSync("pwsh", args, options);
    if (result.error && result.error.code === "ENOENT") {
      // Windows machines without PowerShell 7 verify the same guard refusal
      // through Windows PowerShell. -ExecutionPolicy Bypass only lets the
      // single child process load the script file; the guard inside the
      // script itself still refuses any non-hosted environment.
      result = spawnSync("powershell", ["-ExecutionPolicy", "Bypass", ...args], options);
      if (result.error && result.error.code === "ENOENT")
        return t.skip(
          "pwsh and powershell unavailable; installer lifecycle runs only on disposable hosted runners"
        );
    }
    assert.notEqual(result.status, 0);
    assert.match(String(result.stderr) + String(result.stdout), /disposable GitHub-hosted runner/);
  }
);
