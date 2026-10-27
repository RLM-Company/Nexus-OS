import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers";
import { TextDecoder } from "node:util";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

const OPT_IN = "RUN_FIVE_BOUNDED_MODEL_REQUESTS";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (condition, code) => {
  if (!condition) throw new Error(code);
};

/** Decode the actual Kosmora SSE envelope; reject wrong run IDs and mock completions. */
export function acceptanceStreamData(type, text, runId) {
  const envelope = JSON.parse(text);
  check(
    envelope && envelope.type === type && envelope.data && typeof envelope.data === "object",
    "INVALID_STREAM_ENVELOPE"
  );
  const data = envelope.data;
  if (type !== "heartbeat") check(data.run_id === runId, "WRONG_STREAM_RUN");
  if (type === "run.completed")
    check(
      typeof data.provider === "string" &&
        data.provider !== "mock" &&
        typeof data.model_resolved === "string",
      "MOCK_RESULT_REJECTED"
    );
  return data;
}

export function acceptanceConfiguration(env) {
  check(env.COSMORA_LIVE_ACCEPTANCE === OPT_IN, "LIVE_ACCEPTANCE_OPT_IN_REQUIRED");
  let origin;
  try {
    origin = new URL(env.COSMORA_API_ORIGIN ?? "http://127.0.0.1:3100");
  } catch {
    throw new Error("INVALID_API_ORIGIN");
  }
  check(
    origin.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) &&
      !origin.username &&
      !origin.password &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash,
    "LOOPBACK_API_REQUIRED"
  );
  check(
    typeof env.COSMORA_OWNER_SESSION_TOKEN === "string" &&
      /^[^\s]+$/.test(env.COSMORA_OWNER_SESSION_TOKEN),
    "VERIFIED_SESSION_REQUIRED"
  );
  check(
    typeof env.COSMORA_ACCEPTANCE_DIR === "string" && path.isAbsolute(env.COSMORA_ACCEPTANCE_DIR),
    "ABSOLUTE_NEW_REPORT_DIRECTORY_REQUIRED"
  );
  return {
    origin: origin.origin,
    token: env.COSMORA_OWNER_SESSION_TOKEN,
    directory: env.COSMORA_ACCEPTANCE_DIR
  };
}

/** Exactly two chat generations and one Work with at most three model stages.
 * Writes use unique IDs and are never automatically retried. Only synthetic material is sent.
 * A0 is retained; publishing requires a scoped, expiring, one-use CONFIRM override.
 */
