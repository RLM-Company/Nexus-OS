#!/usr/bin/env node
/* global fetch, AbortSignal */
// Adapted from Gemini's media drop. Importing this module never dispatches work.
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL, URL } from "node:url";
import { Buffer } from "node:buffer";
import process from "node:process";
import { setTimeout } from "node:timers";

export function mediaAcceptanceConfig(env, argv) {
  if (
    !argv.includes("--confirm-live-paid-media") ||
    env.KOSMORA_MEDIA_LIVE_CONFIRM !== "YES_RUN_PAID_ACCEPTANCE"
  )
    throw Error("LIVE_CONFIRMATION_REQUIRED");
  const maximum = Number(env.KOSMORA_MEDIA_LIVE_MAX_OPS ?? "1");
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 3)
    throw Error("MAX_OPS_MUST_BE_1_TO_3");
  const origin = new URL(env.KOSMORA_MEDIA_API_ORIGIN ?? "");
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(origin.hostname)))
  )
    throw Error("INVALID_API_ORIGIN");
  const token = env.KOSMORA_MEDIA_OWNER_BEARER_TOKEN;
  if (
    !token ||
    [...token].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  )
    throw Error("OWNER_TOKEN_REQUIRED");
  const directory = env.KOSMORA_MEDIA_LIVE_REPORT_DIR;
  if (!directory || !isAbsolute(directory))
    throw Error("ABSOLUTE_PRIVATE_REPORT_DIRECTORY_REQUIRED");
  const wavPath = env.KOSMORA_MEDIA_LIVE_WAV_PATH;
  if (maximum === 3 && (!wavPath || !isAbsolute(wavPath)))
    throw Error("SPOKEN_WAV_FIXTURE_REQUIRED_FOR_STT");
  return { origin: origin.origin, token, directory, maximum, wavPath };
}

const digest = (value) => createHash("sha256").update(value).digest("hex");
const isId = (value) =>
  typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);

