import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { URL } from "node:url";
import {
  codeAcceptanceConfiguration,
  COSCODE_ACCEPTANCE_TASK,
  runCodeAcceptance,
  validateCodeProposal
} from "../live-coscode-acceptance.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-code-guards-"));
  const directory = path.join(root, "run");
  const env = {
    COSMORA_ALLOW_CODE_ACCEPTANCE: "MODEL_TASK_AND_REVIEWED_DRAFT_PR",
    COSMORA_CODE_ACTION: "generate",
    COSMORA_OWNER_SESSION_TOKEN: "synthetic-owner-session",
    COSMORA_CODE_OUTPUT_DIR: directory
  };
  return {
    root,
    directory,
    env,
    cleanup() {
      for (const name of [
        "receipt.json",
        "proposal.json",
        "provider-connection-check.proposed.mjs",
        "publication-attempt.json"
      ])
        if (fs.existsSync(path.join(directory, name))) fs.unlinkSync(path.join(directory, name));
      if (fs.existsSync(directory)) fs.rmdirSync(directory);
      fs.rmdirSync(root);
    }
  };
};
const proposedRun = (receipt) => {
  const proposal = [
    {
      path: "scripts/provider-connection-check.mjs",
      content: "export const fixture = 1;\n",
      before: "export const fixture = 0;\n"
    }
  ];
  const base = "a".repeat(40);
  const proposalHash = hash({ base, proposal });
  return {
    id: "a6651d15-baf3-4b27-b28f-e0e90251ada5",
    project_id: receipt.project_id,
    client_request_id: receipt.client_request_id,
    task: COSCODE_ACCEPTANCE_TASK,
    repository: "RLM-Company/Nexus-OS",
    base_branch: "main",
    base_sha: base,
    status: "proposed",
    proposal,
    proposal_hash: proposalHash,
    model_run_ids: ["fixture-model-run"],
    proposal_check: {
      status: "passed",
      cleanupVerified: true,
      exitCode: 0,
      proposal_hash: proposalHash
    }
  };
};
function api(f, { unknownSubmission = false } = {}) {
  const calls = [];
  let published = false;
  const receipt = () => JSON.parse(fs.readFileSync(path.join(f.directory, "receipt.json"), "utf8"));
  const response = (value) => globalThis.Response.json(value);
  const draft = {
    pr_url: "https://github.com/RLM-Company/Nexus-OS/pull/999999",
    plan: { review_hash: "b".repeat(64) }
  };
  const run = () => proposedRun(receipt());
  const fetch = async (url, options) => {
    const route = new URL(url).pathname;
    calls.push({ route, method: options.method, body: options.body });
    assert.equal(options.redirect, "error");
    if (route === "/api/v1/model-runtime")
      return response({
        mode: "openai-compatible",
        provider: "fixture",
        credential_configured: true,
        fallback_to_mock: false,
        max_attempts_per_route: 1
      });
    if (route === "/api/v1/github/status")
      return response({ configured: true, repository: "RLM-Company/Nexus-OS" });
    if (route === "/api/v1/operations/status") return response({ process_stop: null });
    if (route === "/api/v1/personal-settings/privacy")
      return response({ ready: true, lifecycle: "active" });
    if (route === "/api/v1/code-projects") return response({});
    if (route === "/api/v1/personal-settings/usage")
      return response({
        rows: [
          {
            run_id: "fixture-model-run",
            status: "committed",
            provider_id: "fixture",
            input_tokens: 100,
            output_tokens: 50
          }
        ]
      });
    if (route.endsWith("/review"))
      return response({
        ...run(),
        status: "checked",
        check: { status: "passed", cleanupVerified: true },
        publication_token: "synthetic-publication-token",
        draft
      });
    if (route.endsWith("/publish")) {
      published = true;
      return response({ ...run(), status: "published", draft });
    }
    if (route.endsWith("/code-agent") && options.method === "POST" && unknownSubmission)
      throw Error("synthetic private transport detail");
    return response({ ...run(), ...(published ? { status: "published", draft } : {}) });
  };
  return { fetch, calls };
}

