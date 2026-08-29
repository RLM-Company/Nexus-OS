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
const PROJECT_ONE = "project-agent-studio-1";

const insertProject = (database: DatabaseHandle, id: string, ownerId: string): void => {
  database.sqlite
    .prepare(
      `INSERT INTO projects (id, owner_id, title, status, created_at, updated_at)
       VALUES (?, ?, 'Agent Studio API', 'ACTIVE', '2026-08-29T08:00:00.000Z',
         '2026-08-29T08:00:00.000Z')`
    )
    .run(id, ownerId);
};

describe("Agent Studio owner read API", () => {
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
    insertProject(database, "project-agent-studio-2", "owner-2");

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
    const agentFunction = patterns.createFunction(
      { owner_id: "owner-1", actor_id: "owner-actor-1" },
      {
        project_id: PROJECT_ONE,
        name: "Researcher",
        description: "Collects bounded evidence.",
        result_contract: "Return findings, sources, and open questions."
      }
    );
    const activePattern = patterns.createPattern(
      { owner_id: "owner-1", actor_id: "owner-actor-1" },
      {
        project_id: PROJECT_ONE,
        name: "Skeptical analyst",
        description: "Challenges weak evidence.",
        instructions: "Separate fact from inference.",
        allowed_function_ids: [agentFunction.function_id],
        known_limitations: [],
        test_status: "untested"
      }
    );
    const archivedPattern = patterns.createPattern(
      { owner_id: "owner-1", actor_id: "owner-actor-1" },
      {
        project_id: PROJECT_ONE,
        name: "Retired style",
        description: "A retired preview style.",
        instructions: "Do not use for new compositions.",
        allowed_function_ids: [agentFunction.function_id],
        known_limitations: ["Archived."],
        test_status: "rejected"
      }
    );
    patterns.archivePattern(
      { owner_id: "owner-1", actor_id: "owner-actor-1" },
      archivedPattern.pattern_id
    );

    const blueprints = new AgentBlueprintStore(database.sqlite, { now: () => NOW });
    const blueprint = blueprints.createBlueprint(
      { owner_id: "owner-1", actor_id: "owner-actor-1" },
      {
        project_id: PROJECT_ONE,
        function_ref: { id: agentFunction.function_id, version: agentFunction.version },
        behavior_pattern_ref: { id: activePattern.pattern_id, version: activePattern.version },
        model_profile_ref: { id: "cosmora-mars", version: 1 },
        grant: {
          project_id: PROJECT_ONE,
          capability_ids: ["context.project.read"],
          tool_ids: [],
          data_scope_ids: ["project-memory"],
          object_ids: [PROJECT_ONE],
          budget: { currency: "USD", money_minor: 0, tokens: 10_000, operations: 0 },
          delegation_depth: 0,
          valid_until: "2026-08-30T09:00:00.000Z"
        },
        memory_scope: {
          read_mode: "project_segments",
          source_ids: ["project-memory"],
          write_back: "result_and_evidence"
        },
        task_contract: "Return the bounded project result.",
        start_condition: "A later activation increment explicitly approves the proposal.",
        close_conditions: ["The result is accepted."]
      }
    );
    const instances = new AgentInstanceStore(database.sqlite, { now: () => NOW });
    instances.proposeRoot(
      { owner_id: "owner-1", actor_id: "owner-actor-1" },
      {
        project_id: PROJECT_ONE,
        blueprint_ref: { id: blueprint.blueprint_id, version: blueprint.version }
      }
    );

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

  it("lists owner-visible functions, patterns, blueprints, and proposed instances", async () => {
    const headers = { authorization: `Bearer ${ownerOneToken}` };
    const base = `/api/v1/projects/${PROJECT_ONE}/agent-studio`;
    const functions = await app.inject({ method: "GET", url: `${base}/functions`, headers });
    const patterns = await app.inject({ method: "GET", url: `${base}/patterns`, headers });
    const allPatterns = await app.inject({
      method: "GET",
      url: `${base}/patterns?include_archived=true`,
      headers
    });
    const blueprints = await app.inject({ method: "GET", url: `${base}/blueprints`, headers });
    const proposals = await app.inject({ method: "GET", url: `${base}/proposals`, headers });

    expect(functions.statusCode).toBe(200);
    expect(functions.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(patterns.statusCode).toBe(200);
    expect(patterns.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(allPatterns.json<{ items: unknown[] }>().items).toHaveLength(2);
    expect(blueprints.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(proposals.json<{ items: Array<{ status: string }> }>().items).toEqual([
      expect.objectContaining({ status: "proposed" })
    ]);
    for (const response of [functions, patterns, allPatterns, blueprints, proposals]) {
      expect(response.body).not.toContain(ownerOneToken);
    }
  });

  it("returns the same project-not-found response across the owner boundary", async () => {
    const headers = { authorization: `Bearer ${ownerTwoToken}` };
    const base = `/api/v1/projects/${PROJECT_ONE}/agent-studio`;

    for (const resource of ["functions", "patterns", "blueprints", "proposals"]) {
      const response = await app.inject({ method: "GET", url: `${base}/${resource}`, headers });
      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("PROJECT_NOT_FOUND");
      expect(response.body).not.toContain("owner-1");
    }
  });

  it("denies agent sessions and exposes no write route", async () => {
    const base = `/api/v1/projects/${PROJECT_ONE}/agent-studio`;
    const denied = await app.inject({
      method: "GET",
      url: `${base}/functions`,
      headers: { authorization: `Bearer ${agentToken}` }
    });
    const writeAttempt = await app.inject({
      method: "POST",
      url: `${base}/functions`,
      headers: { authorization: `Bearer ${ownerOneToken}` },
      payload: { name: "Unexpected write" }
    });

    expect(denied.statusCode).toBe(403);
    expect(writeAttempt.statusCode).toBe(404);
    expect(writeAttempt.json<{ error: { code: string } }>().error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("rejects malformed query parameters without reading the store", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${PROJECT_ONE}/agent-studio/patterns?include_archived=maybe`,
      headers: { authorization: `Bearer ${ownerOneToken}` }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_ERROR");
  });
});
