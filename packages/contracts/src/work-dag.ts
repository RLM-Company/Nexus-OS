import { Type, type Static } from "typebox";
import type { WorkArtifactVersion } from "./work-runtime.js";
export const WorkDagNodeInputSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 60, pattern: "^[a-zA-Z0-9_-]+$" }),
    title: Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
    goal: Type.String({ minLength: 1, maxLength: 4000, pattern: "\\S" }),
    depends_on: Type.Array(Type.String({ minLength: 1, maxLength: 60 }), {
      maxItems: 32,
      uniqueItems: true
    })
  },
  { additionalProperties: false }
);
export type WorkDagNodeInput = Static<typeof WorkDagNodeInputSchema>;
export const WorkDagCreateSchema = Type.Object(
  {
    client_request_id: Type.String({ minLength: 1, maxLength: 100 }),
    title: Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
    nodes: Type.Array(WorkDagNodeInputSchema, { minItems: 1, maxItems: 32 })
  },
  { additionalProperties: false }
);
export type WorkDagCreate = Static<typeof WorkDagCreateSchema>;
export const WorkDagEditSchema = Type.Object(
  { version: Type.Integer({ minimum: 1 }), nodes: WorkDagCreateSchema.properties.nodes },
  { additionalProperties: false }
);
export const WorkDagControlSchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    action: Type.Union([
      Type.Literal("run"),
      Type.Literal("retry"),
      Type.Literal("pause"),
      Type.Literal("resume"),
      Type.Literal("cancel"),
      Type.Literal("approve_step"),
      Type.Literal("resume_step")
    ]),
    node_id: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
    acknowledge_cost: Type.Optional(Type.Literal(true))
  },
  { additionalProperties: false }
);
export type WorkDagControl = Static<typeof WorkDagControlSchema>;
export type WorkDagStatus =
  "pending" | "blocked" | "running" | "completed" | "failed" | "cancelled";
export interface WorkDagAttempt {
  number: number;
  work_id: string;
  started_at: string;
  source_artifact_ids: string[];
}
export interface WorkDagNode extends WorkDagNodeInput {
  status: WorkDagStatus;
  blocked_reason: string | null;
  attempts: WorkDagAttempt[];
  artifacts: WorkArtifactVersion[];
  result?: {
    stage: string;
    plan_summary: string | null;
    plan_instructions: string | null;
    review: { verdict: string; reason: string } | null;
    confirmation_id: string | null;
    sources: { run_id: string; provider: string; model: string; stage: string }[];
  };
}
export interface WorkDag {
  id: string;
  project_id: string;
  owner_id: string;
  actor_id: string;
  version: number;
  client_request_id: string;
  title: string;
  mode: "active" | "paused" | "cancelled";
  nodes: WorkDagNode[];
  events: { sequence: number; message: string; at: string }[];
  created_at: string;
  updated_at: string;
}
// Structural compatibility with AccountStore. Reconciliation releases a main hold
// ONLY after the canonical project ledger is committed. No new accounting table.
export interface WorkOwnerBudget {
  reserve(
    owner: string,
    runId: string,
    attempt: number,
    maxTokens: number,
    kind: "main",
    projectId: string,
    provider: string,
    model: string
  ): string;
  completeReservation(id: string, kind: "main", input: number | null, output: number | null): void;
  uncertainReservation(id: string, kind: "main"): void;
  /** Release only when local failure proves the provider was never dispatched. */
  releaseBeforeDispatch(id: string): void;
}
export interface WorkQuiescence {
  owner_id: string;
  epoch: number;
  settled: true;
}
