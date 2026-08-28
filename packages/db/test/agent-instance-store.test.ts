import type { AgentGrant, AgentMemoryScope } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  AgentBlueprintStore,
  AgentInstanceDelegationError,
  AgentInstanceStore,
  AgentInstanceValidationError,
  openDatabase,
  PatternLibraryStore,
  runMigrations,
  type AgentDelegationValidator,
  type DatabaseHandle
} from "../src/index.js";

const START = Date.parse("2026-08-28T14:00:00.000Z");

const identity = (ownerId: string, actorId = `${ownerId}-actor`) => ({
  owner_id: ownerId,
  actor_id: actorId
});

const insertProject = (database: DatabaseHandle, id: string, ownerId: string): void => {
  database.sqlite
    .prepare(
      `INSERT INTO projects (id, owner_id, title, status, created_at, updated_at)
       VALUES (?, ?, 'Instance test', 'ACTIVE', '2026-08-28T00:00:00.000Z',
         '2026-08-28T00:00:00.000Z')`
    )
    .run(id, ownerId);
};

const grant = (projectId: string, delegationDepth: number): AgentGrant => ({
  project_id: projectId,
  capability_ids: [],
  tool_ids: [],
  data_scope_ids: [],
  object_ids: [],
  budget: { currency: "USD", money_minor: 0, tokens: 10_000, operations: 0 },
  delegation_depth: delegationDepth,
  valid_until: "2026-08-28T16:00:00.000Z"
});

const memoryScope: AgentMemoryScope = {
  read_mode: "task",
  source_ids: [],
  write_back: "result_only"
};

const prepareBlueprints = (database: DatabaseHandle, now: () => number) => {
  const owner = identity("owner-1");
  const projectId = "project-1";
  insertProject(database, projectId, owner.owner_id);
  const patterns = new PatternLibraryStore(database.sqlite, { now });
  const agentFunction = patterns.createFunction(owner, {
    project_id: projectId,
    name: "Researcher",
    description: "Collects bounded evidence.",
    result_contract: "Return findings, evidence, and open questions."
  });
  const pattern = patterns.createPattern(owner, {
    project_id: projectId,
    name: "Sceptical analyst",
    description: "Challenges weak evidence.",
    instructions: "Separate fact from inference.",
    allowed_function_ids: [agentFunction.function_id],
    known_limitations: [],
    test_status: "untested"
  });
  const blueprints = new AgentBlueprintStore(database.sqlite, { now });
  const createBlueprint = (delegationDepth: number) =>
    blueprints.createBlueprint(owner, {
      project_id: projectId,
      function_ref: { id: agentFunction.function_id, version: 1 },
      behavior_pattern_ref: { id: pattern.pattern_id, version: 1 },
      model_profile_ref: { id: "cosmora-mars", version: 1 },
      grant: grant(projectId, delegationDepth),
      memory_scope: memoryScope,
      task_contract: "Return the bounded project result.",
      start_condition: "Activation is approved in a later gated increment.",
      close_conditions: ["The result is recorded."]
    });
  return {
    owner,
    projectId,
    parentBlueprint: createBlueprint(1),
    childBlueprint: createBlueprint(0)
  };
};

