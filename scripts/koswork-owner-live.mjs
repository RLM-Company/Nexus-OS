#!/usr/bin/env node
/* global fetch */
// Measurement/live-acceptance driver for the owner's scenarios. Importing this
// module never dispatches a paid or live model call. To run against an agreed
// local API with a real provider, set:
//   KOSMORA_WORK_LIVE_ORIGIN=http://127.0.0.1:3100
//   KOSMORA_WORK_LIVE_CONFIRM=RUN_ONE_OWNER_SCENARIO
// The API can start model work immediately after accepting the task.
// No secrets are read or printed by this script; the server owns the key.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const CONFIRM = "RUN_ONE_OWNER_SCENARIO";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const origin = (() => {
  const configured = process.env.KOSMORA_WORK_LIVE_ORIGIN ?? "http://127.0.0.1:3100";
  const url = new URL(configured);
  assert(url.protocol === "http:", "LIVE_ORIGIN_HTTP_REQUIRED");
  assert(LOOPBACK.has(url.hostname), "LIVE_ORIGIN_LOOPBACK_REQUIRED");
  assert(
    url.username === "" && url.password === "" && url.pathname === "/" && !url.search && !url.hash,
    "LIVE_ORIGIN_CLEAN_REQUIRED"
  );
  return url;
})();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.KOSMORA_WORK_LIVE_CONFIRM !== CONFIRM) {
    console.log(JSON.stringify({ skipped: true, reason: "EXPLICIT_CONFIRM_REQUIRED" }));
    process.exit(0);
  }
  const projectId = process.env.KOSMORA_WORK_LIVE_PROJECT ?? "";
  assert(projectId, "PROJECT_REQUIRED");
  const requestBody = {
    client_request_id: `owner-scenario-${randomUUID()}`,
    goal: "Посчитать итог Q1+Q2 по двум строкам и сверить с якорями",
    worker_role: "analyst",
    max_model_requests: 3,
    max_input_tokens: 32000,
    max_output_tokens: 6000
  };
  const create = await fetch(
    new URL(`/api/v1/projects/${encodeURIComponent(projectId)}/work`, origin),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    }
  );
  assert(create.ok, `WORK_ADMISSION_FAILED:${create.status}`);
  const work = await create.json();
  console.log(
    JSON.stringify(
      {
        skipped: false,
        project_id: projectId,
        work_id: work.id,
        client_request_id: requestBody.client_request_id,
        status: work.status
      },
      null,
      2
    )
  );
}
