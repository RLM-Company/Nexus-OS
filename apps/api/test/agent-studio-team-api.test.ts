import { loadServerConfig } from "@cosmora/config";
import {
  AgentBlueprintStore,
  AgentInstanceStore,
  AgentStudioMutationStore,
  AgentTeamStore,
  IdentityStore,
  openDatabase,
  PatternLibraryStore,
  ProjectStore,
  runMigrations,
  type DatabaseHandle
} from "@cosmora/db";
import { validateAgentDelegation } from "@cosmora/policy-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";

const NOW = Date.parse("2026-08-29T09:00:00.000Z");
const PROJECT_ONE = "project-agent-studio-team-1";
const PROJECT_SAME_OWNER = "project-agent-studio-team-3";

const insertProject = (database: DatabaseHandle, id: string, ownerId: string): void => {
  database.sqlite
    .prepare(
      `INSERT INTO projects (id, owner_id, title, status, created_at, updated_at)
       VALUES (?, ?, 'Agent Studio team API', 'ACTIVE', '2026-08-29T08:00:00.000Z',
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

interface PlannedTeam {
  items: Array<{ instance_id: string }>;
  composition_id: string;
  confirmation_required: boolean;
}

describe("Agent Studio team API", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let database: DatabaseHandle;
  let app: ReturnType<typeof buildApp>;
  let ownerOneToken: string;
  let ownerTwoToken: string;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    insertProject(database, PROJECT_ONE, "owner-1");
    insertProject(database, PROJECT_SAME_OWNER, "owner-1");
    insertProject(database, "project-agent-studio-team-2", "owner-2");

    const identityStore = new IdentityStore(database.sqlite, { now: () => NOW });
    identityStore.registerActor("owner-1", "owner-actor-1", "owner");
    identityStore.registerActor("owner-2", "owner-actor-2", "owner");
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

    const patterns = new PatternLibraryStore(database.sqlite, { now: () => NOW });
    const blueprints = new AgentBlueprintStore(database.sqlite, { now: () => NOW });
    const instances = new AgentInstanceStore(database.sqlite, {
      now: () => NOW,
      delegationValidator: validateAgentDelegation
    });
    app = buildApp({
      config,
      database,
      identityStore,
      projectStore: new ProjectStore(database.sqlite),
      patternLibraryStore: patterns,
      agentBlueprintStore: blueprints,
      agentInstanceStore: instances,
      agentTeamStore: new AgentTeamStore(database.sqlite, {
        now: () => NOW,
        blueprints,
        instances
      }),
      agentStudioMutationStore: new AgentStudioMutationStore(database.sqlite, { now: () => NOW }),
      identityResolver: new BearerSessionIdentityResolver(identityStore)
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("returns the single-agent default plan when the project has no blueprints", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ONE}/agent-studio/teams/plan`,
      headers: { authorization: `Bearer ${ownerOneToken}`, "idempotency-key": "team-plan-empty" },
      payload: {}
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [],
      composition_id: "",
      confirmation_required: false
    });
    // No composition means no mutation was recorded for replay.
    expect(response.headers["idempotency-replayed"]).toBeUndefined();
  });

  it("plans, confirms and replays a blueprint roster", async () => {
    const headers = { authorization: `Bearer ${ownerOneToken}` };
    const base = `/api/v1/projects/${PROJECT_ONE}/agent-studio`;

    const createdFunction = await app.inject({
      method: "POST",
      url: `${base}/functions`,
      headers: { ...headers, "idempotency-key": "team-create-function-1" },
      payload: functionBody
    });
    expect(createdFunction.statusCode).toBe(201);
    const agentFunction = createdFunction.json<{ function_id: string; version: number }>();

    const createdPattern = await app.inject({
      method: "POST",
      url: `${base}/patterns`,
      headers: { ...headers, "idempotency-key": "team-create-pattern-1" },
      payload: patternBody(agentFunction.function_id)
    });
    expect(createdPattern.statusCode).toBe(201);
    const pattern = createdPattern.json<{ pattern_id: string; version: number }>();

    const createdBlueprint = await app.inject({
      method: "POST",
      url: `${base}/blueprints`,
      headers: { ...headers, "idempotency-key": "team-create-blueprint-1" },
      payload: blueprintBody(agentFunction.function_id, agentFunction.version, pattern.pattern_id)
    });
    expect(createdBlueprint.statusCode).toBe(201);

    const plan = await app.inject({
      method: "POST",
      url: `${base}/teams/plan`,
      headers: { ...headers, "idempotency-key": "team-plan-1" },
      payload: {}
    });
    expect(plan.statusCode).toBe(201);
    expect(plan.headers["idempotency-replayed"]).toBe("false");
    const planned = plan.json<PlannedTeam>();
    expect(planned.items).toHaveLength(1);
    expect(planned.confirmation_required).toBe(true);
    expect(planned.composition_id).toMatch(/^[0-9a-f]{64}$/);

    const planReplay = await app.inject({
      method: "POST",
      url: `${base}/teams/plan`,
      headers: { ...headers, "idempotency-key": "team-plan-1" },
      payload: {}
    });
    expect(planReplay.statusCode).toBe(200);
    expect(planReplay.headers["idempotency-replayed"]).toBe("true");
    expect(planReplay.json<PlannedTeam>().composition_id).toBe(planned.composition_id);
    expect(planReplay.json<PlannedTeam>().items.map((item) => item.instance_id)).toEqual(
      planned.items.map((item) => item.instance_id)
    );

    const confirmed = await app.inject({
      method: "POST",
      url: `${base}/teams/confirm`,
      headers: { ...headers, "idempotency-key": "team-confirm-1" },
      payload: { instance_ids: planned.items.map((item) => item.instance_id) }
    });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.headers["idempotency-replayed"]).toBe("false");
    expect(confirmed.json<{ composition_id: string }>().composition_id).toBe(
      planned.composition_id
    );

    const confirmReplay = await app.inject({
      method: "POST",
      url: `${base}/teams/confirm`,
      headers: { ...headers, "idempotency-key": "team-confirm-1" },
      payload: { instance_ids: planned.items.map((item) => item.instance_id) }
    });
    expect(confirmReplay.statusCode).toBe(200);
    expect(confirmReplay.headers["idempotency-replayed"]).toBe("true");
    expect(confirmReplay.json<{ composition_id: string }>().composition_id).toBe(
      planned.composition_id
    );

    // A fresh plan reports the confirmed composition as no longer pending.
    const planAfterConfirm = await app.inject({
      method: "POST",
      url: `${base}/teams/plan`,
      headers: { ...headers, "idempotency-key": "team-plan-2" },
      payload: {}
    });
    expect(planAfterConfirm.statusCode).toBe(201);
    expect(planAfterConfirm.json<PlannedTeam>().confirmation_required).toBe(false);

    const events = await app.inject({
      method: "GET",
      url: `${base}/decision-events?limit=50`,
      headers
    });
    expect(events.statusCode).toBe(200);
    const operations = events
      .json<{ items: Array<{ operation: string; object_type: string }> }>()
      .items.map((event) => `${event.object_type}:${event.operation}`);
    expect(operations).toContain("team:team.plan");
    expect(operations).toContain("team:team.confirm");
  });

  it("rejects confirming unknown proposals, empty rosters and foreign projects", async () => {
    const headers = { authorization: `Bearer ${ownerOneToken}` };
    const base = `/api/v1/projects/${PROJECT_ONE}/agent-studio`;

    const unknownInstance = await app.inject({
      method: "POST",
      url: `${base}/teams/confirm`,
      headers: { ...headers, "idempotency-key": "team-confirm-unknown" },
      payload: { instance_ids: ["missing-instance"] }
    });
    expect(unknownInstance.statusCode).toBe(404);
    expect(unknownInstance.json<{ error: { code: string } }>().error.code).toBe(
      "AGENT_STUDIO_OBJECT_NOT_FOUND"
    );

    const emptyRoster = await app.inject({
      method: "POST",
      url: `${base}/teams/confirm`,
      headers: { ...headers, "idempotency-key": "team-confirm-empty" },
      payload: { instance_ids: [] }
    });
    expect(emptyRoster.statusCode).toBe(400);

    const foreignProject = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ONE}/agent-studio/teams/plan`,
      headers: { authorization: `Bearer ${ownerTwoToken}`, "idempotency-key": "team-plan-foreign" },
      payload: {}
    });
    expect(foreignProject.statusCode).toBe(404);
    expect(foreignProject.json<{ error: { code: string } }>().error.code).toBe("PROJECT_NOT_FOUND");
  });
});
