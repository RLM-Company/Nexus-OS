import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AccountMediaBudget } from "../src/media/account-media-budget.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import { runChatStudio } from "../src/media/chat-studio.js";
import { GeneralChatRuntimeStore } from "../src/general-chat-runtime-store.js";
import { GeneralChatBackgroundRunCoordinator } from "../src/general-chat-background-run-coordinator.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { RuntimeMetrics } from "../src/operations.js";
import { openDatabase, runMigrations } from "@cosmora/db";
import { loadServerConfig } from "@cosmora/config";
import { ElevenLabsMediaAdapter, GeminiVideoMediaAdapter } from "@cosmora/model-gateway";
import { buildApp } from "../src/app.js";
import { StaticIdentityResolver } from "../src/identity.js";
import { MediaService } from "../src/media/media-service.js";
import type { MediaJob } from "../src/media/media-store.js";

const mp3 = readFileSync(new URL("./fixtures/studio-effect.mp3", import.meta.url));
const mp4 = readFileSync(new URL("./fixtures/studio-clip.mp4", import.meta.url));
const appInstances: ReturnType<typeof buildApp>[] = [];
const directories: string[] = [];
const prefix = "/api/v1/media";
const ownerBudget = {
  reserve: vi.fn(() => Promise.resolve()),
  reconcile: vi.fn(() => Promise.resolve()),
  uncertain: vi.fn(() => Promise.resolve())
};
afterEach(async () => {
  for (const app of appInstances.splice(0)) await app.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

function owned(owner: string, mediaService: MediaService) {
  const app = buildApp({
    config: loadServerConfig({ NODE_ENV: "test" }),
    database: { ping: () => undefined },
    mediaService,
    identityResolver: new StaticIdentityResolver({
      owner_id: owner,
      actor_id: owner,
      actor_kind: "owner",
      session_id: owner,
      assurance: "local",
      authenticated_at: new Date().toISOString(),
      expires_at: "9999-12-31T23:59:59.999Z"
    })
  });
  appInstances.push(app);
  return app;
}
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-studio-creative-"));
  directories.push(dir);
  return dir;
};
function post(app: ReturnType<typeof owned>, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: prefix + "/creative-audio",
    headers: { "x-kosmora-media-consent": "explicit" },
    payload: { explicit_paid_consent: true, ...body }
  });
}
function settle(app: ReturnType<typeof owned>, id: string) {
  return vi.waitFor(async () => {
    const item = (await app.inject(prefix + "/jobs/" + id)).json<MediaJob>();
    expect(item.status).toMatch(/done|failed|cancelled/);
    return item;
  });
}

it("sends separate SFX and music contracts and preserves verified MP3 bytes, owner scope and request identity", async () => {
  const requests: unknown[] = [];
  const adapter = new ElevenLabsMediaAdapter("fixture-only", (input, request) => {
    expect(input).toMatch(
      /^https:\/\/api\.elevenlabs\.io\/v1\/(music|sound-generation)\?output_format=mp3_44100_128$/
    );
    expect(request).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
    requests.push(JSON.parse(request?.body as string) as unknown);
    return Promise.resolve(
      new Response(Uint8Array.from(mp3), { headers: { "content-type": "audio/mpeg" } })
    );
  });
  const options = { directory: temp(), paidEnabled: true, ownerBudget, creativeAudio: adapter };
  const media = new MediaService(options);
  const account = owned("owner-a", media);
  const stranger = owned("owner-b", media);
  const effect = {
    kind: "sfx",
    prompt: "A soft rustle",
    duration_seconds: 1,
    client_request_id: "fixture-effect"
  };
  const started = await post(account, effect);
  expect(started.statusCode, started.body).toBe(202);
  const id = started.json<MediaJob>().id;
  expect(await settle(account, id)).toMatchObject({
    status: "done",
    budget_state: "uncertain",
    provider: "elevenlabs"
  });
  const music = {
    kind: "music",
    prompt: "Short ambient motif",
    duration_seconds: 3,
    instrumental: true,
    client_request_id: "fixture-music"
  };
  const next = await post(account, music);
  expect(next.statusCode, next.body).toBe(202);
  const track = next.json<MediaJob>().id;
  expect((await settle(account, track)).status).toBe("done");
  expect(requests).toEqual([
    { text: "A soft rustle", duration_seconds: 1, model_id: "eleven_text_to_sound_v2" },
    {
      prompt: "Short ambient motif",
      music_length_ms: 3000,
      force_instrumental: true,
      model_id: "music_v1"
    }
  ]);
  expect(ownerBudget.reserve).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerId: "owner-a",
      operationId: id,
      kind: "sfx",
      provider: "elevenlabs"
    })
  );
  expect((await stranger.inject(prefix + "/assets/" + id)).statusCode).toBe(404);
  const bytes = await account.inject(prefix + "/assets/" + id + "?download=1");
  expect(bytes.rawPayload).toEqual(mp3);
  expect(
    (await account.inject({ url: prefix + "/assets/" + id, headers: { range: "bytes=0-15" } }))
      .rawPayload
  ).toEqual(mp3.subarray(0, 16));
  const restored = owned("owner-a", new MediaService(options));
  expect((await post(restored, music)).json<MediaJob>().id).toBe(track);
  expect((await post(restored, { ...music, duration_seconds: 4 })).statusCode).toBe(409);
  expect((await restored.inject(prefix + "/jobs/" + id)).json<MediaJob>().asset?.sha256).toBe(
    createHash("sha256").update(mp3).digest("hex")
  );
  expect(requests).toHaveLength(2);
});

