import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { runOwnerScenario } from "../koswork-owner-live.mjs";

test("requires explicit opt-in before validating or contacting the configured API", async () => {
  assert.deepEqual(await runOwnerScenario({ KOSMORA_WORK_LIVE_ORIGIN: "invalid" }), {
    skipped: true,
    reason: "EXPLICIT_CONFIRM_REQUIRED"
  });
});

for (const status of ["completed", "awaiting_approval"]) {
  test(`admits once and observes ${status} without issuing further writes`, async (t) => {
    const project = "fixture-project";
    const work = { id: "fixture-work", project_id: project };
    const base = `/api/v1/projects/${project}/work`;
    const detail = `${base}/${work.id}`;
    const artifact = "# Итог\nQ1: 200, Q2: 200, всего: 400.\n";
    const calls = [];
    const admissions = [];
    const server = createServer(async (request, response) => {
      calls.push([request.method, request.url]);
      if (request.headers.authorization !== "Bearer fixture-owner") {
        response.writeHead(401).end();
        return;
      }
      if (request.method === "POST" && request.url === base) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        admissions.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(201).end(JSON.stringify({ ...work, status: "queued" }));
      } else if (request.method === "GET" && request.url === detail) {
        response.end(
          JSON.stringify({ ...work, status, model_requests: 3, review: { verdict: "PASS" } })
        );
      } else if (request.method === "GET" && request.url === `${detail}/files/result.md`) {
        response.end(artifact);
      } else {
        response.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const admitted = [];
    const result = await runOwnerScenario(
      {
        KOSMORA_WORK_LIVE_ORIGIN: `http://127.0.0.1:${server.address().port}`,
        KOSMORA_WORK_LIVE_CONFIRM: "RUN_ONE_OWNER_SCENARIO",
        KOSMORA_WORK_LIVE_PROJECT: project,
        KOSMORA_WORK_LIVE_REQUEST_ID: "fixture-admission",
        KOSMORA_WORK_OWNER_BEARER: "fixture-owner"
      },
      (record) => admitted.push(record)
    );
    assert.equal(admissions.length, 1);
    assert.equal(admissions[0].require_critic, true);
    assert.equal(admissions[0].client_request_id, "fixture-admission");
    assert.deepEqual(admitted, [
      { project_id: project, work_id: work.id, client_request_id: admissions[0].client_request_id }
    ]);
    assert.deepEqual(calls, [
      ["POST", base],
      ["GET", detail],
      ...(status === "completed" ? [["GET", `${detail}/files/result.md`]] : [])
    ]);
    assert.equal(result.status, status);
    assert.equal(result.model_requests, 3);
    if (status === "completed") {
      assert.equal(result.review, "PASS");
      assert.deepEqual(result.file, {
        name: "result.md",
        bytes: Buffer.byteLength(artifact),
        sha256: createHash("sha256").update(artifact).digest("hex")
      });
    }
  });
}