async function readBounded(response, maximum, signal) {
  if (!response.body) throw Error("EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > maximum) throw Error("RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function runMediaAcceptance({
  env = process.env,
  argv = process.argv.slice(2),
  fetchImpl = fetch,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  const config = mediaAcceptanceConfig(env, argv);
  let audio;
  if (config.maximum === 3) {
    const info = lstatSync(config.wavPath);
    if (!info.isFile() || info.size > 1_500_000) throw Error("INVALID_SPOKEN_WAV_FIXTURE");
    audio = readFileSync(config.wavPath);
    if (
      audio.length < 44 ||
      audio.toString("ascii", 0, 4) !== "RIFF" ||
      audio.toString("ascii", 8, 12) !== "WAVE"
    )
      throw Error("INVALID_SPOKEN_WAV_FIXTURE");
  }
  mkdirSync(config.directory, { recursive: true, mode: 0o700 });
  if (!lstatSync(config.directory).isDirectory() || lstatSync(config.directory).isSymbolicLink())
    throw Error("UNSAFE_REPORT_DIRECTORY");
  const privateDirectory = join(config.directory, `media-${randomUUID()}`);
  mkdirSync(privateDirectory, { mode: 0o700 });
  const reportPath = join(privateDirectory, "report.json");
  const report = {
    schema: "kosmora-media-live-acceptance-v2",
    started_at: new Date().toISOString(),
    completed_at: null,
    origin: config.origin,
    maximum_operations: config.maximum,
    dispatch_attempts: 0,
    outcome: "pending",
    provider_invoice_reconciled: false,
    operations: []
  };
  const save = () =>
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  const request = async (path, payload, binary = false) => {
    const signal = AbortSignal.timeout(15_000);
    const response = await fetchImpl(`${config.origin}${path}`, {
      method: payload ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(payload
          ? { "Content-Type": "application/json", "X-Kosmora-Media-Consent": "explicit" }
          : {})
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      redirect: "error",
      credentials: "omit",
      signal
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw Error(`HTTP_${response.status}`);
    }
    const bytes = await readBounded(response, binary ? 16 * 1024 * 1024 : 256 * 1024, signal);
    return binary
      ? { bytes, mime: response.headers.get("content-type")?.split(";")[0] }
      : JSON.parse(bytes.toString("utf8"));
  };
  const steps = [
    {
      kind: "image",
      capability: "image_generation",
      path: "images",
      body: {
        prompt: "A monochrome geometric moon",
        size: "1024x1024",
        quality: "low",
        format: "png"
      }
    },
    {
      kind: "speech",
      capability: "speech",
      path: "speech",
      body: { text: "Kosmora media acceptance check.", voice: "alloy", format: "mp3" }
    },
    {
      kind: "transcription",
      capability: "transcription",
      path: "transcriptions",
      body: { mime: "audio/wav", audio_base64: audio?.toString("base64"), language: "ru" }
    }
  ].slice(0, config.maximum);
  try {
    save();
    const capabilities = await request("/api/v1/media/capabilities");
    if (steps.some((step) => capabilities.capabilities?.[step.capability]?.ready !== true))
      throw Error("REQUESTED_CAPABILITY_UNAVAILABLE");
    for (const step of steps) {
      const entry = {
        kind: step.kind,
        client_request_id: `acceptance-${randomUUID()}`,
        operation_id: null,
        status: "outcome_unknown",
        budget_state: null,
        usage: null,
        verified_download: false
      };
      report.operations.push(entry);
      report.dispatch_attempts++;
      save();
      // Exactly one POST per planned operation. Unknown outcomes stop the entire run.
      const queued = await request(`/api/v1/media/${step.path}`, {
        ...step.body,
        explicit_paid_consent: true,
        client_request_id: entry.client_request_id
      });
      if (!isId(queued.id)) throw Error("INVALID_OPERATION_ID");
      entry.operation_id = queued.id;
      save();
      const deadline = Date.now() + 65_000;
      let settled;
      while (Date.now() < deadline) {
        const job = await request(`/api/v1/media/jobs/${queued.id}`);
        if (job.id !== queued.id || job.kind !== step.kind)
          throw Error("OPERATION_IDENTITY_MISMATCH");
        if (["done", "failed", "cancelled"].includes(job.status)) {
          settled = job;
          break;
        }
        await pause(1000);
      }
      if (!settled) throw Error("POLL_TIMEOUT_OUTCOME_UNKNOWN");
      entry.status = settled.status;
      entry.budget_state = ["none", "reserved", "reconciled", "uncertain"].includes(
        settled.budget_state
      )
        ? settled.budget_state
        : null;
      const usage = settled.usage;
      if (
        usage?.source === "provider" &&
        [usage.input_tokens, usage.output_tokens, usage.total_tokens].every(
          (n) => Number.isSafeInteger(n) && n >= 0
        ) &&
        usage.input_tokens + usage.output_tokens === usage.total_tokens
      )
        entry.usage = {
          source: "provider",
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          total_tokens: usage.total_tokens
        };
      save();
      if (settled.status !== "done") throw Error("OPERATION_NOT_COMPLETED");
      if (step.kind === "transcription") {
        if (typeof settled.transcript !== "string" || !settled.transcript.trim())
          throw Error("EMPTY_TRANSCRIPT");
        entry.transcript_characters = settled.transcript.length;
      } else {
        const asset = await request(
          `/api/v1/media/assets/${queued.id}?download=1`,
          undefined,
          true
        );
        if (
          !/^[a-f0-9]{64}$/.test(settled.asset?.sha256 ?? "") ||
          digest(asset.bytes) !== settled.asset.sha256 ||
          asset.bytes.length !== settled.asset.bytes ||
          asset.mime !== settled.asset.mime
        )
          throw Error("ASSET_VERIFICATION_FAILED");
        entry.verified_download = true;
        entry.asset_sha256 = settled.asset.sha256;
        entry.asset_bytes = asset.bytes.length;
        entry.asset_mime = asset.mime;
      }
      save();
    }
    report.outcome = "passed";
  } catch {
    // Do not echo arbitrary upstream text, request bodies, credentials or recordings.
    report.outcome = report.dispatch_attempts ? "failed_or_outcome_unknown" : "preflight_failed";
  } finally {
    report.completed_at = new Date().toISOString();
    save();
  }
  return { reportPath, passed: report.outcome === "passed" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runMediaAcceptance();
    process.stdout.write(
      `Media acceptance ${result.passed ? "passed" : "incomplete"}. Report: ${result.reportPath}\n`
    );
    if (!result.passed) process.exitCode = 1;
  } catch {
    process.stderr.write(
      "Media acceptance did not start. Requires explicit CLI and environment confirmation, owner token, valid API origin and private report directory. No automatic retries.\n"
    );
    process.exitCode = 1;
  }
}
