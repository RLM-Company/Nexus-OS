import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  EmergencyStopStore,
  GeneralChatStore
} from "@cosmora/db";
import { ProjectSourceStore } from "@cosmora/db";
import { buildApp } from "../src/app.js";
import type { IdentityContext, RunSourcesView, SourceExclusionsView } from "@cosmora/contracts";
import { StaticIdentityResolver } from "../src/identity.js";
import { loadServerConfig } from "@cosmora/config";

const owner: IdentityContext = {
  owner_id: "source-owner",
  actor_id: "source-owner",
  actor_kind: "owner",
  session_id: "source-session",
  assurance: "local",
  authenticated_at: "2026-11-25T00:00:00.000Z",
  expires_at: "9999-12-31T23:59:59.999Z"
};
const foreign: IdentityContext = { ...owner, owner_id: "other-owner", actor_id: "other-owner" };

let db: ReturnType<typeof openDatabase>;
let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;

beforeEach(async () => {
  db = openDatabase(":memory:");
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  projectId = projects.createProject("Source test", "source-test", owner.owner_id).project.id;
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  app = buildApp({
    config,
    database: db,
    projectStore: projects,
    emergencyStopStore: new EmergencyStopStore(db.sqlite),
    projectSourceStore: new ProjectSourceStore(db.sqlite),
    identityResolver: new StaticIdentityResolver(owner)
  });
});
afterEach(async () => {
  await app.close();
  db.close();
});

const source = (id: string, sha = "a".repeat(64)) => ({
  reference: `H:p:${id}`,
  kind: "history" as const,
  source_kind: "project_message" as const,
  source_id: id,
  version: 1,
  sha256: sha,
  quote: "Источник: 19 700 ₽",
  excerpt_only: false
});

