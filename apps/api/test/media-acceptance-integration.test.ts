/* eslint-disable @typescript-eslint/require-await -- Async deterministic media and budget fixtures. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import {
  OpenAIMediaAdapter,
  MediaCapabilityRegistry,
  validateImageParameters,
  validateSpeechParameters,
  estimateWavDurationSeconds
} from "@cosmora/model-gateway";
import { MediaService, type MediaAdapter } from "../src/media/media-service.js";
import { registerMediaRoutes } from "../src/media/media-routes.js";
import { pcmWav } from "./fixtures/media.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5d8AAAAASUVORK5CYII=",
  "base64"
);
const paths: string[] = [];
const services: MediaService[] = [];
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), "kosmora-media-integration-"));
  paths.push(path);
  return path;
};
const fixture: MediaAdapter = {
  generateImage: async () => ({ bytes: png, mime: "image/png", extension: "png" }),
  speak: async () => ({ bytes: pcmWav(), mime: "audio/wav", extension: "wav" }),
  transcribe: async () => "fixture transcription"
};
const budget = () => ({
  reserve: vi.fn(async () => {}),
  reconcile: vi.fn(async () => {}),
  uncertain: vi.fn(async () => {})
});
function create(options: ConstructorParameters<typeof MediaService>[0] = {}) {
  const service = new MediaService({
    directory: directory(),
    paidEnabled: true,
    adapter: fixture,
    ownerBudget: budget(),
    ...options
  });
  services.push(service);
  return service;
}
async function settle(service: MediaService, id: string, owner = "alice") {
  await vi.waitFor(() => expect(service.get(id, owner)?.status).toMatch(/done|failed|cancelled/));
  return service.get(id, owner)!;
}
afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("reviewed Gemini media integration", () => {
  it("validates geometry honestly and supports provider opus rather than nonexistent ogg output option", () => {
    const registry = new MediaCapabilityRegistry();
    expect(
      validateImageParameters(registry.route("image_generation"), { aspect_ratio: "3:2" }).size
    ).toBe("1536x1024");
    for (const value of [
      { aspect_ratio: "16:9" },
      { size: "1024x1024", aspect_ratio: "3:2" },
      { count: 2 },
      { reference_image_url: "https://example.com/a.png" }
    ])
      expect(() => validateImageParameters(registry.route("image_generation"), value)).toThrow();
    expect(
      validateSpeechParameters(registry.route("speech"), { format: "opus", speed: 1.5 }).format
    ).toBe("opus");
    expect(() => validateSpeechParameters(registry.route("speech"), { format: "ogg" })).toThrow();
  });
  it("rejects bad options before reserving, creating files or dispatching", () => {
    const ownerBudget = budget();
    const dispatch = vi.fn((...args: Parameters<MediaAdapter["generateImage"]>) =>
      fixture.generateImage(...args)
    );
    const path = directory();
    const service = create({
      directory: path,
      ownerBudget,
      adapter: { ...fixture, generateImage: dispatch }
    });
    expect(() =>
      service.enqueue("alice", "image", "moon", true, { aspect_ratio: "16:9" })
    ).toThrow();
    expect(() => service.enqueue("alice", "speech", "hello", true, { speed: 5 })).toThrow();
    expect(ownerBudget.reserve).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(readdirSync(path)).toEqual([]);
  });
  it("deduplicates concurrent and restarted requests, rejects changed input and isolates owners", async () => {
    const path = directory();
    const ownerBudget = budget();
    const dispatch = vi.fn((...args: Parameters<MediaAdapter["generateImage"]>) =>
      fixture.generateImage(...args)
    );
    const options = {
      directory: path,
      ownerBudget,
      adapter: { ...fixture, generateImage: dispatch }
    };
    const service = create(options);
    const first = service.enqueue("alice", "image", "moon", true, {
      client_request_id: "stable-id"
    });
    expect(
      service.enqueue("alice", "image", "moon", true, { client_request_id: "stable-id" }).id
    ).toBe(first.id);
    expect(() =>
      service.enqueue("alice", "image", "sun", true, { client_request_id: "stable-id" })
    ).toThrow("IDEMPOTENCY_CONFLICT");
    await settle(service, first.id);
    service.stop();
    const restart = create(options);
    expect(
      restart.enqueue("alice", "image", "moon", true, { client_request_id: "stable-id" }).id
    ).toBe(first.id);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(ownerBudget.reserve).toHaveBeenCalledTimes(1);
    const foreign = restart.enqueue("bob", "image", "moon", true, {
      client_request_id: "stable-id"
    });
    await settle(restart, foreign.id, "bob");
    expect(foreign.id).not.toBe(first.id);
    expect(restart.asset(first.id, "bob")).toBeNull();
  });
  it("preserves editing and includes references in idempotency fingerprints without persisting images", async () => {
    const editImage = vi.fn(async () => ({
      bytes: png,
      mime: "image/png" as const,
      extension: "png" as const
    }));
    const path = directory();
    const service = create({
      directory: path,
      imageEditingEnabled: true,
      adapter: { ...fixture, editImage }
    });
    const references = [
      {
        kind: "image" as const,
        name: "moon.png",
        media_type: "image/png" as const,
        data_base64: png.toString("base64")
      }
    ];
    const job = service.enqueue(
      "alice",
      "image",
      "edit",
      true,
      { client_request_id: "edit-id" },
      references
    );
    await settle(service, job.id);
    expect(editImage).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(path, `${job.id}.json`), "utf8")).not.toContain(
      png.toString("base64")
    );
    expect(() =>
      service.enqueue("alice", "image", "edit", true, { client_request_id: "edit-id" })
    ).toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("enforces WAV duration even with intervening chunks and invalid headers", async () => {
    expect(estimateWavDurationSeconds(pcmWav(61, true))).toBe(61);
    const service = create();
    expect(() =>
      service.enqueueTranscription("alice", pcmWav(61, true), "audio/wav", true, {
        duration_seconds: 1
      })
    ).toThrow("AUDIO_DURATION_INVALID");
    expect(() =>
      service.enqueueTranscription("alice", Buffer.from("RIFFexample"), "audio/wav", true)
    ).toThrow("AUDIO_FORMAT_INVALID");
    const job = service.enqueueTranscription("alice", pcmWav(0.2, true), "audio/wav", true, {
      language: "ru",
      client_request_id: "stt-id"
    });
    expect((await settle(service, job.id)).transcript).toBe("fixture transcription");
  });
  it("times out uncooperative work promptly but keeps its concurrency slot and never commits late bytes", async () => {
    let finish!: (value: Awaited<ReturnType<MediaAdapter["generateImage"]>>) => void;
    const ownerBudget = budget();
    const service = create({
      executionTimeoutMs: 10,
      ownerBudget,
      adapter: {
        ...fixture,
        generateImage: () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      }
    });
    const job = service.enqueue("alice", "image", "moon", true);
    expect(await settle(service, job.id)).toMatchObject({
      status: "failed",
      error_code: "timeout",
      budget_state: "reserved"
    });
    expect(() => service.enqueue("alice", "image", "another", true)).toThrow("MEDIA_BUSY");
    finish(await fixture.generateImage("", "gpt-image-1", new AbortController().signal));
    await vi.waitFor(() => expect(ownerBudget.uncertain).toHaveBeenCalled());
    expect(service.asset(job.id, "alice")).toBeNull();
    expect(service.get(job.id, "alice")).toMatchObject({
      status: "failed",
      error_code: "timeout",
      budget_state: "uncertain"
    });
  });
  it("does not reclassify user cancellation as timeout and stops emergency work", async () => {
    let finish!: (value: Awaited<ReturnType<MediaAdapter["generateImage"]>>) => void;
    let emergency = false;
    const service = create({
      executionTimeoutMs: 25,
      emergencyStopped: () => emergency,
      adapter: {
        ...fixture,
        generateImage: () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      }
    });
    const job = service.enqueue("alice", "image", "moon", true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(finish).toBeTypeOf("function");
    service.cancel(job.id, "alice");
    await new Promise((resolve) => setTimeout(resolve, 30));
    finish(await fixture.generateImage("", "gpt-image-1", new AbortController().signal));
    expect((await settle(service, job.id)).status).toBe("cancelled");
    const stopped = create({
      emergencyStopped: () => emergency,
      adapter: {
        ...fixture,
        generateImage: () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      }
    });
    const second = stopped.enqueue("bob", "image", "moon", true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    emergency = true;
    expect(await settle(stopped, second.id, "bob")).toMatchObject({
      status: "failed",
      error_code: "EMERGENCY_STOP"
    });
    finish(await fixture.generateImage("", "gpt-image-1", new AbortController().signal));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  it("validates stored content on download and keeps legacy jobs readable", async () => {
    const path = directory();
    const service = create({ directory: path });
    const job = service.enqueue("alice", "image", "moon", true);
    await settle(service, job.id);
    expect(service.asset(job.id, "alice")?.bytes).toEqual(png);
    writeFileSync(join(path, `${job.id}.png`), Buffer.alloc(png.length));
    expect(service.asset(job.id, "alice")).toBeNull();
    expect(await service.delete(job.id, "bob")).toBe(false);
    expect(await service.delete(job.id, "alice")).toBe(true);
  });
  it("serves parameters and stable request IDs through the owner HTTP boundary without cached private metadata", async () => {
    const service = create();
    const app = Fastify();
    registerMediaRoutes(
      app,
      service,
      (request) =>
        ({ owner_id: request.headers.authorization === "Bearer bob" ? "bob" : "alice" }) as never
    );
    const headers = { "x-kosmora-media-consent": "explicit", "idempotency-key": "http-id" };
    try {
      const payload = {
        prompt: "moon",
        explicit_paid_consent: true,
        size: "1536x1024",
        quality: "medium"
      };
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/media/images",
        headers,
        payload
      });
      expect(first.statusCode).toBe(202);
      const id = first.json<{ id: string }>().id;
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/media/images",
        headers,
        payload
      });
      expect(second.json<{ id: string }>().id).toBe(id);
      await settle(service, id);
      expect(
        (
          await app.inject({
            url: `/api/v1/media/assets/${id}`,
            headers: { authorization: "Bearer bob" }
          })
        ).statusCode
      ).toBe(404);
      const conflict = await app.inject({
        method: "POST",
        url: "/api/v1/media/images",
        headers,
        payload: { ...payload, client_request_id: "different" }
      });
      expect(conflict.statusCode).toBe(400);
      const status = await app.inject({ url: `/api/v1/media/jobs/${id}` });
      expect(status.headers["cache-control"]).toBe("private, no-store");
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/media/images",
            headers,
            payload: { ...payload, prompt: "sun" }
          })
        ).statusCode
      ).toBe(409);
    } finally {
      await app.close();
    }
  });
});

describe("media adapter protocol fixtures", () => {
  it.each([
    [401, "invalid_key"],
    [402, "insufficient_funds"],
    [404, "capability_unavailable"],
    [429, "rate_limit"],
    [504, "timeout"]
  ])("normalizes HTTP %i without echoing provider text or retrying", async (status, code) => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { message: "private prompt and credential" } }), {
          status: Number(status)
        })
    );
    const adapter = new OpenAIMediaAdapter("fixture-only", fetchImpl);
    await expect(
      adapter.generateImage("moon", "gpt-image-1", new AbortController().signal)
    ).rejects.toMatchObject({ normalizedCode: code });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("retains configured proxy origin, forwards real image parameters and rejects arbitrary result URLs without fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }))
    );
    const adapter = new OpenAIMediaAdapter(
      "fixture-only",
      fetchImpl,
      "https://ru.cheapvibecode.ru/v1"
    );
    await adapter.generateImage("moon", "gpt-image-1", new AbortController().signal, {
      size: "1536x1024",
      quality: "high"
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://ru.cheapvibecode.ru/v1/images/generations");
    expect(JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      size: "1536x1024",
      quality: "high"
    });
    const remote = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ url: "https://public.example/private.png" }] }))
    );
    await expect(
      new OpenAIMediaAdapter("fixture-only", remote).generateImage(
        "moon",
        "gpt-image-1",
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "INVALID_ASSET" });
    expect(remote).toHaveBeenCalledTimes(1);
  });
  it("passes TTS opus, voice and speed and persists the actual Ogg container type", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(Buffer.from("OggSfixture-opus"), { headers: { "content-type": "audio/ogg" } })
    );
    const binary = await new OpenAIMediaAdapter("fixture-only", fetchImpl).speak(
      "hello",
      "gpt-4o-mini-tts",
      new AbortController().signal,
      { voice: "coral", format: "opus", speed: 1.5 }
    );
    expect(binary).toMatchObject({ mime: "audio/ogg", extension: "ogg" });
    expect(JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      response_format: "opus",
      voice: "coral",
      speed: 1.5
    });
  });
  it("bounds streams after headers, propagates timeout and cancellation and never accepts a mismatched image format", async () => {
    const cancel = vi.fn();
    const stalled: typeof fetch = async () => new Response(new ReadableStream({ cancel }));
    await expect(
      new OpenAIMediaAdapter("fixture-only", stalled, undefined, 10).generateImage(
        "moon",
        "gpt-image-1",
        new AbortController().signal
      )
    ).rejects.toMatchObject({ normalizedCode: "timeout" });
    expect(cancel).toHaveBeenCalled();
    const controller = new AbortController();
    const pending = new OpenAIMediaAdapter("fixture-only", stalled).speak(
      "hello",
      "gpt-4o-mini-tts",
      controller.signal
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ normalizedCode: "aborted" });
    const adapter = new OpenAIMediaAdapter(
      "fixture-only",
      async () => new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }))
    );
    await expect(
      adapter.generateImage("moon", "gpt-image-1", new AbortController().signal, { format: "jpeg" })
    ).rejects.toMatchObject({ normalizedCode: "invalid_mime" });
  });
});
