import { createHash } from "node:crypto";
import type { AgentGrant, AgentMemoryScope, WorkArtifactVersion } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  AgentBlueprintStore,
  AgentInstanceStore,
  AgentTeamRunNotFoundError,
  AgentTeamRunStore,
  AgentTeamRunValidationError,
  AgentTeamStore,
  openDatabase,
  PatternLibraryStore,
  runMigrations,
  type AgentDelegationValidator,
  type AgentTeamRunGraphPort,
  type DatabaseHandle,
  type TeamGraphNode
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
       VALUES (?, ?, 'Team run test', 'ACTIVE', '2026-08-28T00:00:00.000Z',
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

const TASK_NAMES = ["Scout", "Builder", "Reviewer"];

const allowAllDelegation: AgentDelegationValidator = () => ({ allowed: true, reasons: [] });

// A minimal in-memory graph port: createOrGet is idempotent by compositionId,
// and nodesOf returns whatever status/artifact binding the test configured.
class FakeGraph implements AgentTeamRunGraphPort {
  readonly created: Array<{
    compositionId: string;
    parts: Array<{ nodeId: string; goal: string }>;
  }> = [];
  nodes: Record<string, TeamGraphNode[]> = {};
  private graphSeq = 0;

  createOrGet(input: {
    ownerId: string;
    actorId: string;
    projectId: string;
    compositionId: string;
    parts: Array<{ instanceId: string; nodeId: string; title: string; goal: string }>;
  }): { graphId: string; nodes: TeamGraphNode[] } {
    const graphId = `graph-${++this.graphSeq}`;
    this.created.push({ compositionId: input.compositionId, parts: input.parts });
    const nodes = input.parts.map((part) => ({
      id: part.nodeId,
      status: "pending",
      workId: null
    }));
    this.nodes[graphId] = nodes;
    return { graphId, nodes };
  }

  nodesOf(graphId: string): TeamGraphNode[] {
    return this.nodes[graphId] ?? [];
  }

  setNodes(graphId: string, nodes: TeamGraphNode[]): void {
    this.nodes[graphId] = nodes;
  }
}

const prepareEnvironment = (database: DatabaseHandle, count: number, taskContractMax = 0) => {
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
  const created = Array.from({ length: count }, (_, index) =>
    blueprints.createBlueprint(owner, {
      project_id: projectId,
      function_ref: { id: agentFunction.function_id, version: 1 },
      behavior_pattern_ref: { id: pattern.pattern_id, version: 1 },
      model_profile_ref: { id: "cosmora-mars", version: 1 },
      grant: grant(projectId),
      memory_scope: memoryScope,
      task_contract:
        taskContractMax > 0
          ? "x".repeat(taskContractMax)
          : `Return the bounded ${TASK_NAMES[index] ?? "task"} result.`,
      start_condition: "Activation is approved in a later gated increment.",
      close_conditions: ["The result is recorded."]
    })
  );
  const instances = new AgentInstanceStore(database.sqlite, {
    now: () => START,
    delegationValidator: allowAllDelegation
  });
  const teams = new AgentTeamStore(database.sqlite, {
    now: () => START,
    blueprints,
    instances
  });
  return { owner, projectId, created, instances, teams };
};

const artifact = (workId: string, published: boolean): WorkArtifactVersion => ({
  id: `${workId}-artifact`,
  project_id: "project-1",
  work_id: workId,
  name: "result.md",
  version: 1,
  sha256: "a".repeat(64),
  bytes: 10,
  published,
  created_at: "2026-08-28T14:00:00.000Z"
});

describe("AgentTeamRunStore", () => {
  it("activates a confirmed composition into one part node per blueprint and is idempotent", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const env = prepareEnvironment(database, 2);
      const plan = env.teams.plan(env.owner, env.projectId);
      const confirmed = env.teams.confirm(
        env.owner,
        env.projectId,
        plan.items.map((item) => item.instance_id)
      );

      const graph = new FakeGraph();
      const runs = new AgentTeamRunStore(database.sqlite, {
        now: () => START,
        instances: env.instances,
        graph,
        runtime: { artifacts: () => [] }
      });
      const first = runs.activate(env.owner, env.projectId, confirmed.composition_id);
      expect(first.composition_id).toBe(confirmed.composition_id);
      expect(first.execution_status).toBe("awaiting_owner_run");
      expect(first.parts).toHaveLength(2);
      expect(first.parts.every((part) => part.status === "active")).toBe(true);
      expect(first.parts.every((part) => part.artifact_count === 0)).toBe(true);
      expect(graph.created).toHaveLength(1);
      // goal is the blueprint task_contract, node ids are stable hashes.
      const parts = graph.created[0]?.parts ?? [];
      expect(new Set(parts.map((part) => part.nodeId)).size).toBe(2);
      for (const part of parts) {
        expect(part.goal).toMatch(/Return the bounded/);
        expect(part.nodeId).toMatch(/^part-[0-9a-f]{16}$/);
      }

      const second = runs.activate(env.owner, env.projectId, confirmed.composition_id);
      expect(second.graph_id).toBe(first.graph_id);
      expect(second.parts.map((p) => p.instance_id)).toEqual(first.parts.map((p) => p.instance_id));
      const rows = database.sqlite.prepare("SELECT COUNT(*) AS n FROM agent_team_parts").get() as {
        n: number;
      };
      expect(rows.n).toBe(2);
    } finally {
      database.close();
    }
  });

  it("refuses activation of an unconfirmed composition", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const env = prepareEnvironment(database, 1);
      const graph = new FakeGraph();
      const runs = new AgentTeamRunStore(database.sqlite, {
        instances: env.instances,
        graph,
        runtime: { artifacts: () => [] }
      });
      const unconfirmed = createHash("sha256").update("n/a").digest("hex");
      expect(() => runs.activate(env.owner, env.projectId, unconfirmed)).toThrow(
        AgentTeamRunNotFoundError
      );
    } finally {
      database.close();
    }
  });

  it("refuses activation when the pending instance roster is incomplete", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const env = prepareEnvironment(database, 2);
      const plan = env.teams.plan(env.owner, env.projectId);
      const confirmed = env.teams.confirm(
        env.owner,
        env.projectId,
        plan.items.map((item) => item.instance_id)
      );
      // Remove one proposal so the recorded roster can no longer be resolved.
      const one = plan.items[0];
      if (!one) throw new Error("fixture instance missing");
      database.sqlite
        .prepare("DELETE FROM agent_instances WHERE instance_id = ?")
        .run(one.instance_id);

      const runs = new AgentTeamRunStore(database.sqlite, {
        instances: env.instances,
        graph: new FakeGraph(),
        runtime: { artifacts: () => [] }
      });
      expect(() => runs.activate(env.owner, env.projectId, confirmed.composition_id)).toThrow(
        AgentTeamRunValidationError
      );
    } finally {
      database.close();
    }
  });

  it("refuses a blueprint task_contract that exceeds the DAG goal limit", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const env = prepareEnvironment(database, 1, 4001);
      const plan = env.teams.plan(env.owner, env.projectId);
      const confirmed = env.teams.confirm(
        env.owner,
        env.projectId,
        plan.items.map((item) => item.instance_id)
      );
      const runs = new AgentTeamRunStore(database.sqlite, {
        instances: env.instances,
        graph: new FakeGraph(),
        runtime: { artifacts: () => [] }
      });
      expect(() => runs.activate(env.owner, env.projectId, confirmed.composition_id)).toThrow(
        AgentTeamRunValidationError
      );
    } finally {
      database.close();
    }
  });

  it("projects part status and published artifact counts from the DAG nodes", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const env = prepareEnvironment(database, 2);
      const plan = env.teams.plan(env.owner, env.projectId);
      const confirmed = env.teams.confirm(
        env.owner,
        env.projectId,
        plan.items.map((item) => item.instance_id)
      );

      const graph = new FakeGraph();
      const publishedByWork: Record<string, WorkArtifactVersion[]> = {
        "work-a": [artifact("work-a", true), artifact("work-a", true), artifact("work-a", false)]
      };
      const runs = new AgentTeamRunStore(database.sqlite, {
        now: () => START,
        instances: env.instances,
        graph,
        runtime: { artifacts: (_p, _o, workId) => (workId ? (publishedByWork[workId] ?? []) : []) }
      });
      const activated = runs.activate(env.owner, env.projectId, confirmed.composition_id);
      const nodeIds = activated.parts.map((part) => part.node_id).sort();
      const [firstNode, secondNode] = nodeIds;
      if (!firstNode || !secondNode) throw new Error("fixture nodes missing");
      graph.setNodes(activated.graph_id, [
        { id: firstNode, status: "completed", workId: "work-a" },
        { id: secondNode, status: "failed", workId: null }
      ]);

      const response = runs.parts(env.owner, env.projectId, confirmed.composition_id);
      const byNode = new Map(response.parts.map((part) => [part.node_id, part]));
      const completed = byNode.get(firstNode);
      const failed = byNode.get(secondNode);
      expect(completed?.status).toBe("completed");
      expect(completed?.artifact_count).toBe(2); // only published versions
      expect(failed?.status).toBe("failed");
      expect(failed?.artifact_count).toBe(0);
    } finally {
      database.close();
    }
  });

  it("returns empty parts for a composition that was never activated", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const env = prepareEnvironment(database, 1);
      const graph = new FakeGraph();
      const runs = new AgentTeamRunStore(database.sqlite, {
        instances: env.instances,
        graph,
        runtime: { artifacts: () => [] }
      });
      const unknown = "f".repeat(64);
      expect(runs.parts(env.owner, env.projectId, unknown)).toEqual({ parts: [] });
    } finally {
      database.close();
    }
  });
});
