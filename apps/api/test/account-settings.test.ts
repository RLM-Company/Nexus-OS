import { openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAccountRoutes } from "../src/account-settings/routes.js";
import { LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";
import {
  AccountStore,
  PreferenceConflictError,
  QuotaExceededError
} from "../src/account-settings/account-store.js";

const dbs: ReturnType<typeof openDatabase>[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});
const fixture = async () => {
  const db = openDatabase(":memory:");
  dbs.push(db);
  await runMigrations(db);
  const store = new AccountStore(db.sqlite);
  store.migrate();
  const timestamp = "2026-10-10T00:00:00.000Z";
  db.sqlite
    .prepare("INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run("c1", "owner", "hello", timestamp, timestamp);
  db.sqlite
    .prepare("INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run("c2", "other", "private", timestamp, timestamp);
  return store;
};
const preferenceUpdate = {
  expected_version: 0,
  relay_enabled: true,
  response_language: "ru" as const,
  optimize_for: "balanced" as const,
  preferred_provider: null,
  preferred_model: null,
  chat_style: "standard" as const,
  max_total_tokens: 1000
};
const routeFixture = async () => {
  const store = await fixture();
  const app = Fastify();
  apps.push(app);
  registerAccountRoutes(
    app,
    store,
    () => ({ ...LOCAL_DEVELOPMENT_IDENTITY, owner_id: "owner", actor_id: "owner" }),
    { provider: "verified-provider", model: "verified-model", capabilities: { streaming: true } }
  );
  return { app, store };
};
describe("owner account settings", () => {
  it("accepts real HTTP updates with null model defaults without coercing them to strings", async () => {
    const { app, store } = await routeFixture();
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/personal-settings",
      payload: { ...preferenceUpdate, max_total_tokens: null }
    });
    expect(response.statusCode).toBe(200);
    expect(store.get("owner")).toMatchObject({
      version: 1,
      relay_enabled: true,
      preferred_provider: null,
      preferred_model: null,
      max_total_tokens: null
    });
  });
  it("selects a verified route, then restores the default while preserving Relay and version checks", async () => {
    const { app, store } = await routeFixture();
    const selected = await app.inject({
      method: "PUT",
      url: "/api/v1/personal-settings",
      payload: {
        ...preferenceUpdate,
        preferred_provider: "verified-provider",
        preferred_model: "verified-model"
      }
    });
    expect(selected.statusCode).toBe(200);
    const restored = await app.inject({
      method: "PUT",
      url: "/api/v1/personal-settings",
      payload: { ...preferenceUpdate, expected_version: 1 }
    });
    expect(restored.statusCode).toBe(200);
    expect(store.get("owner")).toMatchObject({
      version: 2,
      preferred_provider: null,
      preferred_model: null,
      relay_enabled: true
    });
    const stale = await app.inject({
      method: "PUT",
      url: "/api/v1/personal-settings",
      payload: preferenceUpdate
    });
    expect(stale.statusCode).toBe(409);
  });
  it("rejects unsupported models and incorrectly typed account settings without writing preferences", async () => {
    const { app, store } = await routeFixture();
    for (const payload of [
      { ...preferenceUpdate, preferred_provider: "unknown", preferred_model: "unknown" },
      { ...preferenceUpdate, preferred_provider: "verified-provider", preferred_model: null },
      { ...preferenceUpdate, preferred_provider: "", preferred_model: "" },
      { ...preferenceUpdate, relay_enabled: "true" },
      { ...preferenceUpdate, expected_version: "0" }
    ]) {
      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/personal-settings",
        payload
      });
      expect(response.statusCode).toBe(400);
    }
    expect(store.get("owner").version).toBe(0);
  });
  it("clears a nullable chat override through HTTP rather than coercing null to false", async () => {
    const { app, store } = await routeFixture();
    store.update("owner", preferenceUpdate);
    store.setChatRelay("owner", "c1", false);
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/personal-settings/chats/c1",
      payload: { relay_enabled: null }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ relay_enabled: true, override: null });
    expect(store.chatRelayOverride("owner", "c1")).toBeNull();
  });
  it("starts with relay off, persists and locks optimistic versions", async () => {
    const store = await fixture();
    expect(store.get("owner").relay_enabled).toBe(false);
    expect(store.update("owner", preferenceUpdate).version).toBe(1);
    expect(store.get("owner").relay_enabled).toBe(true);
    expect(() => store.update("owner", preferenceUpdate)).toThrow(PreferenceConflictError);
  });
  it("isolates chat preferences between owners", async () => {
    const store = await fixture();
    store.setChatRelay("owner", "c1", true);
    expect(store.getRelay("owner", "c1")).toBe(true);
    expect(() => store.setChatRelay("other", "c1", false)).toThrow();
  });
  it("atomically refuses reservations beyond the configured quota", async () => {
    const store = await fixture();
    store.update("owner", preferenceUpdate);
    const id = store.reserve("owner", "run-1", 0, 900, "to_en", "c1", "provider", "model");
    expect(() =>
      store.reserve("owner", "run-2", 0, 200, "to_en", "c1", "provider", "model")
    ).toThrow(QuotaExceededError);
    store.completeReservation(id, "to_en", 20, 10);
    expect(store.summary("owner").translation_tokens_or_upper_bound).toBe(30);
  });
  it("blocks direct deletion and keeps both owners' data", async () => {
    const store = await fixture();
    const confirm = store.createDeleteChallenge("owner");
    expect(() =>
      store.deleteData("owner", confirm.confirmation_token, "УДАЛИТЬ МОИ ДАННЫЕ")
    ).toThrow(/OwnerPrivacyCoordinator/);
    expect(
      store.sqlite.prepare("SELECT count(*) n FROM general_chats WHERE owner_id='owner'").get()
    ).toEqual({ n: 1 });
    expect(
      store.sqlite.prepare("SELECT count(*) n FROM general_chats WHERE owner_id='other'").get()
    ).toEqual({ n: 1 });
  });
});
