import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ActivateAgentTeamResponse,
  AgentTeamPart,
  AgentTeamPartsResponse
} from "@cosmora/contracts";
import type { AgentInstanceStore, AgentInstanceIdentity } from "./agent-instance-store.js";
import { WorkRuntimeStore } from "./work-runtime-store.js";

export interface TeamGraphNode {
  id: string;
  status: string;
  workId: string | null;
}

export interface AgentTeamRunGraphPort {
  /** Create or return the DAG for this composition (idempotent by client_request_id). */
  createOrGet(input: {
    ownerId: string;
    actorId: string;
    projectId: string;
    compositionId: string;
    parts: Array<{ instanceId: string; nodeId: string; title: string; goal: string }>;
  }): { graphId: string; nodes: TeamGraphNode[] };
  nodesOf(graphId: string, ownerId: string, projectId: string): TeamGraphNode[];
}

export interface AgentTeamRunStoreOptions {
  now?: () => number;
  instances: AgentInstanceStore;
  graph: AgentTeamRunGraphPort;
  /** Narrow port so tests can supply artifact metadata without a full DB-backed store. */
  runtime?: Pick<WorkRuntimeStore, "artifacts">;
}

export class AgentTeamRunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTeamRunValidationError";
  }
}

export class AgentTeamRunNotFoundError extends Error {
  constructor(message = "Confirmed team composition was not found") {
    super(message);
    this.name = "AgentTeamRunNotFoundError";
  }
}

const rosterLine = (blueprint: { blueprint_id: string; version: number }): string =>
  `${blueprint.blueprint_id}@${blueprint.version}`;

// WorkDagNodeInput.goal is bounded to 4000 chars while a blueprint's
// task_contract may be up to 20000. A part node must carry a DAG-valid goal,
// so activation refuses an oversized contract instead of persisting a graph
// that violates its own input schema.
const MAX_PART_GOAL = 4000;

// Stable node id for a part: a short hash of the roster line keeps node ids
// within the WorkDagNodeInput pattern and stable across activations.
const nodeIdFor = (line: string): string =>
  `part-${createHash("sha256").update(line, "utf8").digest("hex").slice(0, 16)}`;

export class AgentTeamRunStore {
  readonly #sqlite: DatabaseSync;
  readonly #now: () => number;
  readonly #instances: AgentInstanceStore;
  readonly #graph: AgentTeamRunGraphPort;
  readonly #runtime: Pick<WorkRuntimeStore, "artifacts">;

  constructor(sqlite: DatabaseSync, options: AgentTeamRunStoreOptions) {
    this.#sqlite = sqlite;
    this.#now = options.now ?? Date.now;
    this.#instances = options.instances;
    this.#graph = options.graph;
    this.#runtime = options.runtime ?? new WorkRuntimeStore(sqlite);
  }

