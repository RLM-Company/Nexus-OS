import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import { ElevenLabsMediaAdapter } from "@cosmora/model-gateway";
import { buildApp } from "../src/app.js";
import { StaticIdentityResolver } from "../src/identity.js";
import { MediaService } from "../src/media/media-service.js";
import type { MediaJob } from "../src/media/media-store.js";

const mp3 = readFileSync(new URL("./fixtures/studio-effect.mp3", import.meta.url));
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
