"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildHarAndCurlReplay,
  saveHarAndCurlToWorkspace
} = require("../workspace/har-and-curl-replay-builder.cjs");

test("W3C HAR v1.2 & POSIX cURL Replay Builder redacts sensitive credentials and writes artifacts cleanly", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-har-curl-"));

  const built = buildHarAndCurlReplay({
    entries: [
      {
        method: "POST",
        url: "https://kosmora.local/api/v1/ai-intelligence/calibrate",
        requestHeaders: [
          { name: "Content-Type", value: "application/json" },
          { name: "Authorization", value: "Bearer secret_token_123" }
        ],
        requestBody: JSON.stringify({ prompt: "Verify Raft" }),
        status: 200,
        durationMs: 18,
        responseBody: JSON.stringify({ ok: true })
      }
    ]
  });

  assert.equal(built.entryCount, 1);
  assert.doesNotMatch(built.harJson, /secret_token_123/);
  assert.match(built.harJson, /\[REDACTED_CREDENTIAL\]/);
  assert.match(built.curlScript, /curl -sS -X POST/);

  const saved = saveHarAndCurlToWorkspace(workspaceDir, "api-session", {
    entries: [{ method: "GET", url: "https://kosmora.local/health" }]
  });

  assert.equal(fs.existsSync(saved.harPath), true);
  assert.equal(fs.existsSync(saved.curlPath), true);
  assert.equal(saved.sha256.length, 64);

  assert.throws(() => {
    saveHarAndCurlToWorkspace("", "invalid", {});
  }, /WORKSPACE_REQUIRED/);
});