it("rejects unknown input and late cancelled results, and fails closed on invalid MP3", async () => {
  let finish: (() => void) | undefined;
  let calls = 0;
  const adapter = new ElevenLabsMediaAdapter("fixture-only", () => {
    calls++;
    if (calls === 1)
      return new Promise((resolve) => {
        finish = () =>
          resolve(
            new Response(Uint8Array.from(mp3), { headers: { "content-type": "audio/mpeg" } })
          );
      });
    return Promise.resolve(new Response("not MP3", { headers: { "content-type": "audio/mpeg" } }));
  });
  const app = owned(
    "owner-a",
    new MediaService({ directory: temp(), paidEnabled: true, ownerBudget, creativeAudio: adapter })
  );
  const body = {
    kind: "sfx",
    prompt: "Rustle",
    duration_seconds: 1,
    client_request_id: "late-sound"
  };
  expect((await post(app, { ...body, explicit_paid_consent: false })).statusCode).toBe(403);
  expect((await post(app, { ...body, duration_seconds: 99 })).statusCode).toBe(400);
  const job = (await post(app, body)).json<MediaJob>();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await app.inject({ method: "DELETE", url: prefix + "/jobs/" + job.id });
  finish?.();
  expect((await settle(app, job.id)).status).toBe("cancelled");
  expect((await app.inject(prefix + "/assets/" + job.id)).statusCode).toBe(404);
  await vi.waitFor(() => expect(ownerBudget.uncertain).toHaveBeenCalled());
  const corrupt = await post(app, { ...body, client_request_id: "corrupt-sound" });
  expect(corrupt.statusCode).toBe(202);
  expect(await settle(app, corrupt.json<MediaJob>().id)).toMatchObject({
    status: "failed",
    error_code: "corrupt_response"
  });
  expect(calls).toBe(2);
});

