import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleDriveConnectStart, IdentityContext } from "@cosmora/contracts";
import { loadServerConfig } from "@cosmora/config";
import { openDatabase, runMigrations } from "@cosmora/db";
import { buildApp } from "../src/app.js";
import { LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";
import { configuredGoogleDrive } from "../src/cloud-storage/google-drive-runtime.js";
import { DRIVE_FILE_SCOPE } from "../src/cloud-storage/google-drive.js";
import { safeDriveLogUrl } from "../src/cloud-storage/google-drive-routes.js";
import { googleDrivePrivacyAdapter } from "../src/cloud-storage/google-drive-privacy.js";
import { OwnerPrivacyCoordinator } from "../src/account-settings/privacy/coordinator.js";

const origin = "https://kosmora.example",
  base = "/api/v1/storage/drive";
const env = {
  KOSMORA_DRIVE_ENABLED: "1",
  KOSMORA_DRIVE_CLIENT_ID: "fixture.apps.googleusercontent.com",
  KOSMORA_DRIVE_CLIENT_SECRET: "fixture-client-secret",
  KOSMORA_DRIVE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
};
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("owner-only Drive connection API", () => {
  let db: ReturnType<typeof openDatabase>,
    app: ReturnType<typeof buildApp>,
    runtime: ReturnType<typeof configuredGoogleDrive>;
  let identity: IdentityContext | null,
    tokenCalls: number,
    folderWrites: number,
    folders: Map<string, object>;
  let failFolder: boolean,
    tokenGate: Promise<void> | undefined,
    tokenStarted: ReturnType<typeof deferred>;
  const request = vi.fn<typeof fetch>();
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    identity = LOCAL_DEVELOPMENT_IDENTITY;
    tokenCalls = 0;
    folderWrites = 0;
    folders = new Map();
    failFolder = false;
    tokenGate = undefined;
    tokenStarted = deferred();
    request.mockReset().mockImplementation((input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      );
      if (url.hostname === "oauth2.googleapis.com") {
        tokenCalls++;
        tokenStarted.resolve();
        return (tokenGate ?? Promise.resolve()).then(() =>
          json({
            access_token: "fixture-access-token",
            refresh_token: "fixture-refresh-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: DRIVE_FILE_SCOPE
          })
        );
      }
      if (url.pathname.endsWith("generateIds"))
        return Promise.resolve(json({ ids: ["folder_google_123"] }));
      if (init?.method === "POST") {
        folderWrites++;
        if (failFolder) return Promise.reject(Error("network private-error"));
        const data = JSON.parse(init.body as string) as { id: string };
        folders.set(data.id, { ...data, trashed: false });
        return Promise.resolve(json({ id: data.id }));
      }
      const data = folders.get(url.pathname.split("/").at(-1)!);
      return Promise.resolve(json(data ?? {}, data ? 200 : 404));
    });
    runtime = configuredGoogleDrive(db.sqlite, origin, env, request);
    app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test", WEB_ORIGIN: origin }),
      database: db,
      identityResolver: { resolve: () => Promise.resolve(identity) },
      googleDrive: runtime
    });
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });
  const post = (path: string, payload: object = {}, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: base + path, payload, headers: { origin, ...headers } });
  const begin = async () => {
    const r = await post("/connect");
    expect(r.statusCode).toBe(200);
    return r.json<GoogleDriveConnectStart>();
  };
  const finish = (start: GoogleDriveConnectStart, extra: object = {}) =>
    post("/finish", { state: start.state, proof: start.proof, code: "fixture-code", ...extra });

  it("connects without relying on cookies and never exposes provider credentials", async () => {
    const start = await begin();
    expect(new URL(start.authorization_url).searchParams.get("scope")).toBe(DRIVE_FILE_SCOPE);
    expect(start.authorization_url).not.toContain("secret");
    const callback = await app.inject({
      url: `${base}/callback?state=${start.state}&code=fixture-code&authuser=0&scope=unused`
    });
    expect(callback.statusCode).toBe(303);
    expect(tokenCalls).toBe(0);
    const target = new URL(callback.headers.location!);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe("/personal-settings");
    expect(target.search).toBe("");
    expect(target.hash).toContain("drive_code=fixture-code");
    const completed = await finish(start);
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      state: "connected",
      result: "connected",
      can_disconnect: true
    });
    expect(completed.body).not.toMatch(
      /fixture-access-token|fixture-refresh-token|ciphertext|folder_google/
    );
    expect(tokenCalls).toBe(1);
    expect(folderWrites).toBe(1);
    const status = await app.inject({ url: base });
    expect(status.json()).toMatchObject({
      configured: true,
      state: "connected",
      archive_count: 0,
      pending_count: 0
    });
    expect(status.headers["cache-control"]).toBe("private, no-store");
    expect(status.headers["referrer-policy"]).toBe("no-referrer");
    expect((await finish(start)).statusCode).toBe(400);
    expect(tokenCalls).toBe(1);
    expect((await post("/disconnect")).json()).toMatchObject({
      state: "disconnected",
      can_disconnect: false
    });
    expect(runtime.store.status("local-owner")?.connection_id).toBeNull();
  });

  it("rejects a copied callback from a different tab unless the original browser proof is presented", async () => {
    const start = await begin();
    const bad = await finish(start, { proof: "x".repeat(43) });
    expect(bad.statusCode).toBe(400);
    expect(tokenCalls).toBe(0);
    expect((await finish(start)).statusCode).toBe(200);
  });

  it.each(["owner", "session"])("rejects a different %s before token exchange", async (kind) => {
    const start = await begin();
    identity = {
      ...LOCAL_DEVELOPMENT_IDENTITY,
      ...(kind === "owner"
        ? { owner_id: "other-owner", actor_id: "other-owner" }
        : { session_id: "other-session" })
    };
    expect((await finish(start)).statusCode).toBe(400);
    expect(tokenCalls).toBe(0);
    identity = LOCAL_DEVELOPMENT_IDENTITY;
    expect((await finish(start)).statusCode).toBe(200);
  });

  it("handles denial and rejects malformed input without spending the valid state", async () => {
    const start = await begin();
    expect((await post("/finish", { state: start.state, proof: start.proof })).statusCode).toBe(
      400
    );
    const r = await post("/finish", { state: start.state, proof: start.proof, denied: true });
    expect(r.json()).toMatchObject({ result: "cancelled", state: "disconnected" });
    expect(tokenCalls).toBe(0);
  });

  it("requires owner authority and the configured browser Origin on mutations", async () => {
    expect((await post("/connect", {}, { origin: "https://evil.example" })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: "POST", url: base + "/connect", payload: {} })).statusCode
    ).toBe(403);
    identity = null;
    expect((await app.inject({ url: base })).statusCode).toBe(401);
    identity = { ...LOCAL_DEVELOPMENT_IDENTITY, actor_kind: "agent" };
    expect((await post("/connect")).statusCode).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });

  it("disconnect cancels a pending flow and does not exchange its late code", async () => {
    const start = await begin();
    await post("/disconnect");
    expect((await finish(start)).statusCode).toBe(400);
    expect(tokenCalls).toBe(0);
  });

  it("cannot persist credentials after disconnect during the token exchange", async () => {
    const start = await begin(),
      gate = deferred();
    tokenGate = gate.promise;
    const completing = finish(start);
    await tokenStarted.promise;
    const disconnected = post("/disconnect");
    await vi.waitFor(() =>
      expect(runtime.store.status("local-owner")?.revision).toBeGreaterThan(0)
    );
    gate.resolve();
    expect((await completing).statusCode).not.toBe(200);
    expect((await disconnected).statusCode).toBe(200);
    expect(runtime.store.status("local-owner")?.connection_id).toBeNull();
    expect(folderWrites).toBe(0);
  });

  it("shows a saved but unverified connection honestly after a folder failure", async () => {
    const start = await begin();
    failFolder = true;
    const r = await finish(start);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ result: "pending", state: "preparing", can_retry: true });
    expect((await post("/check")).statusCode).toBe(502);
    expect(folderWrites).toBe(1);
    failFolder = false;
    expect((await post("/retry-folder")).json()).toMatchObject({ state: "connected" });
    expect(folderWrites).toBe(2);
  });

  it("drains OAuth exchange before privacy export and rejects the stale ticket after resume", async () => {
    const start = await begin(),
      gate = deferred();
    tokenGate = gate.promise;
    const completing = finish(start);
    await tokenStarted.promise;
    const privacy = new OwnerPrivacyCoordinator(db.sqlite, {
      required: ["account-core", "cloud-storage"]
    });
    privacy.register({
      id: "account-core",
      quiesce: (_owner, epoch) => Promise.resolve({ drained: true, fence_epoch: epoch }),
      export: () => Promise.resolve({ complete: true, records: {}, originals: [] }),
      delete: () => Promise.resolve({ deleted_records: 0 })
    });
    privacy.register(googleDrivePrivacyAdapter(db.sqlite, runtime.connection!));
    const quiesce = vi.spyOn(runtime.connection!, "quiesce");
    const exported = privacy.export("local-owner");
    await vi.waitFor(() => expect(quiesce).toHaveBeenCalledWith("local-owner"));
    gate.resolve();
    expect((await completing).statusCode).toBe(409);
    const snapshot = await exported;
    expect(JSON.stringify(snapshot)).not.toMatch(/fixture-access-token|fixture-refresh-token/);
    expect(runtime.store.status("local-owner")?.connection_id).toBeNull();
    expect(folderWrites).toBe(0);
    tokenGate = undefined;
    expect((await finish(await begin())).statusCode).toBe(200);
  });

  it("disables the connector without config but still permits removal of saved credentials", async () => {
    await finish(await begin());
    await app.close();
    const disabled = configuredGoogleDrive(db.sqlite, origin, {}, request);
    app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test", WEB_ORIGIN: origin }),
      database: db,
      googleDrive: disabled
    });
    expect((await app.inject({ url: base })).json()).toMatchObject({
      configured: false,
      state: "unavailable",
      can_disconnect: true
    });
    expect((await post("/connect")).statusCode).toBe(503);
    expect((await post("/disconnect")).json()).toMatchObject({ can_disconnect: false });
  });

  it.each(["http://kosmora.example", "https://169.40.37.32", "https://user:pass@kosmora.example"])(
    "fails closed for unsupported origin %s",
    (webOrigin) => {
      expect(() => configuredGoogleDrive(db.sqlite, webOrigin, env, request)).toThrow(
        "DRIVE_OAUTH_CONFIGURATION_REQUIRED"
      );
    }
  );

  it("rejects malformed deployment keys and scrubs callback query parameters from logs", () => {
    expect(() =>
      configuredGoogleDrive(
        db.sqlite,
        origin,
        { ...env, KOSMORA_DRIVE_ENCRYPTION_KEY: "bad-key" },
        request
      )
    ).toThrow("DRIVE_OAUTH_CONFIGURATION_REQUIRED");
    expect(safeDriveLogUrl(base + "/callback?code=private&state=private")).toBe(base + "/callback");
  });
});
