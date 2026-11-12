"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseLiveOrigin, runPackagedLiveSmoke } = require("../ci/gui-acceptance-live.cjs");

test("parseLiveOrigin accepts only credential-free non-loopback https origins", () => {
  assert.equal(parseLiveOrigin("https://kosmora.example"), "https://kosmora.example");
  assert.equal(
    parseLiveOrigin("https://kosmora.example:8443/workspace?next=1#frag"),
    "https://kosmora.example:8443"
  );
  assert.throws(() => parseLiveOrigin(""), /KOSMORA_LIVE_ORIGIN/);
  assert.throws(() => parseLiveOrigin("   "), /KOSMORA_LIVE_ORIGIN/);
  assert.throws(() => parseLiveOrigin("not a url"), /valid URL/);
  assert.throws(() => parseLiveOrigin("http://kosmora.example"), /https/);
  assert.throws(() => parseLiveOrigin("https://127.0.0.1:8443"), /loopback/);
  assert.throws(() => parseLiveOrigin("https://localhost:8443"), /loopback/);
  assert.throws(() => parseLiveOrigin("https://[::1]:8443"), /loopback/);
  assert.throws(() => parseLiveOrigin("https://owner:secret@kosmora.example"), /credentials/);
});

test("runPackagedLiveSmoke refuses guard violations and bad origins before spawning anything", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-gui-live-guard-"));
  const runnerTemp = path.join(tempDir, "runner-temp");
  fs.mkdirSync(runnerTemp);
  const workRoot = path.join(runnerTemp, "work");
  fs.mkdirSync(workRoot);
  const environment = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_TEMP: runnerTemp
  };
  const runLiveSmoke = (overrides) =>
    runPackagedLiveSmoke({
      appExePath: missingApp,
      workRoot,
      origin: "https://kosmora.example",
      environment,
      platform: "win32",
      ...overrides
    });
  const missingApp = path.join(workRoot, "Kosmora.exe");
  try {
    // Work root outside RUNNER_TEMP, and RUNNER_TEMP itself, are refused.
    const outsideRoot = fs.mkdtempSync(path.join(tempDir, "outside-"));
    await assert.rejects(() => runLiveSmoke({ workRoot: outsideRoot }), /within RUNNER_TEMP/);
    await assert.rejects(() => runLiveSmoke({ workRoot: runnerTemp }), /within RUNNER_TEMP/);

    // The executable must exist and be the installed Kosmora inside the work root.
    await assert.rejects(() => runLiveSmoke(), /was not found/);
    const notKosmora = path.join(workRoot, "Other.exe");
    fs.writeFileSync(notKosmora, "");
    await assert.rejects(() => runLiveSmoke({ appExePath: notKosmora }), /inside the work root/);
    const strayExe = path.join(runnerTemp, "Kosmora.exe");
    fs.writeFileSync(strayExe, "");
    await assert.rejects(() => runLiveSmoke({ appExePath: strayExe }), /inside the work root/);

    // Invalid origins are rejected after the guards, before any spawn.
    const app = path.join(workRoot, "Kosmora.exe");
    fs.writeFileSync(app, "");
    await assert.rejects(
      () => runLiveSmoke({ appExePath: app, origin: "http://kosmora.example" }),
      /https/
    );
    await assert.rejects(
      () => runLiveSmoke({ appExePath: app, origin: "https://127.0.0.1:8443" }),
      /loopback/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
