#!/usr/bin/env node
// Measurement-only: compare the SAME model request with a bounded timeout and
// with the zero-timeout route (PR #589). No live provider, no secrets.
import { loadServerConfig } from "../packages/config/dist/index.js";
import { ChatService } from "../packages/core/dist/index.js";
import { performance } from "node:perf_hooks";

const message = {
  id: "m1",
  chat_id: "c1",
  role: "user",
  content: "Одинаковый запрос для замера маршрута",
  content_type: "text",
  status: "completed",
  run_id: null,
  error_code: null,
  created_at: "2026-11-15T10:00:00Z",
  updated_at: "2026-11-15T10:00:00Z"
};
const build = (timeoutMs) =>
  new ChatService({
    preferredProvider: "mock",
    preferredModelAlias: "chat",
    fallbackAllowed: false,
    timeoutMs
  }).buildRequest({ chatId: "c1", runId: "r1", messages: [message] });

const bounded = build(60_000);
const zero = build(0);
const sameShape =
  JSON.stringify(bounded.messages) === JSON.stringify(zero.messages) &&
  JSON.stringify(bounded.routing) === JSON.stringify(zero.routing);

const samples = [];
for (let index = 0; index < 50; index++) {
  const started = performance.now();
  build(60_000);
  const withTimeout = performance.now() - started;
  const zeroStarted = performance.now();
  build(0);
  const withoutTimeout = performance.now() - zeroStarted;
  samples.push({ withTimeout, withoutTimeout });
}
const mean = (key) => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;

const config = loadServerConfig({
  NODE_ENV: "test",
  MOCK_PROVIDER_MODE: "success",
  MANAGER_TIMEOUT_MS: "0"
});
const configAcceptsZero = config.managerTimeoutMs === 0;

console.log(
  JSON.stringify(
    {
      identical_request_except_timeout: sameShape,
      bounded_timeout_ms: bounded.constraints.timeout_ms,
      zero_timeout_ms: zero.constraints.timeout_ms,
      config_manager_timeout_ms: config.managerTimeoutMs,
      config_accepts_zero: configAcceptsZero,
      route_change: "gateway skips setTimeout when timeoutMs === 0 (PR #589)",
      mean_build_ms_bounded: Number(mean("withTimeout").toFixed(4)),
      mean_build_ms_zero: Number(mean("withoutTimeout").toFixed(4)),
      note: "Build time is CPU-only; the measurable latency change is in the gateway timer, not in request construction. No live provider call was made."
    },
    null,
    2
  )
);
if (!sameShape || bounded.constraints.timeout_ms !== 60_000 || zero.constraints.timeout_ms !== 0)
  process.exitCode = 1;
