import type { ProjectMemorySnapshot, WorkRuntimeProgress } from "./work-runtime.js";
import type { ChatTextAttachment } from "./chat-attachments.js";
import { Type, type Static } from "typebox";
import { EntityIdSchema } from "./primitives.js";
import type { ModelOutputCheckpoint } from "./model-output-checkpoint.js";

export const CreateManagerWorkSchema = Type.Object(
  {
    client_request_id: EntityIdSchema,
    goal: Type.String({ minLength: 1, maxLength: 8000, pattern: "\\S" }),
    worker_role: Type.Union([Type.Literal("analyst"), Type.Literal("architect")]),
    require_critic: Type.Optional(Type.Boolean()),
    output_contract: Type.Optional(
      Type.Union([
        Type.Object(
          {
            kind: Type.Literal("presentation"),
            slide_count: Type.Integer({ minimum: 3, maximum: 8 })
          },
          { additionalProperties: false }
        ),
        Type.Object({ kind: Type.Literal("website") }, { additionalProperties: false }),
        Type.Object({ kind: Type.Literal("supplier_comparison") }, { additionalProperties: false }),
        Type.Object(
          {
            kind: Type.Union([
              Type.Literal("pdf_field_register"),
              Type.Literal("version_change_report")
            ]),
            input: Type.String({ minLength: 1, maxLength: 240_000 })
          },
          { additionalProperties: false }
        ),
        Type.Object({ kind: Type.Literal("game_project") }, { additionalProperties: false }),
        Type.Object(
          {
            kind: Type.Literal("game"),
            genre: Type.Union([
              Type.Literal("arcade"),
              Type.Literal("memory"),
              Type.Literal("quiz")
            ])
          },
          { additionalProperties: false }
        )
      ])
    ),
    max_model_requests: Type.Optional(Type.Integer({ minimum: 2, maximum: 3 })),
    // Optional explicit limits for older clients and bounded workflows.
    max_input_tokens: Type.Optional(Type.Integer({ minimum: 1000, maximum: 3_000_000 })),
    max_output_tokens: Type.Optional(Type.Integer({ minimum: 256, maximum: 300_000 }))
  },
  { additionalProperties: false }
);
export type CreateManagerWork = Static<typeof CreateManagerWorkSchema>;

export const MANAGER_WORK_CONTROL_EVENTS = {
  pause: "Пауза после текущего запроса",
  resume: "Работа продолжена",
  approve: "План подтверждён владельцем",
  cancel: "Остановлено владельцем"
} as const;

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

// Server stores files as inert downloadable artifacts. Browser game execution is
// a separate sandboxed Worker path; no shell or host filesystem access is granted here.
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
/** Only closed server measurements. Missing duration means no observation. */
export interface WorkMeasuredTiming {
  queue_ms?: number;
  tool_ms?: number;
  model_ms?: number;
  pause_ms?: number;
  await_owner_ms?: number;
}
export const CreateSupplierWorkHandoffSchema = Type.Object(
  {
    client_request_id: EntityIdSchema,
    chat_id: EntityIdSchema,
    message_id: EntityIdSchema,
    attachment_indexes: Type.Array(Type.Integer({ minimum: 0, maximum: 3 }), {
      maxItems: 4,
      uniqueItems: true
    }),
    materials_version: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);
export type CreateSupplierWorkHandoff = Static<typeof CreateSupplierWorkHandoffSchema>;

export interface SupplierWorkHandoff {
  chat_id: string;
  message_id: string;
  message: string;
  attachment_indexes: number[];
  materials_version: number;
  inputs: { name: string; sha256: string }[];
}

export interface SupplierWorkEvidence {
  format: "kosmora.supplier-comparison-evidence.v1";
  input_sha256: string;
  source_files: SupplierWorkHandoff["inputs"];
  checks: string[];
  disputes: { supplier: string; item_id: string | null; reason: string }[];
}

export interface ManagerWork {
  id: string;
  project_id: string;
  owner_id: string;
  actor_id: string;
  request: CreateManagerWork;
  supplier_handoff?: SupplierWorkHandoff;
  materials?: {
    instructions: string;
    attachments: ChatTextAttachment[];
  };
  memory_snapshot?: ProjectMemorySnapshot;
  graph_context?: ProjectMemorySnapshot;
  task_graph?: WorkRuntimeProgress;
  result_sources?: { run_id: string; provider: string; model: string; stage: ManagerWorkStage }[];
  dag_binding?: { graph_id: string; node_id: string; attempt: number; bound: boolean };
  owner_budget_hold_id?: string | null;
  status: ManagerWorkStatus;
  stage: ManagerWorkStage;
  version: number;
  pause_requested: boolean;
  approved: boolean;
  /** Owner acceptance of the finished result. Set once; repeats are idempotent and
   * never move the timestamp or author. Separate from plan approval. */
  result_accepted_at?: string | null;
  result_accepted_by?: string | null;
  inflight_run_id: string | null;
  queued_since?: string;
  paused_since?: string;
  approval_since?: string;
  measured_timing?: WorkMeasuredTiming;
  /** Bounded recovery text, never a validated artifact, plan or publication grant. */
  output_checkpoint?: ModelOutputCheckpoint;
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
