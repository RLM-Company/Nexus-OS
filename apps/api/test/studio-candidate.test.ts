import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import { OpenAIMediaAdapter } from "@cosmora/model-gateway";
import type { StudioStoryboard } from "@cosmora/contracts";
import { buildApp } from "../src/app.js";
import { StaticIdentityResolver } from "../src/identity.js";
import { MediaService } from "../src/media/media-service.js";
import type { MediaJob } from "../src/media/media-store.js";
import { pcmWav } from "./fixtures/media.js";

const red = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64"
);
const blue = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC",
  "base64"
);
const prefix = "/api/v1/media";
const config = loadServerConfig({ NODE_ENV: "test" });
const folders: string[] = [];
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function appFor(owner: string, mediaService: MediaService) {
  const app = buildApp({
    config,
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
  apps.push(app);
  return app;
}

const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), "nexus-studio-candidate-"));
  folders.push(directory);
  return directory;
};
const binaryResponse = (bytes: Buffer) =>
  Response.json({ data: [{ b64_json: bytes.toString("base64") }] });
const consent = { "x-kosmora-media-consent": "explicit" };
async function settled(app: ReturnType<typeof appFor>, id: string) {
  return vi.waitFor(async () => {
    const row = await app.inject(prefix + "/jobs/" + id);
    const job = row.json<MediaJob>();
    expect(job.status).toMatch(/done|cancelled|failed/);
    return job;
  });
}

it("edits the exact stored image through the existing provider endpoint, preserves both versions and replays after restart", async () => {
  const requests: string[] = [];
  let release: (() => void) | undefined;
  const providerFetch: typeof fetch = async (request, init) => {
    const url =
      typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    requests.push(url);
    if (url.endsWith("/images/generations")) return binaryResponse(red);
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    const source = form.get("image");
    expect(source).toBeInstanceOf(Blob);
    expect(Buffer.from(await (source as Blob).arrayBuffer())).toEqual(red);
    expect(form.get("quality")).toBe("medium");
    if (form.get("prompt") === "late fixture")
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return binaryResponse(blue);
  };
  const directory = temporary();
  const options = {
    directory,
    paidEnabled: true,
    imageEditingEnabled: true,
    adapter: new OpenAIMediaAdapter("unit-fixture", providerFetch),
    ownerBudget: {
      reserve: () => Promise.resolve(),
      reconcile: () => Promise.resolve(),
      uncertain: () => Promise.resolve()
    }
  };
  let service = new MediaService(options);
  let owner = appFor("alice", service);
  const outsider = appFor("bob", service);
  const post = (
    app: ReturnType<typeof appFor>,
    prompt: string,
    client_request_id: string,
    source_job_id?: string
  ) =>
    app.inject({
      method: "POST",
      url: prefix + "/images",
      headers: consent,
      payload: {
        prompt,
        client_request_id,
        ...(source_job_id ? { source_job_id, quality: "medium" } : {}),
        explicit_paid_consent: true
      }
    });
  const root = await post(owner, "red pixel", "fixture-root");
  expect(root.statusCode, root.body).toBe(202);
  const source = root.json<MediaJob>().id;
  expect((await settled(owner, source)).status).toBe("done");
  const denied = await post(outsider, "blue pixel", "fixture-denied", source);
  expect(denied.statusCode).toBe(404);
  expect((await outsider.inject(prefix + "/assets/" + source)).statusCode).toBe(404);
  const created = await post(owner, "blue pixel", "fixture-edit", source);
  expect(created.statusCode, created.body).toBe(202);
  const edit = created.json<MediaJob>().id;
  expect((await settled(owner, edit)).parameters).toMatchObject({ source_job_id: source });
  expect((await owner.inject(prefix + "/assets/" + source)).rawPayload).toEqual(red);
  expect((await owner.inject(prefix + "/assets/" + edit + "?download=1")).rawPayload).toEqual(blue);
  const slow = (await post(owner, "late fixture", "fixture-late", source)).json<MediaJob>().id;
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await owner.inject({ method: "DELETE", url: prefix + "/jobs/" + slow });
  release?.();
  expect((await settled(owner, slow)).status).toBe("cancelled");
  expect((await owner.inject(prefix + "/assets/" + slow)).statusCode).toBe(404);

  service.stop();
  service = new MediaService(options);
  owner = appFor("alice", service);
  expect((await post(owner, "blue pixel", "fixture-edit", source)).json<MediaJob>().id).toBe(edit);
  expect((await post(owner, "changed", "fixture-edit", source)).statusCode).toBe(409);
  expect((await owner.inject(prefix + "/assets/" + source)).rawPayload).toEqual(red);
  expect((await owner.inject(prefix + "/jobs/" + edit)).json<MediaJob>().parameters).toMatchObject({
    source_job_id: source
  });
  expect(requests).toHaveLength(3);
});

