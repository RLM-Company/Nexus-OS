import { loadServerConfig } from "@cosmora/config";
import {
  AgentBlueprintStore,
  AgentInstanceStore,
  IdentityStore,
  openDatabase,
  PatternLibraryStore,
  ProjectStore,
  runMigrations,
  type DatabaseHandle
} from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";

const NOW = Date.parse("2026-08-29T09:00:00.000Z");
const PROJECT_ONE = "project-agent-studio-write-1";
const PROJECT_SAME_OWNER = "project-agent-studio-write-3";

const insertProject = (database: DatabaseHandle, id: string, ownerId: string): void => {
  database.sqlite
    .prepare(
      `INSERT INTO projects (id, owner_id, title, status, created_at, updated_at)
       VALUES (?, ?, 'Agent Studio write API', 'ACTIVE', '2026-08-29T08:00:00.000Z',
         '2026-08-29T08:00:00.000Z')`
    )
    .run(id, ownerId);
};

const functionBody = {
  name: "Researcher",
  description: "Collects bounded project evidence.",
  result_contract: "Return findings, evidence references, and open questions."
};

const patternBody = (functionId: string) => ({
  name: "Skeptical analyst",
  description: "Challenges weak evidence.",
  instructions: "Separate facts from inference and identify counter-evidence.",
  allowed_function_ids: [functionId],
  known_limitations: ["May over-weight missing evidence."],
  test_status: "untested" as const
});

const blueprintBody = (functionId: string, functionVersion: number, patternId: string) => ({
  function_ref: { id: functionId, version: functionVersion },
  behavior_pattern_ref: { id: patternId, version: 1 },
  model_profile_ref: { id: "cosmora-mars", version: 1 },
  grant: {
    capability_ids: ["context.project.read"],
    tool_ids: [],
    data_scope_ids: ["project-memory"],
    object_ids: [PROJECT_ONE],
    budget: { currency: "USD", money_minor: 0, tokens: 10_000, operations: 0 },
    delegation_depth: 0,
    valid_until: "2026-08-30T09:00:00.000Z"
  },
  memory_scope: {
    read_mode: "project_segments" as const,
    source_ids: ["project-memory"],
    write_back: "result_and_evidence" as const
  },
  task_contract: "Return the bounded project result.",
  start_condition: "A later activation increment explicitly approves the proposal.",
  close_conditions: ["The result is accepted."]
});

