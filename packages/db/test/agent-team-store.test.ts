import { createHash } from "node:crypto";
import type { AgentGrant, AgentMemoryScope } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  AgentBlueprintStore,
  AgentInstanceNotFoundError,
  AgentInstanceStore,
  AgentTeamCompositionDriftError,
  AgentTeamStore,
  AgentTeamValidationError,
  openDatabase,
  PatternLibraryStore,
  runMigrations,
  type AgentDelegationValidator,
  type DatabaseHandle
} from "../src/index.js";

const START = Date.parse("2026-08-28T14:00:00.000Z");
const AFTER_EXPIRY = Date.parse("2026-08-28T17:00:00.000Z");

const identity = (ownerId: string, actorId = `${ownerId}-actor`) => ({
  owner_id: ownerId,
  actor_id: actorId
});

const insertProject = (database: DatabaseHandle, id: string, ownerId: string): void => {
  database.sqlite
    .prepare(
      `INSERT INTO projects (id, owner_id, title, status, created_at, updated_at)
       VALUES (?, ?, 'Team test', 'ACTIVE', '2026-08-28T00:00:00.000Z',
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
  valid_until: "2026-08-28T16:00:00.000Z"
});

const memoryScope: AgentMemoryScope = {
  read_mode: "task",
  source_ids: [],
  write_back: "result_only"
};

const TASK_NAMES = ["Scout", "Builder"];

const prepareBlueprints = (database: DatabaseHandle, delegationDepths: number[]) => {
  const owner = identity("owner-1");
  const projectId = "project-1";
  insertProject(database, projectId, owner.owner_id);
  const patterns = new PatternLibraryStore(database.sqlite, { now: () => START });
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
  const blueprints = new AgentBlueprintStore(database.sqlite, { now: () => START });
  const created = delegationDepths.map((delegationDepth, index) =>
    blueprints.createBlueprint(owner, {
      project_id: projectId,
      function_ref: { id: agentFunction.function_id, version: 1 },
      behavior_pattern_ref: { id: pattern.pattern_id, version: 1 },
      model_profile_ref: { id: "cosmora-mars", version: 1 },
      grant: { ...grant(projectId), delegation_depth: delegationDepth },
      memory_scope: memoryScope,
      task_contract: `Return the bounded ${TASK_NAMES[index] ?? "task"} result.`,
      start_condition: "Activation is approved in a later gated increment.",
      close_conditions: ["The result is recorded."]
    })
  );
  return { owner, projectId, created };
};

const allowAllDelegation: AgentDelegationValidator = () => ({ allowed: true, reasons: [] });

const prepareTeam = (database: DatabaseHandle, delegationDepths: number[]) => {
  const environment = prepareBlueprints(database, delegationDepths);
  let now = START;
  const instances = new AgentInstanceStore(database.sqlite, {
    now: () => now,
    delegationValidator: allowAllDelegation
  });
  const teams = new AgentTeamStore(database.sqlite, {
    now: () => now,
    blueprints: new AgentBlueprintStore(database.sqlite, { now: () => now }),
    instances
  });
  return {
    ...environment,
    instances,
    teams,
    advanceClock: (value: number): void => {
      now = value;
    }
  };
};

const rosterLines = (
  items: Array<{ blueprint: { blueprint_id: string; version: number } }>
): string[] => items.map((item) => `${item.blueprint.blueprint_id}@${item.blueprint.version}`);

const compositionIdOf = (lines: string[]): string =>
  createHash("sha256")
    .update([...lines].sort().join("\n"), "utf8")
    .digest("hex");

describe("AgentTeamStore", () => {
  it("plans the single-agent default when the project has no blueprints", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const environment = prepareTeam(database, []);
      const plan = environment.teams.plan(environment.owner, environment.projectId);
      expect(plan).toEqual({ items: [], composition_id: "", confirmation_required: false });
      expect(
        environment.instances.listInstances(environment.owner, environment.projectId)
      ).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("plans a pending roster, reuses it, and pins the composition id to the sorted roster", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const environment = prepareTeam(database, [0, 0]);
      const first = environment.teams.plan(environment.owner, environment.projectId);
      expect(first.items).toHaveLength(2);
      expect(first.confirmation_required).toBe(true);
      expect(first.composition_id).toBe(compositionIdOf(rosterLines(first.items)));
      expect(first.items.every((item) => item.status === "proposed")).toBe(true);
      const instanceIds = first.items.map((item) => item.instance_id).sort();
      expect(new Set(instanceIds).size).toBe(2);

      const second = environment.teams.plan(environment.owner, environment.projectId);
      expect(second.composition_id).toBe(first.composition_id);
      expect(second.items.map((item) => item.instance_id).sort()).toEqual(instanceIds);
      expect(
        environment.instances.listInstances(environment.owner, environment.projectId)
      ).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("confirms the composition once, replays it, and treats a repeat as a no-op", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const environment = prepareTeam(database, [0, 0]);
      const plan = environment.teams.plan(environment.owner, environment.projectId);
      const instanceIds = plan.items.map((item) => item.instance_id);

      const confirmed = environment.teams.confirm(
        environment.owner,
        environment.projectId,
        instanceIds
      );
      expect(confirmed.composition_id).toBe(plan.composition_id);
      expect(
        environment.teams.compositionConfirmed(
          environment.owner.owner_id,
          environment.projectId,
          plan.composition_id
        )
      ).toBe(true);

      const repeated = environment.teams.confirm(
        environment.owner,
        environment.projectId,
        instanceIds
      );
      expect(repeated.composition_id).toBe(plan.composition_id);
      const rows = database.sqlite
        .prepare("SELECT COUNT(*) AS n FROM agent_team_compositions")
        .get() as { n: number };
      expect(rows.n).toBe(1);

      const confirmReplay = environment.teams.resolveConfirm(
        environment.owner,
        environment.projectId,
        plan.composition_id
      );
      expect(confirmReplay?.composition_id).toBe(plan.composition_id);
      expect(confirmReplay?.items.map((item) => item.instance_id).sort()).toEqual(
        [...instanceIds].sort()
      );

      const planReplay = environment.teams.resolvePlan(
        environment.owner,
        environment.projectId,
        plan.composition_id
      );
      expect(planReplay?.composition_id).toBe(plan.composition_id);
      expect(planReplay?.confirmation_required).toBe(false);
      expect(planReplay?.items.map((item) => item.instance_id).sort()).toEqual(
        [...instanceIds].sort()
      );

      const unknown = "f".repeat(64);
      expect(
        environment.teams.resolvePlan(environment.owner, environment.projectId, unknown)
      ).toBeNull();
      expect(
        environment.teams.resolveConfirm(environment.owner, environment.projectId, unknown)
      ).toBeNull();
    } finally {
      database.close();
    }
  });

  it("drops expired blueprints from the roster and refuses to confirm their proposals", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const environment = prepareTeam(database, [0]);
      const plan = environment.teams.plan(environment.owner, environment.projectId);
      expect(plan.items).toHaveLength(1);

      environment.advanceClock(AFTER_EXPIRY);
      expect(environment.teams.plan(environment.owner, environment.projectId)).toEqual({
        items: [],
        composition_id: "",
        confirmation_required: false
      });
      expect(() =>
        environment.teams.confirm(
          environment.owner,
          environment.projectId,
          plan.items.map((item) => item.instance_id)
        )
      ).toThrow(AgentTeamValidationError);
    } finally {
      database.close();
    }
  });

  it("rejects confirming a roster for an owner that cannot see the instances", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const environment = prepareTeam(database, [0]);
      const plan = environment.teams.plan(environment.owner, environment.projectId);
      expect(() =>
        environment.teams.confirm(
          identity("owner-2"),
          environment.projectId,
          plan.items.map((item) => item.instance_id)
        )
      ).toThrow(AgentInstanceNotFoundError);
    } finally {
      database.close();
    }
  });

  it("keeps delegated proposals out of the confirmed roster", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const environment = prepareTeam(database, [1, 0]);
      const [parentBlueprint, childBlueprint] = environment.created;
      const parent = environment.instances.proposeRoot(environment.owner, {
        project_id: environment.projectId,
        blueprint_ref: {
          id: parentBlueprint.blueprint_id,
          version: parentBlueprint.version
        }
      });
      const child = environment.instances.proposeDelegated(environment.owner, {
        project_id: environment.projectId,
        parent_instance_id: parent.instance_id,
        blueprint_ref: {
          id: childBlueprint.blueprint_id,
          version: childBlueprint.version
        }
      });
      expect(child.parent_instance_id).toBe(parent.instance_id);
      expect(() =>
        environment.teams.confirm(environment.owner, environment.projectId, [child.instance_id])
      ).toThrow(AgentTeamValidationError);
      expect(() =>
        environment.teams.confirm(environment.owner, environment.projectId, [
          parent.instance_id,
          child.instance_id
        ])
      ).toThrow(AgentTeamValidationError);
    } finally {
      database.close();
    }
  });

  it("raises an honest conflict when a recorded composition no longer hashes to its roster", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const environment = prepareTeam(database, [0]);
      const plan = environment.teams.plan(environment.owner, environment.projectId);
      environment.teams.confirm(
        environment.owner,
        environment.projectId,
        plan.items.map((item) => item.instance_id)
      );
      database.sqlite
        .prepare("UPDATE agent_team_compositions SET blueprint_refs_json = ?")
        .run('["tampered@1"]');
      expect(() =>
        environment.teams.resolveConfirm(
          environment.owner,
          environment.projectId,
          plan.composition_id
        )
      ).toThrow(AgentTeamCompositionDriftError);
    } finally {
      database.close();
    }
  });
});