it("serves speech options and actual byte ranges through the owner route, and keeps unsupported modes unavailable", async () => {
  const bytes = pcmWav();
  const fetcher: typeof fetch = (request, init) => {
    expect(request).toBe("https://api.openai.com/v1/audio/speech");
    expect(typeof init?.body).toBe("string");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      input: "Проверочный текст",
      voice: "nova",
      speed: 1.5,
      response_format: "wav"
    });
    return Promise.resolve(
      new Response(Uint8Array.from(bytes), { headers: { "content-type": "audio/wav" } })
    );
  };
  const service = new MediaService({
    directory: temporary(),
    paidEnabled: true,
    adapter: new OpenAIMediaAdapter("unit-fixture", fetcher),
    ownerBudget: {
      reserve: () => Promise.resolve(),
      reconcile: () => Promise.resolve(),
      uncertain: () => Promise.resolve()
    }
  });
  const owner = appFor("alice", service);
  const outsider = appFor("bob", service);
  expect((await owner.inject(prefix + "/capabilities")).json()).toMatchObject({
    capabilities: {
      video_generation: { ready: false },
      video_scene_regeneration: { ready: false },
      music_generation: { ready: false },
      sound_effects: { ready: false },
      image_region_editing: { ready: false }
    }
  });
  const response = await owner.inject({
    method: "POST",
    url: prefix + "/speech",
    headers: consent,
    payload: {
      explicit_paid_consent: true,
      text: "Проверочный текст",
      voice: "nova",
      speed: 1.5,
      format: "wav"
    }
  });
  expect(response.statusCode).toBe(202);
  const id = response.json<MediaJob>().id;
  expect((await settled(owner, id)).status).toBe("done");
  const url = prefix + "/assets/" + id;
  const part = await owner.inject({ url, headers: { range: "bytes=0-11" } });
  expect(part.statusCode).toBe(206);
  expect(part.headers["content-range"]).toBe(`bytes 0-11/${bytes.length}`);
  expect(part.rawPayload).toEqual(bytes.subarray(0, 12));
  const suffix = await owner.inject({ url, headers: { range: "bytes=-8" } });
  expect(suffix.rawPayload).toEqual(bytes.subarray(-8));
  expect((await owner.inject({ url, headers: { range: "bytes=999999-" } })).statusCode).toBe(416);
  expect((await outsider.inject({ url, headers: { range: "bytes=0-1" } })).statusCode).toBe(404);
  expect((await owner.inject(url + "?download=1")).rawPayload).toEqual(bytes);
});

it("versions text-only stories, restores the accepted scene and includes it in the owner lifecycle", async () => {
  const directory = temporary();
  const service = new MediaService({ directory });
  const owner = appFor("alice", service);
  const outsider = appFor("bob", service);
  const url = prefix + "/storyboard";
  const set = (
    expected_version: number,
    body: Record<string, unknown>,
    operation_id = randomUUID()
  ) => owner.inject({ method: "PUT", url, payload: { ...body, expected_version, operation_id } });
  const added = await set(0, { action: "add", description: "Первая сцена", duration_seconds: 5 });
  expect(added.statusCode, added.body).toBe(200);
  const first = added.json<StudioStoryboard>().scenes[0]!;
  const accepted = await set(1, { action: "accept", scene_id: first.id, revision: 1 });
  expect(accepted.statusCode, accepted.body).toBe(200);
  const second = (
    await set(2, { action: "add", description: "Другая сцена", duration_seconds: 10 })
  ).json<StudioStoryboard>().scenes[1]!;
  const op = randomUUID();
  const change = {
    action: "revise",
    scene_id: second.id,
    description: "Правка второй сцены",
    duration_seconds: 15
  };
  const saved = await set(3, change, op);
  expect(saved.statusCode, saved.body).toBe(200);
  expect((await set(3, change, op)).body).toBe(saved.body);
  expect((await set(3, { ...change, duration_seconds: 5 }, op)).statusCode).toBe(409);
  expect((await set(2, change)).statusCode).toBe(409);
  const reopened = new MediaService({ directory });
  const restored = await appFor("alice", reopened).inject(url + "?download=1");
  expect(restored.headers["content-disposition"]).toContain("storyboard.json");
  const state = restored.json<StudioStoryboard>();
  expect(state.scenes[0]).toEqual({ ...first, accepted_version: 1 });
  expect(state.scenes[1]?.revisions.map((item) => item.duration_seconds)).toEqual([10, 15]);
  expect((await outsider.inject(url)).json<StudioStoryboard>().scenes).toEqual([]);
  expect(reopened.exportOwner("alice").storyboard).toEqual(state);
  await reopened.deleteOwner("alice");
  reopened.resume("alice");
  expect(reopened.storyboard("alice").scenes).toEqual([]);
});