describe("Agent Studio owner write API", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let database: DatabaseHandle;
  let app: ReturnType<typeof buildApp>;
  let ownerOneToken: string;
  let ownerTwoToken: string;
  let agentToken: string;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    insertProject(database, PROJECT_ONE, "owner-1");
    insertProject(database, PROJECT_SAME_OWNER, "owner-1");
    insertProject(database, "project-agent-studio-write-2", "owner-2");

    const identityStore = new IdentityStore(database.sqlite, { now: () => NOW });
    identityStore.registerActor("owner-1", "owner-actor-1", "owner");
    identityStore.registerActor("owner-2", "owner-actor-2", "owner");
    identityStore.registerActor("owner-1", "agent-actor-1", "agent");
    ownerOneToken = identityStore.issueSession({
      ownerId: "owner-1",
      actorId: "owner-actor-1",
      assurance: "single_factor",
      ttlMs: 60_000
    }).token;
    ownerTwoToken = identityStore.issueSession({
      ownerId: "owner-2",
      actorId: "owner-actor-2",
      assurance: "single_factor",
      ttlMs: 60_000
    }).token;
    agentToken = identityStore.issueSession({
      ownerId: "owner-1",
      actorId: "agent-actor-1",
      assurance: "single_factor",
      ttlMs: 60_000
    }).token;

    const patterns = new PatternLibraryStore(database.sqlite, { now: () => NOW });
    const blueprints = new AgentBlueprintStore(database.sqlite, { now: () => NOW });
    const instances = new AgentInstanceStore(database.sqlite, { now: () => NOW });
    app = buildApp({
      config,
      database,
      identityStore,
      projectStore: new ProjectStore(database.sqlite),
      patternLibraryStore: patterns,
      agentBlueprintStore: blueprints,
      agentInstanceStore: instances,
      identityResolver: new BearerSessionIdentityResolver(identityStore)
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("creates immutable project objects and rejects stale version writes", async () => {
    const headers = { authorization: `Bearer ${ownerOneToken}` };
    const base = `/api/v1/projects/${PROJECT_ONE}/agent-studio`;

    const createdFunction = await app.inject({
      method: "POST",
      url: `${base}/functions`,
      headers,
      payload: functionBody
    });
    expect(createdFunction.statusCode).toBe(201);
    const agentFunction = createdFunction.json<{
      function_id: string;
      version: number;
      project_id: string;
    }>();
    expect(agentFunction).toMatchObject({ version: 1, project_id: PROJECT_ONE });

    const crossProjectVersion = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_SAME_OWNER}/agent-studio/functions/${agentFunction.function_id}/versions`,
      headers,
      payload: { ...functionBody, expected_version: 1 }
    });
    expect(crossProjectVersion.statusCode).toBe(404);
    expect(crossProjectVersion.json<{ error: { code: string } }>().error.code).toBe(
      "AGENT_STUDIO_OBJECT_NOT_FOUND"
    );

    const functionVersion = await app.inject({
      method: "POST",
      url: `${base}/functions/${agentFunction.function_id}/versions`,
      headers,
      payload: { ...functionBody, expected_version: 1, name: "Evidence researcher" }
    });
    expect(functionVersion.statusCode).toBe(201);
    expect(functionVersion.json<{ version: number }>().version).toBe(2);
    const staleFunctionVersion = await app.inject({
      method: "POST",
      url: `${base}/functions/${agentFunction.function_id}/versions`,
      headers,
      payload: { ...functionBody, expected_version: 1 }
    });
    expect(staleFunctionVersion.statusCode).toBe(409);

    const createdPattern = await app.inject({
      method: "POST",
      url: `${base}/patterns`,
      headers,
      payload: patternBody(agentFunction.function_id)
    });
    expect(createdPattern.statusCode).toBe(201);
    const pattern = createdPattern.json<{ pattern_id: string; version: number }>();

    const patternVersion = await app.inject({
      method: "POST",
      url: `${base}/patterns/${pattern.pattern_id}/versions`,
      headers,
      payload: {
        ...patternBody(agentFunction.function_id),
        expected_version: 1,
        name: "Evidence-first skeptic"
      }
    });
    expect(patternVersion.statusCode).toBe(201);
    expect(patternVersion.json<{ version: number }>().version).toBe(2);

    const createdBlueprint = await app.inject({
      method: "POST",
      url: `${base}/blueprints`,
      headers,
      payload: blueprintBody(agentFunction.function_id, 2, pattern.pattern_id)
    });
    expect(createdBlueprint.statusCode).toBe(201);
    const blueprint = createdBlueprint.json<{
      blueprint_id: string;
      version: number;
      project_id: string;
      grant: { project_id: string };
    }>();
    expect(blueprint).toMatchObject({
      version: 1,
      project_id: PROJECT_ONE,
      grant: { project_id: PROJECT_ONE }
    });

    const blueprintVersion = await app.inject({
      method: "POST",
      url: `${base}/blueprints/${blueprint.blueprint_id}/versions`,
      headers,
      payload: {
        ...blueprintBody(agentFunction.function_id, 2, pattern.pattern_id),
        expected_version: 1,
        task_contract: "Review and return the bounded project result."
      }
    });
    expect(blueprintVersion.statusCode).toBe(201);
    expect(blueprintVersion.json<{ version: number }>().version).toBe(2);

    const archived = await app.inject({
      method: "POST",
      url: `${base}/patterns/${pattern.pattern_id}/archive`,
      headers
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json<{ version: number; archived_at: string | null }>()).toMatchObject({
      version: 3,
      archived_at: "2026-08-29T09:00:00.000Z"
    });
    const repeatedArchive = await app.inject({
      method: "POST",
      url: `${base}/patterns/${pattern.pattern_id}/archive`,
      headers
    });
    expect(repeatedArchive.json<{ version: number }>().version).toBe(3);
  });

  it("keeps path ownership authoritative and leaves proposals non-writable", async () => {
    const base = `/api/v1/projects/${PROJECT_ONE}/agent-studio`;
    const crossOwner = await app.inject({
      method: "POST",
      url: `${base}/functions`,
      headers: { authorization: `Bearer ${ownerTwoToken}` },
      payload: functionBody
    });
    expect(crossOwner.statusCode).toBe(404);
    expect(crossOwner.json<{ error: { code: string } }>().error.code).toBe("PROJECT_NOT_FOUND");

    const agentDenied = await app.inject({
      method: "POST",
      url: `${base}/functions`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: functionBody
    });
    expect(agentDenied.statusCode).toBe(403);

    const malformedPattern = await app.inject({
      method: "POST",
      url: `${base}/patterns`,
      headers: { authorization: `Bearer ${ownerOneToken}` },
      payload: { ...patternBody("function-id"), tool_ids: ["forbidden-authority-field"] }
    });
    expect(malformedPattern.statusCode).toBe(400);
    expect(malformedPattern.json<{ error: { code: string } }>().error.code).toBe(
      "VALIDATION_ERROR"
    );

    const missingVersionTarget = await app.inject({
      method: "POST",
      url: `${base}/functions/missing/versions`,
      headers: { authorization: `Bearer ${ownerOneToken}` },
      payload: { ...functionBody, expected_version: 1 }
    });
    expect(missingVersionTarget.statusCode).toBe(404);
    expect(missingVersionTarget.json<{ error: { code: string } }>().error.code).toBe(
      "AGENT_STUDIO_OBJECT_NOT_FOUND"
    );

    const proposalAttempt = await app.inject({
      method: "POST",
      url: `${base}/proposals`,
      headers: { authorization: `Bearer ${ownerOneToken}` },
      payload: { blueprint_ref: { id: "blueprint", version: 1 } }
    });
    expect(proposalAttempt.statusCode).toBe(404);
    expect(proposalAttempt.json<{ error: { code: string } }>().error.code).toBe("ROUTE_NOT_FOUND");
  });
});
