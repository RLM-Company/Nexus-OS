import { Type, type Static } from "typebox";
import type { ManagerWorkStage, ManagerWorkStatus } from "./manager-work.js";

const SourceSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("owner"), Type.Literal("reference"), Type.Literal("artifact")]),
    reference: Type.String({ minLength: 1, maxLength: 500, pattern: "\\S" })
  },
  { additionalProperties: false }
);
export const ProjectMemoryInputSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
    content: Type.String({ minLength: 1, maxLength: 4000, pattern: "\\S" }),
    source: SourceSchema,
    pinned: Type.Boolean()
  },
  { additionalProperties: false }
);
export type ProjectMemoryInput = Static<typeof ProjectMemoryInputSchema>;
export const ProjectMemoryUpdateSchema = Type.Object(
  {
    ...ProjectMemoryInputSchema.properties,
    version: Type.Integer({ minimum: 1 })
  },
  { additionalProperties: false }
);
export const ProjectMemoryControlSchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    action: Type.Union([Type.Literal("pin"), Type.Literal("unpin"), Type.Literal("forget")])
  },
  { additionalProperties: false }
);
export interface ProjectMemoryEntry extends ProjectMemoryInput {
  id: string;
  project_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface ProjectMemorySnapshot {
  items: ProjectMemoryEntry[];
  omitted: number;
}
export type WorkTaskStatus =
  "pending" | "ready" | "running" | "waiting" | "completed" | "skipped" | "failed" | "cancelled";
export interface WorkRuntimeTask {
  task_id: string;
  stage: Exclude<ManagerWorkStage, "done">;
  title: string;
  depends_on: string[];
  status: WorkTaskStatus;
}
export interface WorkCheckpointRecord {
  work_id: string;
  version: number;
  stage: ManagerWorkStage;
  status: ManagerWorkStatus;
  inflight_run_id: string | null;
  model_requests: number;
  reserved_input_tokens: number;
  reserved_output_tokens: number;
  error_code: string | null;
  at: string;
  restores_permissions: false;
  tasks?: WorkRuntimeTask[];
}
export interface WorkArtifactVersion {
  id: string;
  project_id: string;
  work_id: string;
  name: string;
  version: number;
  sha256: string;
  bytes: number;
  published: boolean;
  created_at: string;
}
export interface WorkRuntimeProgress {
  contract_version: "kosmora-work-v1";
  work_id: string;
  tasks: WorkRuntimeTask[];
  completed: number;
  total: number;
  next_task_id: string | null;
  waiting_decision: "plan" | "permission" | "resume" | "recovery" | null;
  restores_permissions: false;
}
// Adapter receives only project-scoped public records, never prompts, credentials,
// hidden reasoning or permission grants. No implementation fetches a network URL.
export interface WorkIntelligenceGraphAdapter {
  contract_version: "kosmora-work-v1";
  read(input: {
    project_id: string;
    owner_id: string;
    query: string;
    limit: number;
    signal: AbortSignal;
  }): Promise<{
    project_id: string;
    entries: ProjectMemoryEntry[];
  }>;
}