it("creates independently downloadable clips for immutable storyboard versions", async () => {
  const calls: unknown[] = [];
  const adapter = new GeminiVideoMediaAdapter("fixture-project", "fixture-only", (url, request) => {
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1beta1/projects/fixture-project/locations/global/interactions"
    );
    expect(request).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
    calls.push(JSON.parse(request?.body as string) as unknown);
    return Promise.resolve(
      Response.json({
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [{ type: "video", mime_type: "video/mp4", data: mp4.toString("base64") }]
          }
        ]
      })
    );
  });
  const options = { directory: temp(), paidEnabled: true, ownerBudget, video: adapter };
  const service = new MediaService(options);
  const app = owned("owner-a", service);
  const stranger = owned("owner-b", service);
  const board = await app.inject({
    method: "PUT",
    url: prefix + "/storyboard",
    payload: {
      action: "add",
      expected_version: 0,
      operation_id: "292db926-60d5-4a2f-b9ac-25282db181d6",
      description: "First scene",
      duration_seconds: 5
    }
  });
  expect(board.statusCode, board.body).toBe(200);
  const id = board.json<{ scenes: { id: string }[] }>().scenes[0]!.id;
  const payload = {
    scene: { id, version: 1 },
    prompt: "First scene",
    duration_seconds: 5,
    aspect_ratio: "16:9",
    explicit_paid_consent: true,
    client_request_id: "video-scene-1"
  };
  function request(target: ReturnType<typeof owned>, input = payload) {
    return target.inject({
      method: "POST",
      url: prefix + "/video",
      headers: { "x-kosmora-media-consent": "explicit" },
      payload: input
    });
  }
  expect((await request(stranger)).statusCode).toBe(404);
  expect((await request(app, { ...payload, prompt: "Changed draft" })).statusCode).toBe(409);
  expect(calls).toHaveLength(0);
  const start = await request(app);
  expect(start.statusCode, start.body).toBe(202);
  const job = start.json<MediaJob>();
  expect(await settle(app, job.id)).toMatchObject({
    kind: "video",
    status: "done",
    provider: "google-cloud",
    asset: { mime: "video/mp4", sha256: createHash("sha256").update(mp4).digest("hex") },
    parameters: { scene_id: id, scene_version: 1 }
  });
  const changed = service.storyboard("owner-a", {
    action: "revise",
    expected_version: 1,
    scene_id: id,
    operation_id: "5c0712bd-b255-4a4a-b027-c74a0589b73a",
    description: "Revised scene",
    duration_seconds: 10
  });
  expect(changed.scenes[0]?.revisions).toHaveLength(2);
  const revised = await request(app, {
    ...payload,
    scene: { id, version: 2 },
    prompt: "Revised scene",
    duration_seconds: 10,
    aspect_ratio: "9:16",
    client_request_id: "video-scene-2"
  });
  expect(revised.statusCode, revised.body).toBe(202);
  expect(await settle(app, revised.json<MediaJob>().id)).toMatchObject({
    status: "done",
    parameters: { scene_version: 2 }
  });
  expect(calls).toEqual([
    {
      model: "gemini-omni-1.2-flash",
      store: false,
      input: [{ type: "text", text: "First scene" }],
      response_format: [
        {
          type: "video",
          delivery: "inline",
          aspect_ratio: "16:9",
          resolution: "360p",
          duration: "5s"
        }
      ],
      generation_config: { video_config: { task: "text_to_video" } }
    },
    expect.objectContaining({
      input: [{ type: "text", text: "Revised scene" }],
      response_format: [
        {
          type: "video",
          delivery: "inline",
          aspect_ratio: "9:16",
          resolution: "360p",
          duration: "10s"
        }
      ]
    })
  ]);
  const reopened = owned("owner-a", new MediaService(options));
  expect((await request(reopened)).json<MediaJob>().id).toBe(job.id);
  expect(calls).toHaveLength(2);
  const asset = prefix + "/assets/" + job.id;
  expect((await stranger.inject(asset)).statusCode).toBe(404);
  const download = await reopened.inject(asset + "?download=1");
  expect(download.rawPayload).toEqual(mp4);
  expect(download.headers["content-disposition"]).toMatch(/attachment;.*mp4/);
  const ranged = await reopened.inject({ url: asset, headers: { range: "bytes=8-31" } });
  expect(ranged.statusCode).toBe(206);
  expect(ranged.rawPayload).toEqual(mp4.subarray(8, 32));
  expect(
    (await reopened.inject({ url: asset, headers: { range: "bytes=0-2,3-4" } })).statusCode
  ).toBe(416);
});

