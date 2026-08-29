import { loadServerConfig } from "@cosmora/config";
import {
  AgentBlueprintStore,
  AgentInstanceStore,
  AgentStudioMutationStore,
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

const blueprintBody = (
  functionId: string,
  functionVersion: number,
  patternId: string,
  delegationDepth = 0
) => ({
  function_ref: { id: functionId, version: functionVersion },
  behavior_pattern_ref: { id: patternId, version: 1 },
  model_profile_ref: { id: "cosmora-mars", version: 1 },
  grant: {
    capability_ids: ["context.project.read"],
    tool_ids: [],
    data_scope_ids: ["project-memory"],
    object_ids: [PROJECT_ONE],
    budget: { currency: "USD", money_minor: 0, tokens: 10_000, operations: 0 },
    delegation_depth: delegationDepth,
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
      agentStudioMutationStore: new AgentStudioMutationStore(database.sqlite, { now: () => NOW }),
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
      headers: { ...headers, "idempotency-key": "create-function-1" },
      payload: functionBody
    });
    expect(createdFunction.statusCode).toBe(201);
    const agentFunction = createdFunction.json<{
      function_id: string;
      version: number;
      project_id: string;
    }>();
    expect(agentFunction).toMatchObject({ version: 1, project_id: PROJECT_ONE });
    expect(createdFunction.headers["idempotency-replayed"]).toBe("false");

    const replayedFunction = await app.inject({
      method: "POST",
      url: `${base}/functions`,
      headers: { ...headers, "idempotency-key": "create-function-1" },
      payload: functionBody
    });
    expect(replayedFunction.statusCode).toBe(200);
    expect(replayedFunction.headers["idempotency-replayed"]).toBe("true");
    expect(replayedFunction.json<{ function_id: string }>().function_id).toBe(
      agentFunction.function_id
    );
    const conflictingReplay = await app.inject({
      method: "POST",
      url: `${base}/functions`,
      headers: { ...headers, "idempotency-key": "create-function-1" },
      payload: { ...functionBody, name: "Different request" }
    });
    expect(conflictingReplay.statusCode).toBe(409);

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
      headers: { ...headers, "idempotency-key": "create-pattern-1" },
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
      headers: { ...headers, "idempotency-key": "create-blueprint-1" },
      payload: blueprintBody(agentFunction.function_id, 2, pattern.pattern_id, 1)
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
        ...blueprintBody(agentFunction.function_id, 2, pattern.pattern_id, 1),
        expected_version: 1,
        task_contract: "Review and return the bounded project result."
      }
    });
    expect(blueprintVersion.statusCode).toBe(201);
    expect(blueprintVersion.json<{ version: number }>().version).toBe(2);

    const createdProposal = await app.inject({
      method: "POST",
      url: `${base}/proposals`,
      headers: { ...headers, "idempotency-key": "create-root-proposal-1" },
      payload: { blueprint_ref: { id: blueprint.blueprint_id, version: 2 } }
    });
    expect(createdProposal.statusCode).toBe(201);
    const proposal = createdProposal.json<{
      instance_id: string;
      status: string;
      parent_instance_id: string | null;
    }>();
    expect(proposal).toMatchObject({ status: "proposed", parent_instance_id: null });
    const replayedProposal = await app.inject({
      method: "POST",
      url: `${base}/proposals`,
      headers: { ...headers, "idempotency-key": "create-root-proposal-1" },
      payload: { blueprint_ref: { id: blueprint.blueprint_id, version: 2 } }
    });
    expect(replayedProposal.statusCode).toBe(200);
    expect(replayedProposal.headers["idempotency-replayed"]).toBe("true");
    expect(replayedProposal.json<{ instance_id: string }>().instance_id).toBe(proposal.instance_id);

    const childBlueprintResponse = await app.inject({
      method: "POST",
      url: `${base}/blueprints`,
      headers: { ...headers, "idempotency-key": "create-child-blueprint-1" },
      payload: {
        ...blueprintBody(agentFunction.function_id, 2, pattern.pattern_id, 0),
        task_contract: "Return one delegated, bounded project result."
      }
    });
    expect(childBlueprintResponse.statusCode).toBe(201);
    const childBlueprint = childBlueprintResponse.json<{
      blueprint_id: string;
      version: number;
    }>();
    const delegatedProposal = await app.inject({
      method: "POST",
      url: `${base}/proposals/delegated`,
      headers: { ...headers, "idempotency-key": "create-delegated-proposal-1" },
      payload: {
        parent_instance_id: proposal.instance_id,
        blueprint_ref: { id: childBlueprint.blueprint_id, version: childBlueprint.version }
      }
    });
    expect(delegatedProposal.statusCode).toBe(201);
    const delegated = delegatedProposal.json<{
      instance_id: string;
      status: string;
      parent_instance_id: string | null;
    }>();
    expect(delegated).toMatchObject({
      status: "proposed",
      parent_instance_id: proposal.instance_id
    });
    const delegatedReplay = await app.inject({
      method: "POST",
      url: `${base}/proposals/delegated`,
      headers: { ...headers, "idempotency-key": "create-delegated-proposal-1" },
      payload: {
        parent_instance_id: proposal.instance_id,
        blueprint_ref: { id: childBlueprint.blueprint_id, version: childBlueprint.version }
      }
    });
    expect(delegatedReplay.statusCode).toBe(200);
    expect(delegatedReplay.json<{ instance_id: string }>().instance_id).toBe(delegated.instance_id);

    const expandedBlueprintResponse = await app.inject({
      method: "POST",
      url: `${base}/blueprints`,
      headers: { ...headers, "idempotency-key": "create-expanded-child-blueprint-1" },
      payload: {
        ...blueprintBody(agentFunction.function_id, 2, pattern.pattern_id, 0),
        grant: {
          ...blueprintBody(agentFunction.function_id, 2, pattern.pattern_id, 0).grant,
          budget: { currency: "USD", money_minor: 0, tokens: 20_000, operations: 0 }
        }
      }
    });
    expect(expandedBlueprintResponse.statusCode).toBe(201);
    const expandedBlueprint = expandedBlueprintResponse.json<{
      blueprint_id: string;
      version: number;
    }>();
    const deniedDelegation = await app.inject({
      method: "POST",
      url: `${base}/proposals/delegated`,
      headers: { ...headers, "idempotency-key": "deny-expanded-delegation-1" },
      payload: {
        parent_instance_id: proposal.instance_id,
        blueprint_ref: { id: expandedBlueprint.blueprint_id, version: expandedBlueprint.version }
      }
    });
    expect(deniedDelegation.statusCode).toBe(403);
    expect(deniedDelegation.json<{ error: { code: string } }>().error.code).toBe("POLICY_DENIED");
    const proposalsAfterDenial = await app.inject({
      method: "GET",
      url: `${base}/proposals`,
      headers
    });
    expect(proposalsAfterDenial.json<{ items: unknown[] }>().items).toHaveLength(2);

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

    const decisionEvents = await app.inject({
      method: "GET",
      url: `${base}/decision-events?limit=100`,
      headers
    });
    expect(decisionEvents.statusCode).toBe(200);
    const events = decisionEvents.json<{
      items: Array<{
        operation: string;
        object_type: string;
        object_ref: { id: string; version: number };
      }>;
    }>().items;
    expect(events).toHaveLength(11);
    expect(events.map((event) => event.operation)).toEqual([
      "pattern.archive",
      "blueprint.create",
      "proposal.delegated",
      "blueprint.create",
      "proposal.root",
      "blueprint.version",
      "blueprint.create",
      "pattern.version",
      "pattern.create",
      "function.version",
      "function.create"
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        object_type: "proposal",
        object_ref: { id: proposal.instance_id, version: 1 }
      })
    );
    expect(decisionEvents.body).not.toContain(functionBody.result_contract);
    expect(decisionEvents.body).not.toContain(patternBody(agentFunction.function_id).instructions);
  });

  it("keeps path ownership authoritative and delegated proposals fail closed", async () => {
    const base = `/api/v1/projects/${PROJECT_ONE}/agent-studio`;
    const crossOwner = await app.inject({
      method: "POST",
      url: `${base}/functions`,
      headers: {
        authorization: `Bearer ${ownerTwoToken}`,
        "idempotency-key": "cross-owner-create"
      },
      payload: functionBody
    });
    expect(crossOwner.statusCode).toBe(404);
    expect(crossOwner.json<{ error: { code: string } }>().error.code).toBe("PROJECT_NOT_FOUND");

    const agentDenied = await app.inject({
      method: "POST",
      url: `${base}/functions`,
      headers: {
        authorization: `Bearer ${agentToken}`,
        "idempotency-key": "agent-create"
      },
      payload: functionBody
    });
    expect(agentDenied.statusCode).toBe(403);

    const missingIdempotencyKey = await app.inject({
      method: "POST",
      url: `${base}/functions`,
      headers: { authorization: `Bearer ${ownerOneToken}` },
      payload: functionBody
    });
    expect(missingIdempotencyKey.statusCode).toBe(400);
    expect(missingIdempotencyKey.json<{ error: { code: string } }>().error.code).toBe(
      "VALIDATION_ERROR"
    );

    const malformedPattern = await app.inject({
      method: "POST",
      url: `${base}/patterns`,
      headers: {
        authorization: `Bearer ${ownerOneToken}`,
        "idempotency-key": "malformed-pattern"
      },
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

    const delegatedProposalAttempt = await app.inject({
      method: "POST",
      url: `${base}/proposals/delegated`,
      headers: {
        authorization: `Bearer ${ownerOneToken}`,
        "idempotency-key": "missing-delegation-objects"
      },
      payload: {
        parent_instance_id: "missing-parent",
        blueprint_ref: { id: "blueprint", version: 1 }
      }
    });
    expect(delegatedProposalAttempt.statusCode).toBe(404);
    expect(delegatedProposalAttempt.json<{ error: { code: string } }>().error.code).toBe(
      "AGENT_STUDIO_OBJECT_NOT_FOUND"
    );
  });
});
