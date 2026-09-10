import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  validateRuntimeTaskGraph,
  type RuntimeArtifactKind,
  type RuntimeCheckpoint,
  type RuntimeTaskGraph
} from "@cosmora/contracts";
import { LOCAL_OWNER_ID } from "./project-store.js";

export type DemoManagerRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type DemoManagerArtifactKind = Extract<
  RuntimeArtifactKind,
  "plan" | "analysis" | "handoff" | "checkpoint"
>;

export interface StoredDemoManagerRun {
  demo_run_id: string;
  owner_id: string;
  project_id: string;
  source_run_id: string;
  owner_goal: string;
  graph: RuntimeTaskGraph;
  status: DemoManagerRunStatus;
  checkpoint: RuntimeCheckpoint | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredDemoManagerArtifact {
  artifact_id: string;
  demo_run_id: string;
  owner_id: string;
  project_id: string;
  task_id: string;
  kind: DemoManagerArtifactKind;
  content: string;
  created_at: string;
}

export class DemoManagerStoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoManagerStoreValidationError";
  }
}

type SqlRow = Record<string, unknown>;
const terminalStatuses = new Set<DemoManagerRunStatus>(["succeeded", "failed", "cancelled"]);
const now = (): string => new Date().toISOString();

const asGraph = (value: unknown): RuntimeTaskGraph => JSON.parse(String(value)) as RuntimeTaskGraph;
const asCheckpoint = (value: unknown): RuntimeCheckpoint | null =>
  typeof value === "string" ? (JSON.parse(value) as RuntimeCheckpoint) : null;

