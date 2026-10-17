import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import {
  ManagerWorkStore,
  PresentationStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import {
  presentationWorkReference,
  type PresentationWorkPreview,
  type PresentationWorkReference
} from "@cosmora/contracts/presentation-package";
import { buildApp } from "../src/app.js";
import { LOCAL_DEVELOPMENT_IDENTITY, StaticIdentityResolver } from "../src/identity.js";
import { PresentationPrivacyAdapter } from "../src/presentation-privacy.js";
import { PolicyStore, EmergencyStopStore } from "@cosmora/db";
import {
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  type ModelProviderAdapter,
  type ProviderStreamEvent
} from "@cosmora/model-gateway";
import { buildModelRuntime, loadModelRegistryDocument } from "../src/model-runtime.js";
import { ManagerWorkCoordinator } from "../src/manager-work-coordinator.js";
import { AccountStore } from "../src/account-settings/account-store.js";

const deck = {
  format: "kosmora-presentation-v1",
  title: "Физика 🪐",
  theme: "paper",
  slides: [
    {
      id: "s1",
      layout: "title",
      title: "Первый закон",
      body: "<script>alert(1)</script>",
      aside: "",
      notes: "BOM и CRLF\r\nБез исполнения"
    },
    {
      id: "s2",
      layout: "two-column",
      title: "Второй",
      body: "F = ma",
      aside: "m = 2 кг",
      notes: "Проверить единицы"
    }
  ]
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("reviewed AI presentation Work", () => {
  let db: ReturnType<typeof openDatabase>,
    works: ManagerWorkStore,
    projects: ProjectStore,
    presentations: PresentationStore,
    app: ReturnType<typeof buildApp>,
    foreign: ReturnType<typeof buildApp>;
  let project: string;
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    works = new ManagerWorkStore(db.sqlite);
    projects = new ProjectStore(db.sqlite);
    presentations = new PresentationStore(db.sqlite);
    project = projects.createProject("Slides", "slides").project.id;
    const deps = {
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      managerWorkStore: works,
      projectStore: projects,
      presentationStore: presentations
    };
    app = buildApp(deps);
    foreign = buildApp({
      ...deps,
      identityResolver: new StaticIdentityResolver({
        ...LOCAL_DEVELOPMENT_IDENTITY,
        owner_id: "other"
      })
    });
  });
  afterEach(async () => {
    await app.close();
    await foreign.close();
    db.close();
  });
  function completed(
    content = JSON.stringify(deck),
    review = "PASS",
    published = true
  ): PresentationWorkReference {
    let work = works.create(project, "local-owner", "local-owner", {
      client_request_id: crypto.randomUUID(),
      goal: "Presentation",
      worker_role: "analyst",
      require_critic: true,
      max_model_requests: 3,
      max_input_tokens: 32000,
      max_output_tokens: 6000
    })!;
    work = works.save({
      ...work,
      status: "running",
      stage: "publish",
      draft: { files: [{ name: "presentation.json", content }] },
      review: { verdict: review === "PASS" ? "PASS" : "FAIL", reason: "Fixture review" },
      result_sources: [
        { run_id: "fixture-run", provider: "fixture", model: "fixture-model", stage: "draft" }
      ]
    });
    if (published) works.publish(work.id, "local-owner", work.draft!);
    works.save({ ...work, status: "completed", stage: "done" });
    const file = works.runtime.artifacts(project, "local-owner", work.id)[0]!;
    return {
      project_id: project,
      work_id: work.id,
      artifact_id: file.id,
      version: file.version,
      sha256: hash(content)
    };
  }
  const preview = (source: PresentationWorkReference) =>
    app.inject({ method: "POST", url: "/api/v1/presentations/work-preview", payload: source });
  const adopt = (source: PresentationWorkReference) =>
    app.inject({
      method: "POST",
      url: "/api/v1/presentations/from-work",
      payload: { source, reviewed: true }
    });

  it("executes plan → exact slide file → Critic with canonical accounting and imports without generation", async () => {
    const policy = new PolicyStore(db.sqlite);
    policy.ensureProfile(project);
    policy.updateProfile({
      projectId: project,
      baseLevel: "A2",
      overrides: [],
      expectedVersion: 1
    });
    const account = new AccountStore(db.sqlite);
    const runtime = await buildModelRuntime(loadServerConfig({ NODE_ENV: "test" }));
    const calls: string[] = [];
    const output = {
      ...deck,
      slides: [...deck.slides, { ...deck.slides[0]!, id: "s3", title: "Итог" }]
    };
    let invalid = false;
    const adapter: ModelProviderAdapter = {
      id: "mock",
      modelId: "manager-b0.1",
      // Provider interface is asynchronous; the fixture emits deterministic in-memory events.
      // eslint-disable-next-line @typescript-eslint/require-await
      async *stream(req): AsyncGenerator<ProviderStreamEvent> {
        calls.push(req.task_type);
        const result =
          req.task_type === "manager_work_plan"
            ? {
                summary: "Slides",
                instructions: "Write presentation.json",
                complexity: "simple",
                needs_critic: false,
                requires_external_actions: false
              }
            : req.task_type === "manager_work_draft"
              ? {
                  files: [
                    { name: "presentation.json", content: JSON.stringify(invalid ? deck : output) }
                  ]
                }
              : { verdict: "PASS", reason: "Fixture review, not live acceptance" };
        yield { type: "text.delta", delta: JSON.stringify(result) };
        yield {
          type: "response.completed",
          provider: "mock",
          model: "manager-b0.1",
          finishReason: "stop",
          usage: { inputTokens: 100, outputTokens: 100 }
        };
      }
    };
    const gateway = new ModelGateway(
      [adapter],
      new ModelRouter(new ModelRegistry(loadModelRegistryDocument("config/model-registry.v1.json")))
    );
    const coordinator = new ManagerWorkCoordinator({
      store: works,
      projects,
      policy,
      emergency: new EmergencyStopStore(db.sqlite),
      gateway,
      manager: runtime.manager,
      ownerBudget: account
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${project}/presentation-work`,
        payload: { client_request_id: "pipeline", topic: "Механика", slide_count: 3 }
      });
      const id = response.json<{ id: string }>().id;
      await coordinator.execute(id, "local-owner");
      expect(works.get(id, "local-owner")).toMatchObject({
        status: "completed",
        model_requests: 3,
        review: { verdict: "PASS" }
      });
      expect(calls).toEqual(["manager_work_plan", "manager_work_draft", "manager_work_review"]);
      const file = works.runtime.artifacts(project, "local-owner", id)[0]!;
      const source = {
        project_id: project,
        work_id: id,
        artifact_id: file.id,
        version: file.version,
        sha256: file.sha256
      };
      expect((await adopt(source)).statusCode).toBe(201);
      expect((await adopt(source)).statusCode).toBe(201);
      expect(calls).toHaveLength(3);
      expect(account.summary("local-owner")).toMatchObject({
        total_counted_tokens: 600,
        in_flight_or_uncertain_holds: 0
      });
      invalid = true;
      const bad = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${project}/presentation-work`,
        payload: { client_request_id: "invalid-output", topic: "Механика", slide_count: 3 }
      });
      const badId = bad.json<{ id: string }>().id;
      await coordinator.execute(badId, "local-owner");
      expect(works.get(badId, "local-owner")).toMatchObject({
        status: "failed",
        error_code: "INVALID_PRESENTATION_RESULT",
        model_requests: 2
      });
      expect(works.runtime.artifacts(project, "local-owner", badId)).toHaveLength(0);
      expect(calls).toHaveLength(5);
    } finally {
      await coordinator.stop();
    }
  });

  it("queues an idempotent three-stage Work request with materials, mandatory Critic and no provider dispatch", async () => {
    projects.setMaterials(project, "local-owner", {
      version: 0,
      instructions: "Only supplied sources",
      attachments: [{ name: "source.txt", content: "Supplied fact" }]
    });
    const body = { client_request_id: "slides-request", topic: "Механика", slide_count: 5 };
    const create = () =>
      app.inject({
        method: "POST",
        url: `/api/v1/projects/${project}/presentation-work`,
        payload: body
      });
    const response = await create();
    expect(response.statusCode, response.body).toBe(201);
    const work = works.list(project, "local-owner")[0]!;
    expect(work.request).toMatchObject({
      require_critic: true,
      max_model_requests: 3,
      max_input_tokens: 32000,
      max_output_tokens: 6000
    });
    expect(work.materials?.attachments[0]?.content).toBe("Supplied fact");
    expect(work.request.goal).toContain("exactly 5 slides");
    expect((await create()).json<{ id: string }>().id).toBe(work.id);
    expect(works.list(project, "local-owner")).toHaveLength(1);
    expect(db.sqlite.prepare("SELECT count(*) n FROM model_usage_ledger").get()!.n).toBe(0);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/projects/${project}/presentation-work`,
          payload: { ...body, slide_count: 9 }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/projects/${project}/presentation-work`,
          payload: { ...body, topic: "Changed" }
        })
      ).statusCode
    ).toBe(409);
  });
  it("previews exact literal content, imports once, keeps provenance after edits and source deletion", async () => {
    const source = completed();
    const response = await preview(source);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    const result = response.json<PresentationWorkPreview>();
    expect(result.package).toEqual(deck);
    expect(result.source.model_sources[0]).toMatchObject({
      provider: "fixture",
      model: "fixture-model"
    });
    expect(presentations.list("local-owner")).toHaveLength(0);
    const imported = await adopt(presentationWorkReference(result.source));
    expect(imported.statusCode, imported.body).toBe(201);
    const saved = imported.json<ReturnType<PresentationStore["get"]>>();
    expect(saved.slides[0]!.id).not.toBe("s1");
    expect(saved.work_source?.sha256).toBe(source.sha256);
    expect((await adopt(source)).json<{ id: string }>().id).toBe(saved.id);
    presentations.save("local-owner", saved.id, 1, { ...saved, title: "Edited" });
    expect((await adopt(source)).json<{ version: number }>().version).toBe(2);
    expect(presentations.versions("local-owner", saved.id)).toHaveLength(2);
    db.sqlite.prepare("DELETE FROM projects WHERE id=?").run(project);
    expect((await adopt(source)).json<{ id: string; version: number }>()).toMatchObject({
      id: saved.id,
      version: 2
    });
    expect(presentations.get("local-owner", saved.id).work_source).toEqual(result.source);
    expect(presentations.get("local-owner", saved.id).slides[0]!.body).toBe(deck.slides[0]!.body);
  });
  it("requires explicit review and rejects foreign owner/project/work/artifact references", async () => {
    const source = completed();
    const other = completed();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/presentations/from-work",
          payload: { source, reviewed: false }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await foreign.inject({
          method: "POST",
          url: "/api/v1/presentations/work-preview",
          payload: source
        })
      ).statusCode
    ).toBe(404);
    expect((await preview({ ...source, work_id: other.work_id })).statusCode).toBe(404);
    const secondProject = projects.createProject("Other", "other").project.id;
    expect((await preview({ ...source, project_id: secondProject })).statusCode).toBe(404);
    expect(presentations.list("local-owner")).toHaveLength(0);
  });
  it("rejects unpublished, unreviewed, stale and corrupt sources without importing", async () => {
    expect((await preview(completed(JSON.stringify(deck), "PASS", false))).statusCode).toBe(404);
    expect((await preview(completed(JSON.stringify(deck), "FAIL"))).statusCode).toBe(409);
    const source = completed();
    expect((await preview({ ...source, version: source.version + 1 })).statusCode).toBe(409);
    expect((await preview({ ...source, sha256: "0".repeat(64) })).statusCode).toBe(409);
    db.sqlite
      .prepare("UPDATE work_artifact_versions SET bytes=bytes+1 WHERE id=?")
      .run(source.artifact_id);
    expect((await adopt(source)).json()).toMatchObject({ error: { code: "WORK_RESULT_CORRUPT" } });
    expect(presentations.list("local-owner")).toHaveLength(0);
  });
  it("rejects malformed packages, legacy identity and unknown properties without repair or paid retries", async () => {
    for (const value of [
      "not JSON",
      "```json\n" + JSON.stringify(deck) + "\n```",
      JSON.stringify({ ...deck, tools: ["run"] }),
      JSON.stringify({ ...deck, slides: [{ ...deck.slides[0], tool: "run" }] }),
      JSON.stringify({ ...deck, slides: [deck.slides[0], deck.slides[0]] }),
      JSON.stringify({ ...deck, title: "\u0000bad" }),
      JSON.stringify({
        ...deck,
        format: undefined,
        id: "owner",
        version: 1,
        created_at: "now",
        updated_at: "now"
      })
    ]) {
      const response = await adopt(completed(value));
      expect(response.statusCode, response.body).toBe(422);
    }
    expect(presentations.list("local-owner")).toHaveLength(0);
    expect(db.sqlite.prepare("SELECT count(*) n FROM model_usage_ledger").get()!.n).toBe(0);
  });
  it("retains a deletion tombstone so retry cannot resurrect a deleted presentation", async () => {
    const source = completed();
    const response = await adopt(source);
    const saved = response.json<{ id: string }>();
    presentations.delete("local-owner", saved.id, 1);
    const retry = await adopt(source);
    expect(retry.statusCode, retry.body).toBe(410);
    expect(presentations.list("local-owner")).toHaveLength(0);
  });
  it("exports provenance, fences creation and deletes both live sources and tombstones", async () => {
    const source = completed();
    await adopt(source);
    const privacy = new PresentationPrivacyAdapter(db.sqlite);
    expect((await privacy.export("local-owner")).records.work_sources).toHaveLength(1);
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('local-owner',1,'quiescing','op','now','now')"
      )
      .run();
    expect((await adopt(source)).statusCode).toBe(423);
    db.sqlite
      .prepare(
        "UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id='local-owner'"
      )
      .run();
    expect((await privacy.delete("local-owner", 1)).deleted_records).toBe(3);
    expect((await privacy.export("local-owner")).records.work_sources).toHaveLength(0);
  });
});
