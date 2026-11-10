import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { CreateManagerWork, ManagerWork } from "@cosmora/contracts";
import {
  ManagerWorkConflict,
  ManagerWorkStore,
  openDatabase,
  runMigrations
} from "../src/index.js";

/** Owner acceptance of a finished result: one immutable record, no file changes. */
describe("manager work result acceptance", () => {
  let db: ReturnType<typeof openDatabase>, store: ManagerWorkStore;
  const at = "2026-11-08T10:00:00.000Z";
  const request: CreateManagerWork = {
    client_request_id: "req-1",
    goal: "Собрать отчёт по заявке 00123",
    worker_role: "analyst",
    max_model_requests: 2,
    max_input_tokens: 20_000,
    max_output_tokens: 4_000
  };

  const insertWork = (overrides: Partial<ManagerWork> = {}): ManagerWork => {
    const work: ManagerWork = {
      id: "w1",
      project_id: "p1",
      owner_id: "a",
      actor_id: "a",
      request,
      status: "completed",
      stage: "done",
      version: 7,
      pause_requested: false,
      approved: false,
      inflight_run_id: null,
      model_requests: 2,
      reserved_input_tokens: 2000,
      reserved_output_tokens: 400,
      plan: null,
      draft: null,
      review: null,
      confirmation_id: null,
      error_code: null,
      events: [{ sequence: 1, stage: "plan", message: "Задача принята", at }],
      created_at: at,
      updated_at: at,
      ...overrides
    };
    db.sqlite
      .prepare(
        "INSERT INTO manager_work (id, project_id, owner_id, client_request_id, version, state_json) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        work.id,
        work.project_id,
        work.owner_id,
        request.client_request_id,
        work.version,
        JSON.stringify(work)
      );
    return work;
  };

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    store = new ManagerWorkStore(db.sqlite);
    db.sqlite
      .prepare(
        "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES('p1','a','P1','ACTIVE',?,?)"
      )
      .run(at, at);
    db.sqlite
      .prepare("INSERT INTO chats(id,project_id,kind,created_at) VALUES('c-p1','p1','main',?)")
      .run(at);
  });
  afterEach(() => db.close());

  it("accepts a finished result once and keeps the first author and time", () => {
    insertWork();
    const accepted = store.acceptResult("w1", "a", "owner-a", 7);
    expect(accepted.result_accepted_at).toBeTruthy();
    expect(accepted.result_accepted_by).toBe("owner-a");
    expect(accepted.version).toBe(8);
    expect(accepted.events.at(-1)?.message).toBe("Результат принят владельцем");
    expect(accepted.status).toBe("completed");

    const repeated = store.acceptResult("w1", "a", "someone-else", 8);
    expect(repeated.result_accepted_at).toBe(accepted.result_accepted_at);
    expect(repeated.result_accepted_by).toBe("owner-a");
    expect(repeated.version).toBe(8);
    expect(repeated.events).toHaveLength(accepted.events.length);
    const stored = JSON.parse(
      (db.sqlite.prepare("SELECT state_json FROM manager_work").get() as { state_json: string })
        .state_json
    ) as { result_accepted_by?: string };
    expect(stored.result_accepted_by).toBe("owner-a");
  });

  it("refuses an unfinished result, a stale version and a foreign owner", () => {
    insertWork({ status: "running", stage: "publish" });
    expect(() => store.acceptResult("w1", "a", "owner-a", 7)).toThrow("WORK_RESULT_NOT_READY");
    db.sqlite.prepare("DELETE FROM manager_work").run();
    insertWork();
    expect(() => store.acceptResult("w1", "a", "owner-a", 6)).toThrow("STALE_WORK");
    expect(() => store.acceptResult("w1", "b", "owner-b", 7)).toThrow("WORK_NOT_FOUND");
    expect(() => store.acceptResult("missing", "a", "owner-a", 1)).toThrow("WORK_NOT_FOUND");
  });

  it("blocks acceptance while the owner data is fenced", () => {
    insertWork();
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('a',1,'deleting','d',?,?)"
      )
      .run(at, at);
    expect(() => store.acceptResult("w1", "a", "owner-a", 7)).toThrow("OWNER_DATA_FENCED");
    expect(() => store.acceptResult("w1", "a", "owner-a", 7)).toThrow(ManagerWorkConflict);
  });
});
