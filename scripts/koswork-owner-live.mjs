#!/usr/bin/env node
/* global fetch */
// Measurement/live-acceptance driver for the owner's scenarios. Importing this
// module never dispatches a paid or live model call. To run against an agreed
// local API with a real provider, set:
//   KOSMORA_WORK_LIVE_ORIGIN=http://127.0.0.1:3100
//   KOSMORA_WORK_LIVE_CONFIRM=RUN_ONE_OWNER_SCENARIO
//   KOSMORA_WORK_LIVE_REQUEST_ID=<stable ID for this run>
// The API can start model work immediately after accepting the task.
// Optional KOSMORA_WORK_OWNER_BEARER authenticates the loopback API.
// The provider key stays with the server. The driver never prints a bearer or file contents.
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const CONFIRM = "RUN_ONE_OWNER_SCENARIO";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const expectedResult = ["Q1=200", "Q2=200", "TOTAL=400"].join("\n");
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
function resolveOrigin(configured) {
  const url = new URL(configured);
  assert(url.protocol === "http:", "LIVE_ORIGIN_HTTP_REQUIRED");
  assert(LOOPBACK.has(url.hostname), "LIVE_ORIGIN_LOOPBACK_REQUIRED");
  assert(
    url.username === "" && url.password === "" && url.pathname === "/" && !url.search && !url.hash,
    "LIVE_ORIGIN_CLEAN_REQUIRED"
  );
  return url;
}

export async function runOwnerScenario(env, onAdmitted = () => {}) {
  if (env.KOSMORA_WORK_LIVE_CONFIRM !== CONFIRM)
    return { skipped: true, reason: "EXPLICIT_CONFIRM_REQUIRED" };
  const origin = resolveOrigin(env.KOSMORA_WORK_LIVE_ORIGIN ?? "http://127.0.0.1:3100");
  const projectId = env.KOSMORA_WORK_LIVE_PROJECT?.trim();
  assert(projectId, "PROJECT_REQUIRED");
  const clientRequestId = env.KOSMORA_WORK_LIVE_REQUEST_ID ?? "";
  assert(/^[a-zA-Z0-9_-]{1,128}$/.test(clientRequestId), "STABLE_REQUEST_ID_REQUIRED");
  const ownerBearer = env.KOSMORA_WORK_OWNER_BEARER?.trim();
  const request = async (path, body, code) => {
    let response;
    try {
      response = await fetch(new URL(path, origin), {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(ownerBearer ? { Authorization: `Bearer ${ownerBearer}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new Error(`${code}:TRANSPORT`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`${code}:${response.status}`);
    }
    return response;
  };
  const readWork = async (response) => {
    try {
      return await response.json();
    } catch {
      throw new Error("INVALID_WORK_RESPONSE");
    }
  };
  const workPath = `/api/v1/projects/${encodeURIComponent(projectId)}/work`;
  const started = performance.now();
  const create = await request(
    workPath,
    {
      client_request_id: clientRequestId,
      goal:
        "Вычисли суммы по этим данным: Q1 — 120 и 80, Q2 — 110 и 90. " +
        "Создай скачиваемый текстовый файл result.md внутри проекта Kosmora. " +
        "В файле должны быть ровно три строки с вычисленными значениями в формате " +
        "Q1=<сумма>, Q2=<сумма>, TOTAL=<общий итог>, по одной паре на строку. " +
        "Используй только эти данные и встроенную публикацию текстового файла.",
      worker_role: "analyst",
      require_critic: true,
      max_model_requests: 3,
      max_input_tokens: 32000,
      max_output_tokens: 6000
    },
    "WORK_ADMISSION_FAILED"
  );
  let work = await readWork(create);
  assert(typeof work.id === "string" && work.id && work.project_id === projectId, "INVALID_WORK");
  const workId = work.id;
  onAdmitted({ project_id: projectId, work_id: workId, client_request_id: clientRequestId });
  const detail = `${workPath}/${encodeURIComponent(workId)}`;
  const deadline = started + 120_000;
  while (["queued", "running"].includes(work.status) && performance.now() < deadline) {
    await delay(500);
    work = await readWork(await request(detail, undefined, "WORK_READ_FAILED"));
    assert(work.id === workId && work.project_id === projectId, "INVALID_WORK");
  }
  const result = {
    status: work.status,
    elapsed_ms: Math.round(performance.now() - started),
    model_requests: work.model_requests,
    ...(typeof work.error_code === "string" && /^[A-Z0-9_]{1,80}$/u.test(work.error_code)
      ? { error_code: work.error_code }
      : {})
  };
  if (work.status !== "completed") return result;
  assert(work.review?.verdict === "PASS", "WORK_REVIEW_NOT_PASSED");
  const file = await request(`${detail}/files/result.md`, undefined, "WORK_DOWNLOAD_FAILED");
  const bytes = Buffer.from(await file.arrayBuffer());
  const normalized = bytes
    .toString("utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/[\t ]*=[\t ]*/gu, "="))
    .join("\n");
  return {
    ...result,
    review: "PASS",
    artifact_check: normalized === expectedResult ? "passed" : "failed",
    file: {
      name: "result.md",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runOwnerScenario(process.env, (admitted) =>
      console.log(JSON.stringify({ admitted }))
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.skipped && (result.status !== "completed" || result.artifact_check !== "passed"))
      process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "WORK_ACCEPTANCE_FAILED");
    process.exitCode = 1;
  }
}
