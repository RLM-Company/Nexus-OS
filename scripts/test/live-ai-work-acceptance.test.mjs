import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import {
  acceptanceConfiguration,
  acceptanceStreamData,
  runLiveAcceptance
} from "../live-ai-work-acceptance.mjs";
const optIn = "RUN_FIVE_BOUNDED_MODEL_REQUESTS";
test("unwraps the real SSE envelope and rejects mismatched run identity or mock completion", () => {
  const frame = (type, data) => JSON.stringify({ type, data });
  assert.equal(
    acceptanceStreamData(
      "message.delta",
      frame("message.delta", { run_id: "run", delta: "text" }),
      "run"
    ).delta,
    "text"
  );
  assert.throws(
    () =>
      acceptanceStreamData(
        "run.completed",
        frame("run.completed", { run_id: "other", provider: "external", model_resolved: "real" }),
        "run"
      ),
    /WRONG_STREAM_RUN/
  );
  assert.throws(
    () =>
      acceptanceStreamData(
        "run.completed",
        frame("run.completed", { run_id: "run", provider: "mock", model_resolved: "mock" }),
        "run"
      ),
    /MOCK_RESULT_REJECTED/
  );
  assert.throws(
    () =>
      acceptanceStreamData(
        "run.completed",
        JSON.stringify({ run_id: "run", provider: "external" }),
        "run"
      ),
    /INVALID_STREAM_ENVELOPE/
  );
});
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-live-guards-"));
  const directory = path.join(root, "receipt");
  return {
    root,
    directory,
    env: {
      COSMORA_LIVE_ACCEPTANCE: optIn,
      COSMORA_OWNER_SESSION_TOKEN: "synthetic-test-session",
      COSMORA_ACCEPTANCE_DIR: directory
    },
    cleanup() {
      if (fs.existsSync(path.join(directory, "report.json")))
        fs.unlinkSync(path.join(directory, "report.json"));
      if (fs.existsSync(directory)) fs.rmdirSync(directory);
      fs.rmdirSync(root);
    }
  };
};
test("no explicit paid opt-in means no filesystem receipt and no network call", async () => {
  let calls = 0;
  await assert.rejects(
    runLiveAcceptance({}, () => {
      calls++;
      throw Error("Unexpected network");
    }),
    /OPT_IN_REQUIRED/
  );
  assert.equal(calls, 0);
});
test("rejects remote, credential-bearing, non-origin and HTTPS URLs before a session can be sent", () => {
  const f = fixture();
  try {
    for (const origin of [
      "https://example.org",
      "http://127.0.0.1.evil.test",
      "http://user:password@127.0.0.1:3100",
      "http://127.0.0.1:3100/path",
      "http://127.0.0.1:3100/?x=1",
      "https://localhost"
    ])
      assert.throws(
        () => acceptanceConfiguration({ ...f.env, COSMORA_API_ORIGIN: origin }),
        /LOOPBACK_API_REQUIRED/
      );
    assert.equal(fs.existsSync(f.directory), false);
  } finally {
    f.cleanup();
  }
});
test("rejects malformed session tokens and relative report paths without exposing their values", () => {
  const f = fixture();
  try {
    assert.throws(
      () => acceptanceConfiguration({ ...f.env, COSMORA_OWNER_SESSION_TOKEN: "PRIVATE\nTOKEN" }),
      { message: "VERIFIED_SESSION_REQUIRED" }
    );
    assert.throws(
      () => acceptanceConfiguration({ ...f.env, COSMORA_ACCEPTANCE_DIR: "relative" }),
      /ABSOLUTE_NEW_REPORT_DIRECTORY_REQUIRED/
    );
  } finally {
    f.cleanup();
  }
});
test("an existing receipt directory blocks all redispatch across process restarts", async () => {
  const f = fixture();
  let calls = 0;
  fs.mkdirSync(f.directory);
  try {
    await assert.rejects(
      runLiveAcceptance(f.env, () => {
        calls++;
        throw Error("Unexpected network");
      }),
      /EEXIST/
    );
    assert.equal(calls, 0);
  } finally {
    f.cleanup();
  }
});
for (const [name, runtime, error] of [
  ["mock provider", { mode: "mock", provider: "mock" }, "REAL_MODEL_REQUIRED"],
  [
    "multiple attempts",
    {
      mode: "openai-compatible",
      provider: "fixture",
      credential_configured: true,
      fallback_to_mock: false,
      max_attempts_per_route: 2,
      max_output_tokens: 1000
    },
    "SINGLE_ATTEMPT_REQUIRED"
  ]
])
  test(
    "refuses " + name + " before any generation and produces a redacted failure report",
    async () => {
      const f = fixture();
      const requests = [];
      try {
        const result = await runLiveAcceptance(f.env, (url) => {
          requests.push(String(url));
          return Promise.resolve(
            new globalThis.Response(JSON.stringify(runtime), {
              headers: { "content-type": "application/json" }
            })
          );
        });
        assert.equal(result.ok, false);
        assert.equal(result.error, error);
        assert.equal(requests.length, 1);
        assert.equal(new URL(requests[0]).pathname, "/api/v1/model-runtime");
        assert.equal(
          fs
            .readFileSync(path.join(f.directory, "report.json"), "utf8")
            .includes(f.env.COSMORA_OWNER_SESSION_TOKEN),
          false
        );
      } finally {
        f.cleanup();
      }
    }
  );