test("explicit opt-in is required before filesystem or network work", async () => {
  let calls = 0;
  await assert.rejects(
    runCodeAcceptance({}, () => {
      calls++;
    }),
    /OPT_IN_REQUIRED/
  );
  assert.equal(calls, 0);
});
test("remote origins, URL credentials, relative directories and malformed sessions are refused", () => {
  const f = fixture();
  try {
    for (const url of [
      "https://example.org",
      "http://127.0.0.1.evil",
      "http://x:y@localhost",
      "http://localhost/path",
      "http://localhost/?secret=private"
    ])
      assert.throws(
        () => codeAcceptanceConfiguration({ ...f.env, COSMORA_API_ORIGIN: url }),
        /LOOPBACK_API_REQUIRED/
      );
    assert.throws(
      () => codeAcceptanceConfiguration({ ...f.env, COSMORA_CODE_OUTPUT_DIR: "relative" }),
      /ABSOLUTE_RECEIPT/
    );
    assert.throws(
      () =>
        codeAcceptanceConfiguration({ ...f.env, COSMORA_OWNER_SESSION_TOKEN: "private\nvalue" }),
      { message: "OWNER_SESSION_REQUIRED" }
    );
    assert.equal(fs.existsSync(f.directory), false);
  } finally {
    f.cleanup();
  }
});
test("an existing durable receipt blocks repeat generation with zero requests", async () => {
  const f = fixture();
  fs.mkdirSync(f.directory);
  let calls = 0;
  try {
    await assert.rejects(
      runCodeAcceptance(f.env, () => {
        calls++;
      }),
      /EEXIST/
    );
    assert.equal(calls, 0);
  } finally {
    f.cleanup();
  }
});
test("proposal validation requires exact task, file, hash and verified OCI cleanup", () => {
  const receipt = { project_id: "project", client_request_id: "request" };
  for (const mutate of [
    (r) => {
      r.repository = "someone/else";
    },
    (r) => {
      r.task = "another task";
    },
    (r) => {
      r.proposal[0].path = "apps/web/page.tsx";
    },
    (r) => {
      r.proposal[0].content += "changed";
    },
    (r) => {
      r.proposal_check.cleanupVerified = false;
    },
    (r) => {
      r.proposal_check.exitCode = 1;
    }
  ]) {
    const run = proposedRun(receipt);
    mutate(run);
    assert.throws(() => validateCodeProposal(run, receipt));
  }
});
test("generation collects exact checked proposal, never publishes and redacts session", async () => {
  const f = fixture(),
    server = api(f);
  try {
    const report = await runCodeAcceptance(f.env, server.fetch);
    assert.equal(report.state, "proposal_ready_for_independent_review");
    assert.equal(server.calls.filter((c) => c.method === "POST").length, 2);
    assert.equal(
      server.calls.some((c) => c.route.endsWith("/publish")),
      false
    );
    for (const name of ["receipt.json", "proposal.json"])
      assert.equal(
        fs
          .readFileSync(path.join(f.directory, name), "utf8")
          .includes(f.env.COSMORA_OWNER_SESSION_TOKEN),
        false
      );
    const before = server.calls.length;
    const recovered = await runCodeAcceptance(
      { ...f.env, COSMORA_CODE_ACTION: "collect" },
      server.fetch
    );
    assert.equal(recovered.error, undefined);
    assert.ok(server.calls.slice(before).every((c) => c.method === "GET"));
  } finally {
    f.cleanup();
  }
});
test("unknown generation submission is not retried; existing task can be collected read-only", async () => {
  const f = fixture(),
    server = api(f, { unknownSubmission: true });
  try {
    await assert.rejects(runCodeAcceptance(f.env, server.fetch), {
      message: "REQUEST_OUTCOME_UNKNOWN"
    });
    const before = server.calls.length;
    const recovered = await runCodeAcceptance(
      { ...f.env, COSMORA_CODE_ACTION: "collect" },
      server.fetch
    );
    assert.equal(recovered.error, undefined);
    assert.ok(server.calls.slice(before).every((c) => c.method === "GET"));
    assert.equal(
      server.calls.filter((c) => c.route.endsWith("/code-agent") && c.method === "POST").length,
      1
    );
  } finally {
    f.cleanup();
  }
});
test("publication needs independently reviewed hashes before any request", async () => {
  const f = fixture(),
    server = api(f);
  try {
    await runCodeAcceptance(f.env, server.fetch);
    const before = server.calls.length;
    await assert.rejects(
      runCodeAcceptance({ ...f.env, COSMORA_CODE_ACTION: "publish" }, server.fetch),
      /EXACT_REVIEW_AND_INDEPENDENT_TEST_REQUIRED/
    );
    assert.equal(server.calls.length, before);
    assert.equal(fs.existsSync(path.join(f.directory, "publication-attempt.json")), false);
  } finally {
    f.cleanup();
  }
});
test("reviewed publication uses exact token, reopens result and does not duplicate generation", async () => {
  const f = fixture(),
    server = api(f);
  try {
    const report = await runCodeAcceptance(f.env, server.fetch);
    const result = await runCodeAcceptance(
      {
        ...f.env,
        COSMORA_CODE_ACTION: "publish",
        COSMORA_CODE_APPROVED_PROPOSAL_HASH: report.proposal_hash,
        COSMORA_CODE_INDEPENDENTLY_TESTED_SHA256: report.source_sha256
      },
      server.fetch
    );
    assert.equal(result.state, "published_and_reopened");
    const publication = server.calls.filter((c) => c.route.endsWith("/publish"));
    assert.equal(publication.length, 1);
    assert.equal(JSON.parse(publication[0].body).publication_token, "synthetic-publication-token");
    assert.equal(
      fs
        .readFileSync(path.join(f.directory, "receipt.json"), "utf8")
        .includes("synthetic-publication-token"),
      false
    );
    assert.equal(
      server.calls.filter((c) => c.route.endsWith("/code-agent") && c.method === "POST").length,
      2
    );
  } finally {
    f.cleanup();
  }
});