export async function runLiveAcceptance(env, fetchImpl = globalThis.fetch) {
  const config = acceptanceConfiguration(env);
  // A new directory is the admission receipt. Re-running into the same directory cannot dispatch again.
  fs.mkdirSync(config.directory, { mode: 0o700 });
  const report = {
    format: "kosmora.live-ai-work-acceptance.v1",
    started_at: new Date().toISOString(),
    ok: false,
    max_model_requests: 5,
    phases: [],
    chat_runs: [],
    project_id: null,
    work_id: null
  };
  const save = () =>
    fs.writeFileSync(path.join(config.directory, "report.json"), JSON.stringify(report, null, 2), {
      mode: 0o600
    });
  save();
  const headers = { Authorization: "Bearer " + config.token };
  const request = async (
    route,
    { method = "GET", body, raw = false, allowed = [200], extra = {} } = {}
  ) => {
    check(
      typeof route === "string" && route.startsWith("/api/v1/") && !route.includes("\\"),
      "INVALID_API_PATH"
    );
    const url = new URL(route, config.origin);
    check(url.origin === config.origin, "CROSS_ORIGIN_API_BLOCKED");
    const response = await fetchImpl(url, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}),
        ...extra
      },
      ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(90_000)
    });
    if (!allowed.includes(response.status)) {
      let code = "HTTP_" + response.status;
      try {
        const j = await response.json();
        const candidate = typeof j.error === "string" ? j.error : j.error?.code;
        if (typeof candidate === "string" && /^[A-Z0-9_]{1,80}$/.test(candidate))
          code += "_" + candidate;
      } catch {
        /* Provider bodies and headers are never copied to the report. */
      }
      throw new Error(code);
    }
    return response;
  };
  const json = async (route, options) => (await request(route, options)).json();
  const post = (route, body, allowed = [200]) => json(route, { method: "POST", body, allowed });
  const put = (route, body) => json(route, { method: "PUT", body });
  const phase = (name, values = {}) => {
    report.phases.push({ name, ok: true, at: new Date().toISOString(), ...values });
    save();
    if (env.COSMORA_ACCEPTANCE_PROGRESS === "true")
      process.stdout.write(JSON.stringify({ phase: name, ...values }) + "\n");
  };
  const stream = async (accepted, start) => {
    check(accepted.stream_url?.startsWith("/api/v1/chat-runs/"), "UNEXPECTED_CHAT_STREAM");
    const response = await request(accepted.stream_url);
    check(response.headers.get("content-type")?.includes("text/event-stream"), "SSE_REQUIRED");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = "",
      bytes = 0,
      first = null,
      done = false;
    try {
      while (!done) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        check(bytes <= 512_000, "STREAM_SIZE_LIMIT");
        pending += decoder.decode(part.value, { stream: true }).replaceAll("\r\n", "\n");
        let boundary;
        while ((boundary = pending.indexOf("\n\n")) !== -1) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const type = frame
            .split("\n")
            .find((l) => l.startsWith("event:"))
            ?.slice(6)
            .trim();
          const text = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!text) continue;
          const data = acceptanceStreamData(type, text, accepted.run_id);
          if (type === "message.delta" && data.delta && first === null)
            first = Math.round(performance.now() - start);
          if (type === "run.failed")
            throw new Error(
              "CHAT_RUN_FAILED_" +
                (/^[A-Z0-9_]+$/.test(data.error_code) ? data.error_code : "UNKNOWN")
            );
          check(type !== "run.cancelled", "CHAT_CANCELLED");
          if (type === "run.completed") {
            check(data.provider !== "mock", "MOCK_RESULT_REJECTED");
            done = true;
            break;
          }
        }
      }
      check(done, "STREAM_INCOMPLETE");
      return { first_delta_ms: first, total_ms: Math.round(performance.now() - start) };
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };
  let adopted = null;
  if (env.COSMORA_ACCEPTANCE_ADOPT_CHAT) {
    try {
      adopted = JSON.parse(env.COSMORA_ACCEPTANCE_ADOPT_CHAT);
    } catch {
      throw new Error("INVALID_RECOVERY_RECEIPT");
    }
    check(
      adopted &&
        [adopted.chat_id, adopted.run_id].every(
          (v) => typeof v === "string" && /^[a-f0-9-]{36}$/.test(v)
        ) &&
        typeof adopted.marker === "string" &&
        /^KOSMORA_[a-f0-9]{32}$/.test(adopted.marker),
      "INVALID_RECOVERY_RECEIPT"
    );
  }
  const expected = {
    marker: adopted?.marker ?? "KOSMORA_" + randomUUID().replaceAll("-", ""),
    sum: 42,
    deadline: "2030-02-17"
  };
  const content = `Synthetic acceptance data.\nmarker=${expected.marker}\namounts=10,20,12\ndeadline=${expected.deadline}\n`;
  const attachment = { name: "acceptance.txt", content };
  const validateAnswer = (value) => {
    let parsed;
    try {
      parsed = JSON.parse(
        value
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
      );
    } catch {
      throw new Error("ANSWER_NOT_JSON");
    }
    check(
      parsed.marker === expected.marker &&
        parsed.sum === expected.sum &&
        parsed.deadline === expected.deadline,
      "ANSWER_EVIDENCE_MISMATCH"
    );
  };
  let overrideId = null;
  try {
    const runtime = await json("/api/v1/model-runtime");
    check(
      runtime.mode !== "mock" &&
        runtime.provider !== "mock" &&
        runtime.credential_configured === true &&
        runtime.fallback_to_mock === false,
      "REAL_MODEL_REQUIRED"
    );
    check(runtime.max_attempts_per_route === 1, "SINGLE_ATTEMPT_REQUIRED");
    check(
      Number.isInteger(runtime.max_output_tokens) && runtime.max_output_tokens <= 2000,
      "CHAT_OUTPUT_CAP_REQUIRED"
    );
    const operations = await json("/api/v1/operations/status");
    check(operations.process_stop === null, "EMERGENCY_STOP_ACTIVE");
    const privacy = await json("/api/v1/personal-settings/privacy");
    check(privacy.ready && privacy.lifecycle === "active", "OWNER_NOT_READY");
    report.runtime = {
      provider: runtime.provider,
      model: runtime.model,
      output_cap: runtime.max_output_tokens,
      attempts: runtime.max_attempts_per_route
    };
    save();
    phase("preflight");
    const prompt =
      "Прочитай приложенный acceptance.txt. Сложи amounts. Верни только JSON с полями marker, sum (число), deadline. Значения marker и deadline возьми из файла. Никаких внешних действий.";
    const chatBody = {
      initial_message: prompt,
      client_message_id: randomUUID(),
      attachments: [attachment]
    };
    report.fixture = {
      marker: expected.marker,
      first_client_message_id: adopted ? null : chatBody.client_message_id,
      attachment_sha256: hash(content)
    };
    save();
    let start = performance.now();
    let first;
    if (adopted) {
      const existing = await json("/api/v1/chats/" + adopted.chat_id);
      check(
        existing.messages.some(
          (m) =>
            m.role === "user" &&
            m.run_id === adopted.run_id &&
            m.content === prompt &&
            m.attachments?.length === 1 &&
            m.attachments[0].name === attachment.name &&
            m.attachments[0].content === content
        ),
        "RECOVERY_FIXTURE_MISMATCH"
      );
      first = {
        chat: { id: adopted.chat_id },
        run_id: adopted.run_id,
        stream_url: "/api/v1/chat-runs/" + adopted.run_id + "/events"
      };
      report.recovered_existing_first_request = true;
      save();
    } else first = await post("/api/v1/chats", chatBody, [201, 202]);
    report.chat_id = first.chat.id;
    report.chat_runs.push(first.run_id);
    save();
    let timing = await stream(first, start);
    if (adopted) timing = { replay_read_ms: timing.total_ms, first_delta_ms: null, total_ms: null };
    const detail = await json("/api/v1/chats/" + first.chat.id);
    const answer = detail.messages.find(
      (m) => m.role === "assistant" && m.run_id === first.run_id && m.status === "completed"
    );
    check(answer, "ASSISTANT_RESULT_MISSING");
    validateAnswer(answer.content);
    check(
      detail.messages.find((m) => m.role === "user")?.attachments?.[0]?.content === content,
      "ATTACHMENT_NOT_SAVED"
    );
    if (!adopted) {
      const replay = await post("/api/v1/chats", chatBody, [201, 202]);
      check(
        replay.run_id === first.run_id && replay.chat.id === first.chat.id,
        "CHAT_REPLAY_DUPLICATED"
      );
    }
    phase(
      adopted ? "chat_attachment_and_saved_stream" : "chat_attachment_and_exact_replay",
      timing
    );
    start = performance.now();
    const second = await post(
      "/api/v1/chats/" + first.chat.id + "/messages",
      {
        content:
          "Без повторного вложения верни те же marker, sum и deadline из нашего предыдущего сообщения. Только JSON.",
        client_message_id: randomUUID()
      },
      [202]
    );
    report.chat_runs.push(second.run_id);
    save();
    const nextTiming = await stream(second, start);
    const follow = await json("/api/v1/chats/" + first.chat.id);
    const followAnswer = follow.messages.find(
      (m) => m.role === "assistant" && m.run_id === second.run_id && m.status === "completed"
    );
    check(followAnswer, "FOLLOW_UP_MISSING");
    validateAnswer(followAnswer.content);
    phase("chat_follow_up_context", nextTiming);

    const project = randomUUID(),
      base = "/api/v1/projects/" + project;
    const created = await post(
      "/api/v1/projects/empty",
      {
        client_project_id: project,
        title: "Приёмка ИИ и Work " + new Date().toISOString().slice(0, 10)
      },
      [201]
    );
    check(created.project.status === "DRAFT", "DRAFT_PROJECT_REQUIRED");
    report.project_id = project;
    save();
    const profile = await json(base + "/autonomy-profile");
    check(
      profile.profile.base_level === "A0" && profile.profile.overrides.length === 0,
      "DEFAULT_POLICY_CHANGED"
    );
    const file = await json(base + "/document-library", {
      method: "POST",
      raw: true,
      body: Buffer.from(content),
      extra: {
        "content-type": "application/octet-stream",
        "x-kosmora-file-name": encodeURIComponent(attachment.name)
      },
      allowed: [201]
    });
    await put(base + "/document-library/" + file.id + "/index", {
      pages: [{ page: null, text: content }]
    });
    const hits = await post(base + "/knowledge/search", {
      query: "amounts",
      kinds: ["document"],
      limit: 5
    });
    check(hits.hits.length === 1, "DOCUMENT_SEARCH_MISMATCH");
    const context = await post(base + "/knowledge/context", {
      references: [hits.hits[0].reference]
    });
    check(context.attachment_sha256 === hash(context.attachment.content), "CONTEXT_HASH_MISMATCH");
    const materials = await put(base + "/materials", {
      version: 0,
      instructions: "Используй только переданные проверенные выдержки источника.",
      attachments: [context.attachment]
    });
    const workBody = {
      client_request_id: randomUUID(),
      goal: "Из материалов проекта создай только result.json: JSON-объект с полями marker, sum (сумма amounts) и deadline из источника. Другие файлы не нужны. Никаких внешних действий. Короткий результат.",
      worker_role: "analyst",
      require_critic: true,
      max_model_requests: 3,
      max_input_tokens: 12000,
      max_output_tokens: 3000
    };
    const workStart = performance.now();
    let work = await post(base + "/work", workBody, [201]);
    report.work_id = work.id;
    save();
    const workPath = base + "/work/" + work.id;
    await put(base + "/materials", {
      version: materials.version,
      instructions: "Changed after acceptance; never substitute this for the accepted snapshot.",
      attachments: []
    });
    const waitWork = async (predicate) => {
      const until = performance.now() + 150_000;
      while (performance.now() < until) {
        const value = await json(workPath);
        if (predicate(value)) return value;
        check(
          !["failed", "cancelled"].includes(value.status),
          "WORK_FAILED_" + (value.error_code ?? "UNKNOWN")
        );
        await delay(400);
      }
      throw new Error("WORK_WAIT_TIMEOUT");
    };
    work = await waitWork((w) => w.status === "awaiting_approval");
    check(
      work.materials.attachments[0].content === context.attachment.content,
      "WORK_SNAPSHOT_REPLACED"
    );
    phase("work_plan_and_pinned_context", {
      elapsed_ms: Math.round(performance.now() - workStart),
      model_requests: work.model_requests
    });
    work = await post(workPath + "/control", { version: work.version, action: "approve" });
    work = await waitWork((w) => w.status === "blocked");
    check(work.error_code === "DENIED" && work.stage === "publish", "A0_PUBLICATION_GATE_MISSING");
    check(work.model_requests === 3 && work.review?.verdict === "PASS", "REAL_CRITIC_NOT_PASSED");
    check(
      work.draft.files.length === 1 && work.draft.files[0].name === "result.json",
      "UNEXPECTED_WORK_FILES"
    );
    validateAnswer(work.draft.files[0].content);
    await request(workPath + "/files/result.json", { allowed: [404] });
    phase("work_draft_review_and_a0_gate", {
      elapsed_ms: Math.round(performance.now() - workStart),
      model_requests: work.model_requests
    });
    const policy = await json(base + "/autonomy-profile");
    overrideId = "acceptance-publish-" + randomUUID();
    await put(base + "/autonomy-profile", {
      base_level: "A0",
      expected_version: policy.profile.version,
      overrides: [
        {
          override_id: overrideId,
          capability_id: "workspace.write",
          mode: "CONFIRM",
          object_ids: [work.id + "/result.json"],
          purpose: "Publish work files " + hash(JSON.stringify(work.draft)),
          valid_until: new Date(Date.now() + 600_000).toISOString(),
          remaining_uses: 1
        }
      ]
    });
    await post(workPath + "/control", { version: work.version, action: "resume" });
    work = await waitWork((w) => w.status === "blocked");
    check(
      work.error_code === "WAITING_CONFIRMATION" && work.confirmation_id,
      "CONFIRMATION_GATE_MISSING"
    );
    const confirmations = await json(base + "/confirmations?status=PENDING"),
      confirmation = confirmations.items.find((c) => c.confirmation_id === work.confirmation_id);
    check(
      confirmation &&
        !confirmation.requires_step_up &&
        confirmation.intent.object_ids.length === 1 &&
        confirmation.intent.object_ids[0] === work.id + "/result.json",
      "UNEXPECTED_CONFIRMATION_SCOPE"
    );
    await post("/api/v1/confirmations/" + confirmation.confirmation_id + "/approve", {
      challenge_nonce: confirmation.challenge_nonce,
      reason:
        "Owner-authorized synthetic live acceptance: publish this single inert result.json only."
    });
    await post(workPath + "/control", { version: work.version, action: "resume" });
    work = await waitWork((w) => w.status === "completed");
    check(work.model_requests === 3, "PUBLISH_REGENERATED_MODEL_OUTPUT");
    const downloaded = await request(workPath + "/files/result.json");
    const output = await downloaded.text();
    validateAnswer(output);
    fs.writeFileSync(path.join(config.directory, "result.json"), output, {
      mode: 0o600,
      flag: "wx"
    });
    const repeated = await post(base + "/work", workBody, [201]);
    check(repeated.id === work.id, "WORK_REPLAY_DUPLICATED");
    check(
      repeated.materials.attachments[0].content === context.attachment.content,
      "REPLAY_REPLACED_CONTEXT"
    );
    const reopened = await json(workPath);
    check(reopened.status === "completed" && reopened.model_requests === 3, "WORK_REOPEN_FAILED");
    const again = await (await request(workPath + "/files/result.json")).text();
    check(hash(again) === hash(output), "PUBLISHED_FILE_CHANGED");
    report.work_runs = (work.result_sources ?? []).map((s) => s.run_id);
    check(report.work_runs.length === 3, "WORK_SOURCE_PROVENANCE_MISSING");
    phase("scoped_confirmation_publish_download_reopen", {
      elapsed_ms: Math.round(performance.now() - workStart),
      file_sha256: hash(output),
      file_bytes: Buffer.byteLength(output)
    });
    const ids = new Set([...report.chat_runs, ...report.work_runs]);
    const usage = await json("/api/v1/personal-settings/usage");
    const rows = usage.rows.filter((r) => ids.has(r.run_id));
    check(
      rows.length === 5 && rows.every((r) => r.status === "committed"),
      "CANONICAL_USAGE_INCOMPLETE"
    );
    report.usage = {
      requests: rows.length,
      input_tokens: rows.reduce((n, r) => n + (r.input_tokens ?? 0), 0),
      output_tokens: rows.reduce((n, r) => n + (r.output_tokens ?? 0), 0),
      currencies: [...new Set(rows.map((r) => r.currency))],
      cost_amount: rows.every((r) => typeof r.cost_amount === "number")
        ? rows.reduce((n, r) => n + r.cost_amount, 0)
        : null
    };
    check(
      rows.every((r) => Number.isInteger(r.input_tokens) && Number.isInteger(r.output_tokens)),
      "UNKNOWN_USAGE"
    );
    phase("five_canonical_usage_records_no_retry_or_mock");
    report.ok = true;
  } catch (error) {
    report.error =
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "ACCEPTANCE_FAILED";
  } finally {
    if (overrideId && report.project_id) {
      try {
        const base = "/api/v1/projects/" + report.project_id,
          policy = await json(base + "/autonomy-profile");
        await put(base + "/autonomy-profile", {
          base_level: policy.profile.base_level,
          expected_version: policy.profile.version,
          overrides: policy.profile.overrides.filter((o) => o.override_id !== overrideId)
        });
        report.test_override_removed = true;
      } catch {
        report.ok = false;
        report.cleanup_error = "TEST_OVERRIDE_REMOVAL_FAILED";
      }
    }
    report.finished_at = new Date().toISOString();
    save();
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await runLiveAcceptance(process.env);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message + "\n"
        : "ACCEPTANCE_NOT_STARTED\n"
    );
    process.exitCode = 1;
  }
}