  // Activate a confirmed composition: one DAG node per blueprint (goal = the
  // blueprint task_contract). Owner confirmation is a precondition; part rows
  // are inserted once (INSERT OR IGNORE), so a repeat returns the same graph.
  // No model dispatch happens here: run_plan's explicit owner authorization
  // still gates every paid operation.
  activate(
    identity: AgentInstanceIdentity,
    projectId: string,
    compositionId: string
  ): ActivateAgentTeamResponse {
    if (!/^[0-9a-f]{64}$/.test(compositionId)) {
      throw new AgentTeamRunValidationError("Invalid team composition id");
    }
    const row = this.#sqlite
      .prepare(
        `SELECT blueprint_refs_json FROM agent_team_compositions
         WHERE owner_id = ? AND project_id = ? AND composition_id = ?`
      )
      .get(identity.owner_id, projectId, compositionId) as
      { blueprint_refs_json: string } | undefined;
    if (!row) throw new AgentTeamRunNotFoundError();

    let recorded: unknown;
    try {
      recorded = JSON.parse(row.blueprint_refs_json);
    } catch {
      throw new AgentTeamRunValidationError("Recorded composition roster is corrupt");
    }
    if (!Array.isArray(recorded) || recorded.some((line) => typeof line !== "string")) {
      throw new AgentTeamRunValidationError("Recorded composition roster is corrupt");
    }
    const roster = recorded as string[];
    if (roster.length === 0 || roster.length > 32 || new Set(roster).size !== roster.length) {
      throw new AgentTeamRunValidationError("Recorded composition roster is invalid");
    }
    // A repeat activation resolves entirely from the recorded lifecycle rows:
    // the graph is never re-created and the same graph_id is returned. The
    // graph port is idempotent too, but the store does not rely on that alone.
    const existing = this.#sqlite
      .prepare(
        `SELECT graph_id FROM agent_team_parts
         WHERE owner_id = ? AND project_id = ? AND composition_id = ? LIMIT 1`
      )
      .get(identity.owner_id, projectId, compositionId) as { graph_id: string } | undefined;
    if (existing) {
      const nodes = this.#graph.nodesOf(existing.graph_id, identity.owner_id, projectId);
      return {
        composition_id: compositionId,
        graph_id: existing.graph_id,
        parts: this.#parts(identity, projectId, compositionId, nodes),
        execution_status: "awaiting_owner_run"
      };
    }
    const timestamp = this.#timestamp();

    const wanted = new Set(roster);
    const byLine = new Map<string, { instanceId: string; goal: string }>();
    for (const instance of this.#instances.listInstances(identity, projectId)) {
      if (instance.parent_instance_id !== null || instance.status !== "proposed") continue;
      const line = rosterLine(instance.blueprint);
      if (!wanted.has(line) || byLine.has(line)) continue;
      if (instance.blueprint.task_contract.length > MAX_PART_GOAL) {
        throw new AgentTeamRunValidationError(
          "A blueprint task contract exceeds the part node goal limit (4000 characters)"
        );
      }
      byLine.set(line, {
        instanceId: instance.instance_id,
        goal: instance.blueprint.task_contract
      });
    }
    if (byLine.size !== roster.length) {
      throw new AgentTeamRunValidationError(
        "The confirmed composition no longer has a complete pending instance roster"
      );
    }
    const parts = roster.map((line) => {
      const part = byLine.get(line)!;
      return { ...part, nodeId: nodeIdFor(line), line };
    });

    const created = this.#graph.createOrGet({
      ownerId: identity.owner_id,
      actorId: identity.actor_id,
      projectId,
      compositionId,
      parts: parts.map((part) => ({
        instanceId: part.instanceId,
        nodeId: part.nodeId,
        title: `Part ${part.line}`,
        goal: part.goal
      }))
    });
    for (const part of parts) {
      this.#sqlite
        .prepare(
          `INSERT OR IGNORE INTO agent_team_parts
            (owner_id, project_id, composition_id, graph_id, instance_id, node_id,
             status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
        )
        .run(
          identity.owner_id,
          projectId,
          compositionId,
          created.graphId,
          part.instanceId,
          part.nodeId,
          timestamp,
          timestamp
        );
    }
    return {
      composition_id: compositionId,
      graph_id: created.graphId,
      parts: this.#parts(identity, projectId, compositionId, created.nodes),
      execution_status: "awaiting_owner_run"
    };
  }

  parts(
    identity: AgentInstanceIdentity,
    projectId: string,
    compositionId: string
  ): AgentTeamPartsResponse {
    const graphId = this.#sqlite
      .prepare(
        `SELECT graph_id FROM agent_team_parts
         WHERE owner_id = ? AND project_id = ? AND composition_id = ? LIMIT 1`
      )
      .get(identity.owner_id, projectId, compositionId) as { graph_id: string } | undefined;
    const nodes = graphId
      ? this.#graph.nodesOf(graphId.graph_id, identity.owner_id, projectId)
      : [];
    return { parts: this.#parts(identity, projectId, compositionId, nodes) };
  }

  // Status and artifact counts come from the DAG nodes' bound child Work and
  // the immutable published artifact versions — no status is trusted from the
  // parts table alone.
  #parts(
    identity: AgentInstanceIdentity,
    projectId: string,
    compositionId: string,
    nodes: TeamGraphNode[]
  ): AgentTeamPart[] {
    const rows = this.#sqlite
      .prepare(
        `SELECT instance_id, node_id, updated_at FROM agent_team_parts
         WHERE owner_id = ? AND project_id = ? AND composition_id = ? ORDER BY node_id`
      )
      .all(identity.owner_id, projectId, compositionId) as Array<{
      instance_id: string;
      node_id: string;
      updated_at: string;
    }>;
    const byNode = new Map(nodes.map((node) => [node.id, node]));
    return rows.map((row) => {
      const node = byNode.get(row.node_id);
      const artifactCount = node?.workId
        ? this.#runtime
            .artifacts(projectId, identity.owner_id, node.workId)
            .filter((artifact) => artifact.published).length
        : 0;
      return {
        instance_id: row.instance_id,
        node_id: row.node_id,
        status: this.#statusOf(node?.status),
        artifact_count: artifactCount,
        updated_at: row.updated_at
      };
    });
  }

  #statusOf(nodeStatus: string | undefined): AgentTeamPart["status"] {
    if (nodeStatus === "completed") return "completed";
    if (nodeStatus === "failed") return "failed";
    if (nodeStatus === "cancelled") return "cancelled";
    return "active";
  }

  #timestamp(): string {
    const now = this.#now();
    if (!Number.isFinite(now)) throw new AgentTeamRunValidationError("Invalid store clock");
    return new Date(now).toISOString();
  }
}
