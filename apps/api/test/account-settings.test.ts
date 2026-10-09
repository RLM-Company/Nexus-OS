import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  AccountStore,
  PreferenceConflictError,
  QuotaExceededError
} from "../src/account-settings/account-store.js";

const dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
const fixture = () => {
  const db = new DatabaseSync(":memory:");
  dbs.push(db);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE general_chats(id TEXT PRIMARY KEY,owner_id TEXT,title TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT,title TEXT);
    CREATE TABLE general_chat_runs(id TEXT PRIMARY KEY,chat_id TEXT,status TEXT);
    CREATE TABLE general_chat_messages(id TEXT PRIMARY KEY,chat_id TEXT,content TEXT);
    CREATE TABLE general_chat_model_usage(chat_id TEXT,run_id TEXT,attempt INTEGER,provider_id TEXT,model_requested TEXT,status TEXT,actual_input_tokens INTEGER,actual_output_tokens INTEGER,estimated_input_tokens INTEGER,max_output_tokens INTEGER,calculated_cost_amount REAL,currency TEXT,created_at TEXT);
    CREATE TABLE model_usage_ledger(project_id TEXT,run_id TEXT,attempt INTEGER,provider_id TEXT,model_requested TEXT,status TEXT,actual_input_tokens INTEGER,actual_output_tokens INTEGER,estimated_input_tokens INTEGER,max_output_tokens INTEGER,calculated_cost_amount REAL,currency TEXT,created_at TEXT);
    CREATE TABLE chats(id TEXT,project_id TEXT); CREATE TABLE messages(id TEXT,project_id TEXT);
    CREATE TABLE runs(id TEXT,project_id TEXT,status TEXT); CREATE TABLE project_materials(project_id TEXT);
    CREATE TABLE manager_work(id TEXT,project_id TEXT,owner_id TEXT); CREATE TABLE manager_work_files(execution_id TEXT);
    CREATE TABLE github_change_drafts(id TEXT,owner_id TEXT);`);
  const store = new AccountStore(db);
  store.migrate();
  db.prepare("INSERT INTO general_chats(id,owner_id,title) VALUES(?,?,?)").run(
    "c1",
    "owner",
    "hello"
  );
  db.prepare("INSERT INTO general_chats(id,owner_id,title) VALUES(?,?,?)").run(
    "c2",
    "other",
    "private"
  );
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
  it("starts with relay off, persists and locks optimistic versions", () => {
    const store = fixture();
    expect(store.get("owner").relay_enabled).toBe(false);
    expect(store.update("owner", preferenceUpdate).version).toBe(1);
    expect(store.get("owner").relay_enabled).toBe(true);
    expect(() => store.update("owner", preferenceUpdate)).toThrow(PreferenceConflictError);
  });
  it("isolates chat preferences between owners", () => {
    const store = fixture();
    store.setChatRelay("owner", "c1", true);
    expect(store.getRelay("owner", "c1")).toBe(true);
    expect(() => store.setChatRelay("other", "c1", false)).toThrow();
  });
  it("atomically refuses reservations beyond the configured quota", () => {
    const store = fixture();
    store.update("owner", preferenceUpdate);
    const id = store.reserve("owner", "run-1", 0, 900, "to_en", "c1", "provider", "model");
    expect(() =>
      store.reserve("owner", "run-2", 0, 200, "to_en", "c1", "provider", "model")
    ).toThrow(QuotaExceededError);
    store.completeReservation(id, "to_en", 20, 10);
    expect(store.summary("owner").translation_tokens_or_upper_bound).toBe(30);
  });
  it("keeps other owners' chats when owner confirms deletion", () => {
    const store = fixture();
    const confirm = store.createDeleteChallenge("owner");
    expect(() => store.deleteData("owner", "invalid", "УДАЛИТЬ МОИ ДАННЫЕ")).toThrow();
    store.deleteData("owner", confirm.confirmation_token, "УДАЛИТЬ МОИ ДАННЫЕ");
    expect(
      store.sqlite.prepare("SELECT count(*) n FROM general_chats WHERE owner_id='owner'").get()
    ).toEqual({ n: 0 });
    expect(
      store.sqlite.prepare("SELECT count(*) n FROM general_chats WHERE owner_id='other'").get()
    ).toEqual({ n: 1 });
  });
  it("counts a canonical main request once even while its independent hold survives", () => {
    const store = fixture();
    store.update("owner", preferenceUpdate);
    store.reserve("owner", "run-main", 1, 500, "main", "c1", "provider", "model");
    store.sqlite
      .prepare(
        `INSERT INTO general_chat_model_usage(chat_id,run_id,attempt,status,actual_input_tokens,actual_output_tokens,estimated_input_tokens,max_output_tokens) VALUES('c1','run-main',1,'committed',20,10,100,400)`
      )
      .run();
    expect(store.summary("owner").total_counted_tokens).toBe(30);
    expect(store.summary("owner").in_flight_or_uncertain_holds).toBe(0);
    expect(() =>
      store.reserve("owner", "run-translation", 1, 970, "from_en", "c1", "provider", "model")
    ).not.toThrow();
    expect(() =>
      store.reserve("owner", "next-run", 1, 1, "main", "c1", "provider", "model")
    ).toThrow(QuotaExceededError);
  });
});
