"use strict";
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

test(
  "installer lifecycle refuses a developer machine before reading or changing files",
  { skip: process.platform !== "win32" },
  () => {
    const result = spawnSync(
      "pwsh",
      [
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
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, GITHUB_ACTIONS: "false", RUNNER_ENVIRONMENT: "local" }
      }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /disposable GitHub-hosted runner/);
  }
);