describe("project source usage and exclusions", () => {
  it("records two runs and keeps the first receipt immutable after exclusion", async () => {
    const base = `/api/v1/projects/${projectId}/sources`;
    const first = await app.inject({
      method: "POST",
      url: `${base}/run`,
      payload: { run_id: "run-1", sources: [source("msg-a"), source("msg-b")] }
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<RunSourcesView>().sources).toHaveLength(2);

    const excluded = await app.inject({
      method: "PUT",
      url: `${base}/exclusions`,
      payload: {
        expected_version: 1,
        exclusions: [
          {
            source_kind: "project_message",
            source_id: "msg-a",
            excluded_at: "2026-11-25T00:00:00Z",
            reason: "Устаревший источник"
          }
        ]
      }
    });
    expect(excluded.statusCode, excluded.body).toBe(200);
    expect(excluded.json<SourceExclusionsView>().version).toBe(2);

    const second = await app.inject({
      method: "POST",
      url: `${base}/run`,
      payload: { run_id: "run-2", sources: [source("msg-b")] }
    });
    expect(second.statusCode).toBe(200);

    const historical = await app.inject({ method: "GET", url: `${base}/run/run-1` });
    expect(historical.statusCode).toBe(200);
    const body = historical.json<RunSourcesView>();
    expect(body.sources).toHaveLength(2);
    expect(body.excluded_now).toEqual(["msg-a"]);
    expect(body.sources[0]?.quote).toBe("Источник: 19 700 ₽");
    expect(second.json<RunSourcesView>().sources).toHaveLength(1);
  });

  it("refuses foreign owner and stale exclusion version", async () => {
    const base = `/api/v1/projects/${projectId}/sources`;
    const getForeign = buildApp({
      config: loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" }),
      database: db,
      projectStore: new ProjectStore(db.sqlite),
      projectSourceStore: new ProjectSourceStore(db.sqlite),
      identityResolver: new StaticIdentityResolver(foreign)
    });
    try {
      const denied = await getForeign.inject({ method: "GET", url: `${base}/exclusions` });
      expect(denied.statusCode).toBe(404);
      expect(denied.json()).toEqual({ error: { code: "PROJECT_NOT_FOUND" } });
    } finally {
      await getForeign.close();
    }
    const stale = await app.inject({
      method: "PUT",
      url: `${base}/exclusions`,
      payload: { expected_version: 99, exclusions: [] }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: { code: "SOURCE_EXCLUSIONS_VERSION_CONFLICT" } });
  });

  it("revoked file access cannot write a run receipt and does not rewrite history", () => {
    const store = new ProjectSourceStore(db.sqlite);
    store.recordRunSources(projectId, owner.owner_id, {
      run_id: "run-3",
      sources: [source("file-a")]
    });
    const at = new Date().toISOString();
    const lifecycle = db.sqlite.prepare(
      "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,?,?,?,?,?)"
    );
    lifecycle.run(owner.owner_id, 1, "deleting", "revoke-test", at, at);
    expect(() =>
      store.recordRunSources(projectId, owner.owner_id, {
        run_id: "run-4",
        sources: [source("file-b")]
      })
    ).toThrow("OWNER_DATA_FENCED");
    // Historical bytes remain in the table; the fence only blocks access.
    const raw = db.sqlite
      .prepare("SELECT sources_json FROM project_run_sources WHERE owner_id=? AND run_id=?")
      .get(owner.owner_id, "run-3") as { sources_json: string };
    expect((JSON.parse(raw.sources_json) as { source_id: string }[])[0]?.source_id).toBe("file-a");
    db.sqlite
      .prepare("DELETE FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .run(owner.owner_id);
    const historical = store.runSources(projectId, owner.owner_id, "run-3");
    expect(historical.sources[0]?.source_id).toBe("file-a");
  });

  it("delivers the exact fragment only while current access allows it", () => {
    const chats = new GeneralChatStore(db.sqlite);
    const accepted = chats.createChat("Бюджет 19 700 в чате", "source-grant-chat", owner.owner_id);
    chats.cancelRun(accepted.run.id);
    const reference = `H:g:${accepted.userMessage.id}`;
    const memory = chats.contextMemory;
    const store = new ProjectSourceStore(db.sqlite);
    store.recordRunSources(projectId, owner.owner_id, {
      run_id: "run-grant",
      sources: [{ ...source("msg-grant"), quote: "Бюджет 19 700" }]
    });
    // Owner data revoked: exact-fragment delivery is denied while history stays.
    const at = new Date().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,?,?,?,?,?)"
      )
      .run(owner.owner_id, 1, "deleting", "source-revoke-test", at, at);
    expect(() =>
      memory.sourceFor({ kind: "chat", id: accepted.chat.id }, owner.owner_id, reference, 0)
    ).toThrow("OWNER_DATA_FENCED");
    const raw = db.sqlite
      .prepare("SELECT sources_json FROM project_run_sources WHERE owner_id=? AND run_id=?")
      .get(owner.owner_id, "run-grant") as { sources_json: string };
    expect((JSON.parse(raw.sources_json) as { source_id: string }[])[0]?.source_id).toBe(
      "msg-grant"
    );
    db.sqlite
      .prepare("DELETE FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .run(owner.owner_id);
  });

  it("keeps the historical quote when the source document changes version", () => {
    const store = new ProjectSourceStore(db.sqlite);
    const receipt = store.recordRunSources(projectId, owner.owner_id, {
      run_id: "run-version",
      sources: [{ ...source("msg-version", "b".repeat(64)), quote: "Бюджет: 19 700" }]
    });
    // A second attempt with changed material is rejected (409); the first bytes survive.
    expect(() =>
      store.recordRunSources(projectId, owner.owner_id, {
        run_id: "run-version",
        sources: [{ ...source("msg-version", "c".repeat(64)), quote: "Бюджет: 18 000" }]
      })
    ).toThrow("RUN_SOURCES_CONFLICT");
    const after = store.runSources(projectId, owner.owner_id, "run-version");
    expect(after.sources).toEqual(receipt.sources);
    expect(after.sources[0]).toMatchObject({ sha256: "b".repeat(64), quote: "Бюджет: 19 700" });
  });

  it("keeps the receipt after the underlying material is deleted", () => {
    const store = new ProjectSourceStore(db.sqlite);
    const receipt = store.recordRunSources(projectId, owner.owner_id, {
      run_id: "run-deleted",
      sources: [{ ...source("msg-deleted"), quote: "Удалённый материал" }]
    });
    db.sqlite.prepare("DELETE FROM general_chat_messages WHERE id=?").run("msg-deleted");
    expect(store.runSources(projectId, owner.owner_id, "run-deleted").sources).toEqual(
      receipt.sources
    );
  });
});
