import type { ProjectMemorySnapshot, WorkRuntimeProgress } from "./work-runtime.js";
import type { ChatTextAttachment } from "./chat-attachments.js";
import { Type, type Static } from "typebox";
import { EntityIdSchema } from "./primitives.js";

export const CreateManagerWorkSchema = Type.Object(
  {
    client_request_id: EntityIdSchema,
    goal: Type.String({ minLength: 1, maxLength: 8000, pattern: "\\S" }),
    worker_role: Type.Union([Type.Literal("analyst"), Type.Literal("architect")]),
    max_model_requests: Type.Integer({ minimum: 2, maximum: 3 }),
    max_input_tokens: Type.Integer({ minimum: 1000, maximum: 32000 }),
    max_output_tokens: Type.Integer({ minimum: 256, maximum: 8000 })
  },
  { additionalProperties: false }
);
export type CreateManagerWork = Static<typeof CreateManagerWorkSchema>;

export const ManagerWorkPlanSchema = Type.Object(
  {
    summary: Type.String({ minLength: 1, maxLength: 1000 }),
    instructions: Type.String({ minLength: 1, maxLength: 6000 }),
    complexity: Type.Union([Type.Literal("simple"), Type.Literal("complex")]),
    needs_critic: Type.Boolean(),
    requires_external_actions: Type.Boolean()
  },
  { additionalProperties: false }
);
export type ManagerWorkPlan = Static<typeof ManagerWorkPlanSchema>;

// Files are inert downloadable artifacts. No shell, arbitrary paths, executable
// preview, deployment or host filesystem access is part of this first executor.
export const ManagerWorkFilesSchema = Type.Object(
  {
    files: Type.Array(
      Type.Object(
        {
          name: Type.String({
            minLength: 1,
            maxLength: 100,
            pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]*\\.(md|txt|json|html|css|js|ts|py|csv)$"
          }),
          content: Type.String({ minLength: 1, maxLength: 64000 })
        },
        { additionalProperties: false }
      ),
      { minItems: 1, maxItems: 8 }
    )
  },
  { additionalProperties: false }
);
export type ManagerWorkFiles = Static<typeof ManagerWorkFilesSchema>;

export const ManagerWorkReviewSchema = Type.Object(
  {
    verdict: Type.Union([Type.Literal("PASS"), Type.Literal("FAIL")]),
    reason: Type.String({ minLength: 1, maxLength: 2000 })
  },
  { additionalProperties: false }
);
export type ManagerWorkReview = Static<typeof ManagerWorkReviewSchema>;

export type ManagerWorkStage = "plan" | "draft" | "review" | "publish" | "done";
export type ManagerWorkStatus =
  | "queued"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";
export interface ManagerWork {
  id: string;
  project_id: string;
  owner_id: string;
  actor_id: string;
  request: CreateManagerWork;
  materials?: {
    instructions: string;
    attachments: ChatTextAttachment[];
  };
  memory_snapshot?: ProjectMemorySnapshot;
  graph_context?: ProjectMemorySnapshot;
  task_graph?: WorkRuntimeProgress;
  status: ManagerWorkStatus;
  stage: ManagerWorkStage;
  version: number;
  pause_requested: boolean;
  approved: boolean;
  inflight_run_id: string | null;
  model_requests: number;
  reserved_input_tokens: number;
  reserved_output_tokens: number;
  plan: ManagerWorkPlan | null;
  draft: ManagerWorkFiles | null;
  review: ManagerWorkReview | null;
  confirmation_id: string | null;
  error_code: string | null;
  events: { sequence: number; stage: ManagerWorkStage; message: string; at: string }[];
  created_at: string;
  updated_at: string;
}
