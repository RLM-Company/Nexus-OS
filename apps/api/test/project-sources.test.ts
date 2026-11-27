import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EmergencyStopStore,
  GeneralChatStore,
  openDatabase,
  ProjectSourceStore,
  ProjectStore,
  runMigrations
} from "@cosmora/db";
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
let chats: GeneralChatStore;

beforeEach(async () => {
  db = openDatabase(":memory:");
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  chats = new GeneralChatStore(db.sqlite);
  projectId = projects.createEmptyProject(
    "source-test",
    "Source test",
    owner.owner_id,
    "ACTIVE"
  ).id;
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  app = buildApp({
    config,
    database: db,
    generalChatStore: chats,
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
    const store = new ProjectSourceStore(db.sqlite);
    store.recordRunSources(projectId, owner.owner_id, {
      run_id: "run-1",
      sources: [source("msg-a"), source("msg-b")]
    });
    const forged = await app.inject({
      method: "POST",
      url: `${base}/run`,
      payload: { run_id: "run-1", sources: [source("forged")] }
    });
    expect(forged.statusCode).toBe(404);

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

    store.recordRunSources(projectId, owner.owner_id, {
      run_id: "run-2",
      sources: [source("msg-b")]
    });
    const second = await app.inject({ url: `${base}/run/run-2` });
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

  it("preserves the used source version after deletion and denies a fresh fragment read", async () => {
    const content = "Поставщик указал 19 700 ₽";
    const accepted = chats.createChat(content, "source-version-chat", owner.owner_id);
    expect(chats.cancelRun(accepted.run.id, owner.owner_id)).toBe("cancelled");
    const target = { kind: "project", id: projectId } as const;
    const memoryBase = `/api/v1/memory/targets/project/${projectId}`;
    chats.contextMemory.updateSettings(
      target,
      {
        expected_version: chats.contextMemory.settings(target, owner.owner_id).version,
        enabled: true,
        use_personal: false,
        source_chat_ids: [accepted.chat.id],
        project_ids: []
      },
      owner.owner_id
    );
    const reference = `H:g:${accepted.userMessage.id}`;
    const fragmentUrl = `${memoryBase}/source?reference=${encodeURIComponent(reference)}`;
    const original = await app.inject({ url: fragmentUrl });
    expect(original.statusCode, original.body).toBe(200);
    const originalHash = original.json<{ source: { sha256: string } }>().source.sha256;
    expect(original.json()).toMatchObject({ content });

    const store = new ProjectSourceStore(db.sqlite);
    const evidence = {
      ...source(accepted.userMessage.id, originalHash),
      reference,
      source_kind: "chat_message" as const,
      quote: "",
      excerpt_only: true
    };
    const receipt = store.recordRunSources(projectId, owner.owner_id, {
      run_id: "run-version",
      sources: [evidence]
    });
    expect(() =>
      store.recordRunSources(projectId, owner.owner_id, {
        run_id: "run-version",
        sources: [{ ...evidence, version: 2, sha256: "b".repeat(64) }]
      })
    ).toThrow("RUN_SOURCES_CONFLICT");

    expect(chats.deleteChat(accepted.chat.id, owner.owner_id)).toBe(true);
    const missingFragment = await app.inject({ url: fragmentUrl });
    expect(missingFragment.statusCode, missingFragment.body).toBe(404);
    expect(missingFragment.json()).toMatchObject({ error: { code: "MEMORY_SOURCE_NOT_FOUND" } });
    const historical = await app.inject({
      url: `/api/v1/projects/${projectId}/sources/run/run-version`
    });
    expect(historical.statusCode, historical.body).toBe(200);
    expect(historical.json<RunSourcesView>().sources).toEqual(receipt.sources);
  });
});