export class DemoManagerStore {
  readonly #sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.#sqlite = sqlite;
  }

  create(input: {
    projectId: string;
    sourceRunId: string;
    ownerGoal: string;
    graph: RuntimeTaskGraph;
    ownerId?: string;
  }): StoredDemoManagerRun | null {
    const ownerId = input.ownerId ?? LOCAL_OWNER_ID;
    const ownerGoal = input.ownerGoal.replace(/\s+/g, " ").trim();
    if (ownerGoal.length === 0) throw new DemoManagerStoreValidationError("Owner goal is required");
    if (input.graph.project_id !== input.projectId) {
      throw new DemoManagerStoreValidationError("Demo graph must belong to its project");
    }
    const graphIssues = validateRuntimeTaskGraph(input.graph);
    if (graphIssues.length > 0) {
      throw new DemoManagerStoreValidationError(`Demo graph is invalid: ${graphIssues.join("; ")}`);
    }
    const source = this.#sqlite
      .prepare(
        `SELECT r.id FROM runs r JOIN projects p ON p.id = r.project_id
         WHERE r.id = ? AND r.project_id = ? AND p.owner_id = ?`
      )
      .get(input.sourceRunId, input.projectId, ownerId);
    if (!source) return null;

    const existing = this.getBySourceRun(input.sourceRunId, ownerId);
    if (existing) {
      if (existing.project_id !== input.projectId || existing.owner_goal !== ownerGoal) {
        throw new DemoManagerStoreValidationError(
          "Source run is already bound to another demo request"
        );
      }
      return existing;
    }

    const timestamp = now();
    const demoRunId = randomUUID();
    this.#sqlite
      .prepare(
        `INSERT INTO manager_demo_runs
          (demo_run_id, owner_id, project_id, source_run_id, owner_goal, graph_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
      )
      .run(
        demoRunId,
        ownerId,
        input.projectId,
        input.sourceRunId,
        ownerGoal,
        JSON.stringify(input.graph),
        timestamp,
        timestamp
      );
    return this.get(demoRunId, ownerId);
  }

  get(demoRunId: string, ownerId = LOCAL_OWNER_ID): StoredDemoManagerRun | null {
    const row = this.#sqlite
      .prepare(
        `SELECT demo_run_id, owner_id, project_id, source_run_id, owner_goal, graph_json, status,
                checkpoint_json, error_code, created_at, updated_at
         FROM manager_demo_runs WHERE demo_run_id = ? AND owner_id = ?`
      )
      .get(demoRunId, ownerId) as SqlRow | undefined;
    return row ? this.#asRun(row) : null;
  }

  getBySourceRun(sourceRunId: string, ownerId = LOCAL_OWNER_ID): StoredDemoManagerRun | null {
    const row = this.#sqlite
      .prepare(
        `SELECT demo_run_id, owner_id, project_id, source_run_id, owner_goal, graph_json, status,
                checkpoint_json, error_code, created_at, updated_at
         FROM manager_demo_runs WHERE source_run_id = ? AND owner_id = ?`
      )
      .get(sourceRunId, ownerId) as SqlRow | undefined;
    return row ? this.#asRun(row) : null;
  }

  claim(demoRunId: string, ownerId = LOCAL_OWNER_ID): boolean {
    const result = this.#sqlite
      .prepare(
        `UPDATE manager_demo_runs SET status = 'running', updated_at = ?
         WHERE demo_run_id = ? AND owner_id = ? AND status = 'queued'`
      )
      .run(now(), demoRunId, ownerId);
    return Number(result.changes) === 1;
  }

  cancel(demoRunId: string, ownerId = LOCAL_OWNER_ID): StoredDemoManagerRun | null {
    this.#sqlite
      .prepare(
        `UPDATE manager_demo_runs SET status = 'cancelled', updated_at = ?
         WHERE demo_run_id = ? AND owner_id = ? AND status IN ('queued', 'running')`
      )
      .run(now(), demoRunId, ownerId);
    return this.get(demoRunId, ownerId);
  }

  complete(
    demoRunId: string,
    checkpoint: RuntimeCheckpoint,
    ownerId = LOCAL_OWNER_ID
  ): StoredDemoManagerRun | null {
    const current = this.get(demoRunId, ownerId);
    if (!current || terminalStatuses.has(current.status)) return current;
    if (
      checkpoint.project_id !== current.project_id ||
      checkpoint.graph_id !== current.graph.graph_id
    ) {
      throw new DemoManagerStoreValidationError(
        "Checkpoint does not belong to this demo run graph"
      );
    }
    this.#sqlite
      .prepare(
        `UPDATE manager_demo_runs SET status = 'succeeded', checkpoint_json = ?, updated_at = ?
         WHERE demo_run_id = ? AND owner_id = ? AND status = 'running'`
      )
      .run(JSON.stringify(checkpoint), now(), demoRunId, ownerId);
    return this.get(demoRunId, ownerId);
  }

  appendArtifact(
    input: Omit<StoredDemoManagerArtifact, "artifact_id" | "created_at" | "owner_id"> & {
      ownerId?: string;
    }
  ): StoredDemoManagerArtifact | null {
    const ownerId = input.ownerId ?? LOCAL_OWNER_ID;
    const run = this.get(input.demo_run_id, ownerId);
    if (!run || run.status !== "running" || run.project_id !== input.project_id) return null;
    if (!run.graph.nodes.some((node) => node.task_id === input.task_id)) {
      throw new DemoManagerStoreValidationError("Artifact task does not belong to the demo graph");
    }
    const timestamp = now();
    const artifactId = randomUUID();
    this.#sqlite
      .prepare(
        `INSERT INTO manager_demo_artifacts
          (artifact_id, demo_run_id, owner_id, project_id, task_id, kind, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        artifactId,
        input.demo_run_id,
        ownerId,
        input.project_id,
        input.task_id,
        input.kind,
        input.content,
        timestamp
      );
    return {
      artifact_id: artifactId,
      demo_run_id: input.demo_run_id,
      owner_id: ownerId,
      project_id: input.project_id,
      task_id: input.task_id,
      kind: input.kind,
      content: input.content,
      created_at: timestamp
    };
  }

  listArtifacts(demoRunId: string, ownerId = LOCAL_OWNER_ID): StoredDemoManagerArtifact[] {
    return this.#sqlite
      .prepare(
        `SELECT artifact_id, demo_run_id, owner_id, project_id, task_id, kind, content, created_at
         FROM manager_demo_artifacts WHERE demo_run_id = ? AND owner_id = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(demoRunId, ownerId) as unknown as StoredDemoManagerArtifact[];
  }

  #asRun(row: SqlRow): StoredDemoManagerRun {
    return {
      demo_run_id: String(row.demo_run_id),
      owner_id: String(row.owner_id),
      project_id: String(row.project_id),
      source_run_id: String(row.source_run_id),
      owner_goal: String(row.owner_goal),
      graph: asGraph(row.graph_json),
      status: row.status as DemoManagerRunStatus,
      checkpoint: asCheckpoint(row.checkpoint_json),
      error_code: typeof row.error_code === "string" ? row.error_code : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at)
    };
  }
}
