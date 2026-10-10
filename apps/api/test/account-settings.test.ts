import { openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  AccountStore,
  PreferenceConflictError,
  QuotaExceededError
} from "../src/account-settings/account-store.js";

const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
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
describe("owner account settings", () => {
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
