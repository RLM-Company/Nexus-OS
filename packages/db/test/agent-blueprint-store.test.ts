import type { AgentGrant, AgentMemoryScope } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  AgentBlueprintConflictError,
  AgentBlueprintNotFoundError,
  AgentBlueprintStore,
  AgentBlueprintValidationError,
  openDatabase,
  PatternLibraryStore,
  runMigrations,
  type DatabaseHandle
} from "../src/index.js";

const NOW = Date.parse("2026-08-28T12:00:00.000Z");

const identity = (ownerId: string, actorId = `${ownerId}-actor`) => ({
  owner_id: ownerId,
  actor_id: actorId
});

const insertProject = (database: DatabaseHandle, id: string, ownerId: string): void => {
  database.sqlite
    .prepare(
      `INSERT INTO projects (id, owner_id, title, status, created_at, updated_at)
       VALUES (?, ?, 'Blueprint test', 'ACTIVE', '2026-08-28T00:00:00.000Z',
         '2026-08-28T00:00:00.000Z')`
    )
    .run(id, ownerId);
};

const grant = (projectId: string): AgentGrant => ({
  project_id: projectId,
  capability_ids: [],
  tool_ids: [],
  data_scope_ids: [],
  object_ids: [],
  budget: { currency: "USD", money_minor: 0, tokens: 10_000, operations: 0 },
  delegation_depth: 0,
  valid_until: "2026-08-29T12:00:00.000Z"
});

const memoryScope: AgentMemoryScope = {
  read_mode: "task",
  source_ids: [],
  write_back: "result_only"
};

const prepareComposition = (database: DatabaseHandle, projectId: string, ownerId: string) => {
  const owner = identity(ownerId);
  const patterns = new PatternLibraryStore(database.sqlite, { now: () => NOW });
  const agentFunction = patterns.createFunction(owner, {
    project_id: projectId,
    name: "Researcher",
    description: "Collects project evidence.",
    result_contract: "Return findings with evidence and open questions."
  });
  const pattern = patterns.createPattern(owner, {
    project_id: projectId,
    name: "Sceptical analyst",
    description: "Tests evidence quality.",
    instructions: "Separate facts from inference and challenge weak sources.",
    allowed_function_ids: [agentFunction.function_id],
    known_limitations: [],
    test_status: "untested"
  });
  return { owner, patterns, agentFunction, pattern };
};

const blueprintInput = (projectId: string, functionId: string, patternId: string) => ({
  project_id: projectId,
  function_ref: { id: functionId, version: 1 },
  behavior_pattern_ref: { id: patternId, version: 1 },
  model_profile_ref: { id: "cosmora-mars", version: 1 },
  grant: grant(projectId),
  memory_scope: memoryScope,
  task_contract: "Answer the bounded research question.",
  start_condition: "The owner approves the future activation separately.",
  close_conditions: ["A result and evidence list are recorded."]
});

const blueprintVersionInput = (projectId: string, functionId: string, patternId: string) => {
  const input = blueprintInput(projectId, functionId, patternId);
  return {
    function_ref: input.function_ref,
    behavior_pattern_ref: input.behavior_pattern_ref,
    model_profile_ref: input.model_profile_ref,
    grant: input.grant,
    memory_scope: input.memory_scope,
    task_contract: input.task_contract,
    start_condition: input.start_condition,
    close_conditions: input.close_conditions
  };
};

