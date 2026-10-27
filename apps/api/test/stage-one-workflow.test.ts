import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import { chunkLibraryPages, knowledgeHash, type KnowledgeHit } from "@cosmora/core";
import type { ModelRequest, ManagerWork } from "@cosmora/contracts";
import {
  CanvasArtifactStore,
  DocumentLibraryStore,
  EmergencyStopStore,
  IdentityStore,
  ManagerWorkStore,
  PolicyStore,
  UsageStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import {
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  type ModelProviderAdapter,
  type ProviderStreamEvent
} from "@cosmora/model-gateway";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import { ManagerRuntimeProjectStore } from "../src/manager-runtime-project-store.js";
import { ManagerWorkCoordinator } from "../src/manager-work-coordinator.js";
import { buildModelRuntime, loadModelRegistryDocument } from "../src/model-runtime.js";

// Actual API/SQLite/coordinator boundaries; only the external model is synthetic.
// No server.env, provider key, external transport or production database is read.
it("preserves accepted table/document evidence through a restart, chat and published Work", async () => {
  const root = tmpdir();
  const folder = mkdtempSync(join(root, "kosmora-stage-one-"));
  const filename = join(folder, "acceptance.sqlite");
  const calls: ModelRequest[] = [];
  const config = loadServerConfig({ NODE_ENV: "test" });
  const runtime = await buildModelRuntime(config);
  const adapter: ModelProviderAdapter = {
    id: "mock",
    modelId: "manager-b0.1",
    async *stream(request): AsyncGenerator<ProviderStreamEvent> {
      await Promise.resolve();
      calls.push(structuredClone(request));
      const content =
        request.task_type === "manager_work_plan"
          ? JSON.stringify({
              summary: "Summarize accepted evidence",
              instructions: "Write result.md",
              complexity: "simple",
              needs_critic: false,
              requires_external_actions: false
            })
          : request.task_type === "manager_work_draft"
            ? JSON.stringify({
                files: [{ name: "result.md", content: "# Evidence\nДоговор: 42 дня. Сумма: 30." }]
              })
            : "Договор: 42 дня. Сумма таблицы: 30.";
      yield { type: "text.delta", delta: content };
      yield {
        type: "response.completed",
        provider: "mock",
        model: "manager-b0.1",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 60 }
      };
    }
  };
  const gateway = new ModelGateway(
    [adapter],
    new ModelRouter(new ModelRegistry(loadModelRegistryDocument("config/model-registry.v1.json"))),
    []
  );
  async function open() {
    const database = openDatabase(filename);
    await runMigrations(database);
    const projects = new ManagerRuntimeProjectStore(database.sqlite);
    const canvas = new CanvasArtifactStore(database.sqlite);
    const documents = new DocumentLibraryStore(database.sqlite);
    const works = new ManagerWorkStore(database.sqlite);
    const policy = new PolicyStore(database.sqlite);
    const identities = new IdentityStore(database.sqlite);
    const account = new AccountStore(database.sqlite);
    const emergency = new EmergencyStopStore(database.sqlite);
    const coordinator = new ManagerWorkCoordinator({
      store: works,
      projects,
      policy,
      emergency,
      gateway,
      manager: runtime.manager,
      ownerBudget: account
    });
    const app = buildApp({
      config,
      database,
      projectStore: projects,
      canvasStore: canvas,
      documentLibrary: documents,
      managerWorkStore: works,
      managerWorkCoordinator: coordinator,
      policyStore: policy,
      usageStore: new UsageStore(database.sqlite),
      emergencyStopStore: emergency,
      accountStore: account,
      modelGateway: gateway,
      manager: runtime.manager,
      identityResolver: new BearerSessionIdentityResolver(identities)
    });
    return {
      database,
      projects,
      canvas,
      documents,
      works,
      policy,
      identities,
      account,
      coordinator,
      app
    };
  }
  let f: Awaited<ReturnType<typeof open>> | undefined;
  const close = async () => {
    if (!f) return;
    await f.coordinator.stop();
    await f.app.close();
    f.database.close();
    f = undefined;
  };
  const cleanup = () => {
    const child = relative(root, folder);
    if (!child.startsWith("kosmora-stage-one-") || child.includes("..") || /[/\\]/.test(child))
      throw new Error("Refusing cleanup outside the acceptance fixture folder");
    rmSync(folder, { recursive: true, force: true });
  };
  try {
    f = await open();
    f.identities.registerActor("acceptance-owner", "acceptance-owner", "owner");
    const headers = {
      authorization:
        "Bearer " +
        f.identities.issueSession({
          ownerId: "acceptance-owner",
          actorId: "acceptance-owner",
          assurance: "single_factor",
          ttlMs: 120000
        }).token
    };
    const id = randomUUID(),
      base = `/api/v1/projects/${id}`;
    const create = await f.app.inject({
      method: "POST",
      url: "/api/v1/projects/empty",
      headers,
      payload: { title: "Release acceptance", client_project_id: id }
    });
    expect(create.statusCode, create.body).toBe(201);
    expect(f.policy.getProfile(id)?.base_level).toBe("A0");
    const data = {
      schema: "kosmora.studio.data",
      version: 1,
      name: "totals.csv",
      table: {
        delimiter: ",",
        headers: ["id", "amount"],
        rows: [
          ["001", "10"],
          ["002", "20"]
        ]
      },
      settings: {
        types: ["text", "number"],
        columns: [0, 1],
        filters: [],
        sort: null,
        group: null,
        measure: 1,
        chart: { kind: "bar", x: 0, y: 1 }
      }
    };
    const table = await f.app.inject({
      method: "POST",
      url: base + "/tables",
      headers,
      payload: { client_id: randomUUID(), title: "Totals", content: JSON.stringify(data) }
    });
    expect(table.statusCode, table.body).toBe(201);
    const source = table.json<{ artifact: { id: string }; revision: { sha256: string } }>();
    const file = f.documents.stage(
      id,
      "acceptance-owner",
      "contract.txt",
      Buffer.from("Договор: 42 дня.")
    );
    const pages = [{ page: null, text: "Договор: 42 дня." }];
    f.documents.complete(id, "acceptance-owner", file.id, pages, chunkLibraryPages(pages));
    const search = await f.app.inject({
      method: "POST",
      url: base + "/knowledge/search",
      headers,
      payload: { query: "договор", kinds: ["document"] }
    });
    expect(search.statusCode, search.body).toBe(200);
    const reference = search.json<{ hits: KnowledgeHit[] }>().hits[0]!.reference;
    const evidence = await f.app.inject({
      method: "POST",
      url: base + "/knowledge/context",
      headers,
      payload: { references: [reference] }
    });
    expect(evidence.statusCode, evidence.body).toBe(200);
    const summary = await f.app.inject({
      method: "POST",
      url: base + "/materials/artifacts/table-summary",
      headers,
      payload: {
        source: {
          kind: "table",
          id: source.artifact.id,
          version: 1,
          sha256: source.revision.sha256
        },
        scope: "all"
      }
    });
    expect(summary.statusCode, summary.body).toBe(200);
    const attachments = [evidence, summary].map(
      (r) => r.json<{ attachment: { name: string; content: string } }>().attachment
    );
    const materials = await f.app.inject({
      method: "PUT",
      url: base + "/materials",
      headers,
      payload: { version: 0, instructions: "Use the reviewed evidence.", attachments }
    });
    expect(materials.statusCode, materials.body).toBe(200);
    const chat = await f.app.inject({
      method: "POST",
      url: base + "/messages",
      headers,
      payload: {
        content: "Summarize the accepted evidence",
        client_message_id: "acceptance-message"
      }
    });
    expect(chat.statusCode, chat.body).toBe(202);
    const accepted = chat.json<{ run_id: string; stream_url: string }>();
    const workPayload = {
      client_request_id: "acceptance-work",
      goal: "Write an evidence summary",
      worker_role: "analyst",
      max_model_requests: 3,
      max_input_tokens: 32000,
      max_output_tokens: 6000
    };
    const work = await f.app.inject({
      method: "POST",
      url: base + "/work",
      headers,
      payload: workPayload
    });
    expect(work.statusCode, work.body).toBe(201);
    const workId = work.json<ManagerWork>().id;
    expect(calls).toEqual([]);
    // Changes after acceptance must never rewrite what either execution receives.
    data.table.rows = [["003", "999"]];
    const changed = await f.app.inject({
      method: "PUT",
      url: base + "/tables/" + source.artifact.id,
      headers,
      payload: { baseVersion: 1, title: "Replacement", content: JSON.stringify(data) }
    });
    expect(changed.statusCode, changed.body).toBe(200);
    f.documents.remove(id, "acceptance-owner", file.id);
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url: base + "/materials",
          headers,
          payload: { version: 1, instructions: "Replacement only", attachments: [] }
        })
      ).statusCode
    ).toBe(200);
    await close();
    f = await open();
    expect(f.projects.listQueuedManagerRuns()).toContainEqual({
      run_id: accepted.run_id,
      project_id: id,
      owner_id: "acceptance-owner"
    });
    expect(f.projects.getMaterialsForRun(accepted.run_id, "acceptance-owner")?.attachments).toEqual(
      attachments
    );
    expect(f.works.get(workId, "acceptance-owner")?.materials?.attachments).toEqual(attachments);
    const repeated = await f.app.inject({
      method: "POST",
      url: base + "/work",
      headers,
      payload: workPayload
    });
    expect(repeated.statusCode, repeated.body).toBe(201);
    expect(repeated.json<ManagerWork>().id).toBe(workId);
    expect(repeated.json<ManagerWork>().materials?.attachments).toEqual(attachments);
    const stream = await f.app.inject({ method: "GET", url: accepted.stream_url, headers });
    expect(stream.body).toContain("event: run.completed");
    expect(f.projects.getRun(accepted.run_id, "acceptance-owner")?.status).toBe("succeeded");
    await f.coordinator.execute(workId, "acceptance-owner");
    const planned = f.works.get(workId, "acceptance-owner")!;
    expect(planned.status).toBe("awaiting_approval");
    const control = await f.app.inject({
      method: "POST",
      url: `${base}/work/${workId}/control`,
      headers,
      payload: { version: planned.version, action: "approve" }
    });
    expect(control.statusCode, control.body).toBe(200);
    // Publication still uses the existing scoped tool policy; no approval bypass.
    const profile = f.policy.getProfile(id)!;
    f.policy.updateProfile({
      projectId: id,
      expectedVersion: profile.version,
      baseLevel: "A2",
      overrides: []
    });
    await f.coordinator.execute(workId, "acceptance-owner");
    expect(f.works.get(workId, "acceptance-owner")?.status).toBe("completed");
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      const sent = JSON.stringify(call.messages);
      expect(sent).toContain("42 дня");
      expect(sent).toContain(source.revision.sha256);
      expect(sent).not.toContain("Replacement only");
    }
    const published = f.works.runtime.publishedArtifacts(id, "acceptance-owner");
    expect(published).toHaveLength(1);
    expect(published[0]!.sha256).toBe(knowledgeHash("# Evidence\nДоговор: 42 дня. Сумма: 30."));
    const download = await f.app.inject({
      method: "GET",
      url: `${base}/work/${workId}/files/result.md`,
      headers
    });
    expect(download.statusCode, download.body).toBe(200);
    expect(download.body).toBe("# Evidence\nДоговор: 42 дня. Сумма: 30.");
    await close();
    f = await open();
    expect(f.works.get(workId, "acceptance-owner")?.status).toBe("completed");
    expect(f.works.runtime.publishedArtifacts(id, "acceptance-owner")).toEqual(published);
    expect(f.account.summary("acceptance-owner").total_counted_tokens).toBe(480);
    expect(f.database.sqlite.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    expect(calls).toHaveLength(3);
  } finally {
    await close();
    cleanup();
  }
}, 30000);