describe("AgentInstanceStore", () => {
  it("persists only owner-visible root proposals and rejects direct activation", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const environment = prepareBlueprints(database, () => START);
      const store = new AgentInstanceStore(database.sqlite, { now: () => START });
      const root = store.proposeRoot(environment.owner, {
        project_id: environment.projectId,
        blueprint_ref: {
          id: environment.parentBlueprint.blueprint_id,
          version: environment.parentBlueprint.version
        }
      });

      expect(root).toMatchObject({
        status: "proposed",
        parent_instance_id: null,
        closed_at: null,
        blueprint: { blueprint_id: environment.parentBlueprint.blueprint_id }
      });
      expect(store.listInstances(environment.owner, environment.projectId)).toHaveLength(1);
      expect(
        store.getInstance(identity("owner-2"), environment.projectId, root.instance_id)
      ).toBeNull();
      expect(() =>
        database.sqlite
          .prepare(
            `INSERT INTO agent_instances
              SELECT 'forced-active', owner_id, project_id, blueprint_id, blueprint_version,
                NULL, 'active', created_at, updated_at, NULL
              FROM agent_instances WHERE instance_id = ?`
          )
          .run(root.instance_id)
      ).toThrow(/CHECK constraint failed/);
      expect(() =>
        store.proposeRoot(environment.owner, {
          project_id: environment.projectId,
          blueprint_ref: { id: environment.parentBlueprint.blueprint_id, version: 1 },
          status: "active"
        } as never)
      ).toThrow(/unsupported fields: status/);
    } finally {
      database.close();
    }
  });

  it("fails closed for delegated proposals without a Policy Engine validator", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const environment = prepareBlueprints(database, () => START);
      const store = new AgentInstanceStore(database.sqlite, { now: () => START });
      const parent = store.proposeRoot(environment.owner, {
        project_id: environment.projectId,
        blueprint_ref: { id: environment.parentBlueprint.blueprint_id, version: 1 }
      });

      expect(() =>
        store.proposeDelegated(environment.owner, {
          project_id: environment.projectId,
          blueprint_ref: { id: environment.childBlueprint.blueprint_id, version: 1 },
          parent_instance_id: parent.instance_id
        })
      ).toThrow(/No Policy Engine delegation validator/);
      expect(store.listInstances(environment.owner, environment.projectId)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("persists a delegated proposal only after an explicit allowed decision", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const environment = prepareBlueprints(database, () => START);
      const evaluated: string[] = [];
      const validator: AgentDelegationValidator = (parent, child, evaluatedAt) => {
        evaluated.push(parent.blueprint_id, child.blueprint_id, evaluatedAt);
        return { allowed: true, reasons: [] };
      };
      const store = new AgentInstanceStore(database.sqlite, {
        now: () => START,
        delegationValidator: validator
      });
      const parent = store.proposeRoot(environment.owner, {
        project_id: environment.projectId,
        blueprint_ref: { id: environment.parentBlueprint.blueprint_id, version: 1 }
      });
      const child = store.proposeDelegated(environment.owner, {
        project_id: environment.projectId,
        blueprint_ref: { id: environment.childBlueprint.blueprint_id, version: 1 },
        parent_instance_id: parent.instance_id
      });

      expect(child).toMatchObject({
        status: "proposed",
        parent_instance_id: parent.instance_id,
        blueprint: { blueprint_id: environment.childBlueprint.blueprint_id }
      });
      expect(evaluated).toEqual([
        environment.parentBlueprint.blueprint_id,
        environment.childBlueprint.blueprint_id,
        "2026-08-28T14:00:00.000Z"
      ]);

      const denied = new AgentInstanceStore(database.sqlite, {
        now: () => START,
        delegationValidator: () => ({ allowed: false, reasons: ["Budget expands."] })
      });
      expect(() =>
        denied.proposeDelegated(environment.owner, {
          project_id: environment.projectId,
          blueprint_ref: { id: environment.childBlueprint.blueprint_id, version: 1 },
          parent_instance_id: parent.instance_id
        })
      ).toThrow(AgentInstanceDelegationError);
      expect(store.listInstances(environment.owner, environment.projectId)).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("rejects proposals after the blueprint grant expires", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const environment = prepareBlueprints(database, () => START);
      const store = new AgentInstanceStore(database.sqlite, {
        now: () => Date.parse("2026-08-28T16:00:00.000Z")
      });

      expect(() =>
        store.proposeRoot(environment.owner, {
          project_id: environment.projectId,
          blueprint_ref: { id: environment.parentBlueprint.blueprint_id, version: 1 }
        })
      ).toThrow(AgentInstanceValidationError);
    } finally {
      database.close();
    }
  });
});
