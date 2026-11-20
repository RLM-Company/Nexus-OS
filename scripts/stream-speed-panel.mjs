#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { makeAdapter, measureStream, streamDiagnostic } from "./measure-stream-speed.mjs";

const { env } = process;
const port = Number(env.SPEED_PANEL_PORT ?? 4178);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port.");
const origin = `http://127.0.0.1:${port}`;
const modes = new Map();
const publicModes = [];

function register(id, label, settings) {
  const live = settings !== null;
  let adapter;
  try {
    adapter = makeAdapter(live, settings ?? {}, { allowLoopback: true });
    modes.set(id, adapter);
  } catch {
    // A missing configuration is visible in the UI and cannot trigger a fallback request.
  }
  publicModes.push({ id, label, model: adapter?.modelId ?? null, ready: Boolean(adapter), live });
}

register("fixture", "Фикстура", null);
register("baseline", "Обычный", env);
register("fast", "Быстрый", {
  MODEL_NAME: env.SPEED_FAST_MODEL,
  MODEL_BASE_URL: env.SPEED_FAST_BASE_URL ?? env.MODEL_BASE_URL,
  MODEL_API_KEY: env.SPEED_FAST_BASE_URL ? env.SPEED_FAST_API_KEY : env.MODEL_API_KEY
});
register("accelerated", "Разгон", {
  MODEL_NAME: env.SPEED_ACCEL_MODEL,
  MODEL_BASE_URL: env.SPEED_ACCEL_BASE_URL,
  MODEL_API_KEY: env.SPEED_ACCEL_API_KEY
});

const assets = new Map(
  await Promise.all(
    [
      ["/", "index.html", "text/html"],
      ["/panel.css", "panel.css", "text/css"],
      ["/panel.js", "panel.js", "text/javascript"]
    ].map(async ([url, name, mime]) => [
      url,
      { mime, body: await readFile(new URL(`./stream-speed-panel/${name}`, import.meta.url)) }
    ])
  )
);

async function readInput(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) return null;
    chunks.push(chunk);
  }
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return input &&
      typeof input.prompt === "string" &&
      input.prompt.trim() &&
      input.prompt.length <= 3_000 &&
      typeof input.mode === "string" &&
      Number.isInteger(input.maxTokens) &&
      input.maxTokens >= 8 &&
      input.maxTokens <= 2_048
      ? input
      : null;
  } catch {
    return null;
  }
}

let busy = false;
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'");
  if (request.headers.host !== `127.0.0.1:${port}`) {
    response.writeHead(403).end();
    return;
  }
  const asset = request.method === "GET" ? assets.get(request.url) : null;
  if (asset) {
    response.writeHead(200, { "Content-Type": `${asset.mime}; charset=utf-8` }).end(asset.body);
    return;
  }
  if (request.method === "GET" && request.url === "/api/modes") {
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(publicModes));
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/run") {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.origin !== origin || request.headers["content-type"] !== "application/json") {
    response.writeHead(403).end();
    return;
  }
  const input = await readInput(request).catch(() => null);
  const adapter = input && modes.get(input.mode);
  if (!adapter) {
    response.writeHead(400).end();
    return;
  }
  if (busy) {
    response.writeHead(409).end();
    return;
  }

  busy = true;
  const cancellation = new AbortController();
  response.once("close", () => cancellation.abort());
  response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
  response.flushHeaders();
  const emit = (data) => {
    if (!response.destroyed) response.write(`${JSON.stringify(data)}\n`);
  };
  try {
    const metrics = await measureStream(adapter, undefined, {
      prompt: input.prompt,
      maxOutputTokens: input.maxTokens,
      signal: cancellation.signal,
      onText: (text) => emit({ text })
    });
    emit({ metrics });
  } catch (error) {
    emit({ error: streamDiagnostic(error) });
  } finally {
    busy = false;
    response.end();
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Kosmora Stream Lab: ${origin}`));