describe("AgentBlueprintStore", () => {
  it("persists an inert blueprint while isolating another owner", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      insertProject(database, "project-1", "owner-1");
      insertProject(database, "project-2", "owner-2");
      const { owner, agentFunction, pattern } = prepareComposition(
        database,
        "project-1",
        "owner-1"
      );
      const store = new AgentBlueprintStore(database.sqlite, { now: () => NOW });
      const created = store.createBlueprint(
        owner,
        blueprintInput("project-1", agentFunction.function_id, pattern.pattern_id)
      );

      expect(created).toMatchObject({
        version: 1,
        owner_id: "owner-1",
        project_id: "project-1",
        function_ref: { id: agentFunction.function_id, version: 1 },
        behavior_pattern_ref: { id: pattern.pattern_id, version: 1 }
      });
      expect(store.listBlueprints(owner, "project-1")).toHaveLength(1);
      expect(
        store.getBlueprint(identity("owner-2"), created.blueprint_id, 1, "project-1")
      ).toBeNull();
      expect(store.listBlueprints(identity("owner-2"), "project-1")).toEqual([]);
      expect(() =>
        database.sqlite
          .prepare(
            `INSERT INTO agent_blueprints
              SELECT 'cross-owner-blueprint', 1, 'owner-2', project_id, function_id,
                function_version, pattern_id, pattern_version, model_profile_id,
                model_profile_version, grant_json, memory_scope_json, task_contract,
                start_condition, close_conditions_json, created_by_actor_id, created_at
              FROM agent_blueprints WHERE blueprint_id = ? AND version = 1`
          )
          .run(created.blueprint_id)
      ).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      database.close();
    }
  });

  it("appends immutable versions and preserves referenced archived history", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      insertProject(database, "project-1", "owner-1");
      const { owner, patterns, agentFunction, pattern } = prepareComposition(
        database,
        "project-1",
        "owner-1"
      );
      const store = new AgentBlueprintStore(database.sqlite, { now: () => NOW });
      const input = blueprintInput("project-1", agentFunction.function_id, pattern.pattern_id);
      const first = store.createBlueprint(owner, input);
      input.close_conditions[0] = "Caller mutation must not alter the stored row.";
      const second = store.createBlueprintVersion(
        owner,
        first.blueprint_id,
        {
          ...blueprintVersionInput("project-1", agentFunction.function_id, pattern.pattern_id),
          task_contract: "Review the bounded research result."
        },
        1
      );
      expect(() =>
        store.createBlueprintVersion(
          owner,
          first.blueprint_id,
          blueprintVersionInput("project-1", agentFunction.function_id, pattern.pattern_id),
          1
        )
      ).toThrow(AgentBlueprintConflictError);
      patterns.archivePattern(owner, pattern.pattern_id);

      expect(second.version).toBe(2);
      expect(
        store.getBlueprint(owner, first.blueprint_id, 1, "project-1")?.close_conditions
      ).toEqual(["A result and evidence list are recorded."]);
      expect(store.listBlueprints(owner, "project-1")[0]?.task_contract).toBe(
        "Review the bounded research result."
      );
      expect(() =>
        store.createBlueprintVersion(owner, first.blueprint_id, {
          ...blueprintVersionInput("project-1", agentFunction.function_id, pattern.pattern_id),
          task_contract: "Attempt to reuse an archived pattern."
        })
      ).toThrow(/Archived behavior patterns/);
      expect(() => database.sqlite.prepare("DELETE FROM behavior_patterns").run()).toThrow(
        /FOREIGN KEY constraint failed/
      );
    } finally {
      database.close();
    }
  });

  it("rejects incompatible, cross-project, expired, and authority-shaped input", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      insertProject(database, "project-1", "owner-1");
      insertProject(database, "project-2", "owner-1");
      const { owner, patterns, agentFunction, pattern } = prepareComposition(
        database,
        "project-1",
        "owner-1"
      );
      const otherFunction = patterns.createFunction(owner, {
        project_id: "project-1",
        name: "Writer",
        description: "Writes a final report.",
        result_contract: "Return a concise report."
      });
      const store = new AgentBlueprintStore(database.sqlite, { now: () => NOW });

      expect(() =>
        store.createBlueprint(
          owner,
          blueprintInput("project-1", otherFunction.function_id, pattern.pattern_id)
        )
      ).toThrow(/not compatible/);

      const wrongGrant = blueprintInput("project-1", agentFunction.function_id, pattern.pattern_id);
      wrongGrant.grant.project_id = "project-2";
      expect(() => store.createBlueprint(owner, wrongGrant)).toThrow(/bound to another project/);

      const expired = blueprintInput("project-1", agentFunction.function_id, pattern.pattern_id);
      expired.grant.valid_until = "2026-08-28T11:59:59.000Z";
      expect(() => store.createBlueprint(owner, expired)).toThrow(/expire in the future/);

      expect(() =>
        store.createBlueprint(owner, {
          ...blueprintInput("project-1", agentFunction.function_id, pattern.pattern_id),
          status: "active"
        } as never)
      ).toThrow(/unsupported fields: status/);
      expect(() =>
        store.createBlueprint(
          identity("owner-2"),
          blueprintInput("project-1", agentFunction.function_id, pattern.pattern_id)
        )
      ).toThrow(AgentBlueprintNotFoundError);
    } finally {
      database.close();
    }
  });

  it("fails closed when stored JSON no longer satisfies the contract", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      insertProject(database, "project-1", "owner-1");
      const { owner, agentFunction, pattern } = prepareComposition(
        database,
        "project-1",
        "owner-1"
      );
      const store = new AgentBlueprintStore(database.sqlite, { now: () => NOW });
      const created = store.createBlueprint(
        owner,
        blueprintInput("project-1", agentFunction.function_id, pattern.pattern_id)
      );
      database.sqlite
        .prepare("UPDATE agent_blueprints SET grant_json = '{}' WHERE blueprint_id = ?")
        .run(created.blueprint_id);

      expect(() => store.getBlueprint(owner, created.blueprint_id, 1, "project-1")).toThrow(
        AgentBlueprintValidationError
      );
    } finally {
      database.close();
    }
  });
});