it("refuses remote URLs, corrupt containers and timeout outcomes without resubmitting", async () => {
  const fixtures = [
    Response.json({
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [
            { type: "video", mime_type: "video/mp4", uri: "https://untrusted.example/video.mp4" }
          ]
        }
      ]
    }),
    Response.json({
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [
            { type: "video", mime_type: "video/mp4", data: mp4.subarray(0, 32).toString("base64") }
          ]
        }
      ]
    }),
    new Response(null, { status: 504 })
  ];
  const transport = vi.fn(() => Promise.resolve(fixtures.shift()!));
  const app = owned(
    "owner-a",
    new MediaService({
      directory: temp(),
      ownerBudget,
      paidEnabled: true,
      video: new GeminiVideoMediaAdapter("fixture-project", "fixture-only", transport)
    })
  );
  for (const [index, code] of ["corrupt_response", "corrupt_response", "timeout"].entries()) {
    const options = {
      method: "POST" as const,
      url: prefix + "/video",
      headers: { "x-kosmora-media-consent": "explicit" },
      payload: {
        prompt: "A clip",
        aspect_ratio: "16:9",
        duration_seconds: 3,
        explicit_paid_consent: true,
        client_request_id: `bad-video-${index}`
      }
    };
    const result = await app.inject(options);
    expect(result.statusCode, result.body).toBe(202);
    const { id } = result.json<MediaJob>();
    expect(await settle(app, id)).toMatchObject({
      status: "failed",
      error_code: code,
      asset: null
    });
    expect((await app.inject(options)).json<MediaJob>().id).toBe(id);
    expect(transport).toHaveBeenCalledTimes(index + 1);
  }
});

it("writes one owned media file into a durable chat reply only on a confirmed Studio command", async () => {
  const database = openDatabase(":memory:");
  await runMigrations(database);
  const config = loadServerConfig({ NODE_ENV: "test" });
  const runtime = await buildModelRuntime(config);
  const store = new GeneralChatRuntimeStore(database.sqlite);
  const account = new AccountStore(database.sqlite);
  account.migrate();
  const generate = vi.fn(() =>
    Promise.resolve({
      bytes: mp4,
      mime: "video/mp4" as const,
      extension: "mp4" as const
    })
  );
  const mediaService = new MediaService({
    directory: temp(),
    paidEnabled: true,
    video: { generate },
    ownerBudget: new AccountMediaBudget(account, "fixture")
  });
  const metrics = new RuntimeMetrics();
  const coordinator = new GeneralChatBackgroundRunCoordinator({
    store,
    modelGateway: runtime.gateway,
    chat: runtime.chat,
    runtimeMetrics: metrics,
    studio: (owner, run, body, signal) => runChatStudio(mediaService, owner, run, body, signal),
    accountStore: account,
    pollIntervalMs: 10
  });
  const stream = vi.spyOn(runtime.gateway, "stream");
  const app = buildApp({
    database,
    config,
    generalChatStore: store,
    modelGateway: runtime.gateway,
    chat: runtime.chat,
    manager: runtime.manager,
    mediaService,
    runtimeMetrics: metrics,
    accountStore: account,
    generalChatRunExecutionMode: "background"
  });
  coordinator.start();
  try {
    const submit = async (initial_message: string, client_message_id: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/chats",
        payload: { initial_message, client_message_id }
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<{ run_id: string; stream_url: string }>();
    };
    const invalid = await submit("/studio video 5 16:9: A coast", "missing-consent");
    await app.inject(invalid.stream_url);
    expect(store.getAssistantMessage(invalid.run_id)?.error_code).toBe("STUDIO_COMMAND_INVALID");
    expect(generate).not.toHaveBeenCalled();
    const direct = await submit("/studio video 5 16:9 --paid: A coast", "approved-clip");
    const observers = await Promise.all([
      app.inject(direct.stream_url),
      app.inject(direct.stream_url)
    ]);
    expect(observers.every((observer) => observer.body.includes("event: run.completed"))).toBe(
      true
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]).toEqual(["A coast", 5, "16:9", expect.any(AbortSignal)]);
    expect(stream).not.toHaveBeenCalled();
    const job = mediaService.list("local-owner")[0]!;
    expect(job.client_request_id).toBe(`chat-studio:${direct.run_id}`);
    expect(store.getAssistantMessage(direct.run_id)?.content).toContain(
      `/api/v1/media/assets/${job.id}?download=1`
    );
    expect((await app.inject(prefix + "/assets/" + job.id)).rawPayload).toEqual(mp4);
    expect(mediaService.asset(job.id, "other-owner")).toBeNull();
  } finally {
    await coordinator.stop();
    await app.close();
    database.close();
  }
});
