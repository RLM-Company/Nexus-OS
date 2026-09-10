import { Type, type Static } from "typebox";
import { RuntimeTaskGraphSchema } from "./manager-runtime.js";
import { RuntimeCheckpointSchema } from "./manager-runtime-state.js";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const DemoManagerRunStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled")
]);
export type DemoManagerRunStatus = Static<typeof DemoManagerRunStatusSchema>;

export const DemoManagerArtifactKindSchema = Type.Union([
  Type.Literal("plan"),
  Type.Literal("analysis"),
  Type.Literal("handoff"),
  Type.Literal("checkpoint")
]);
export type DemoManagerArtifactKind = Static<typeof DemoManagerArtifactKindSchema>;

export const DemoManagerArtifactSchema = Type.Object(
  {
    artifact_id: EntityIdSchema,
    demo_run_id: EntityIdSchema,
    project_id: EntityIdSchema,
    task_id: EntityIdSchema,
    kind: DemoManagerArtifactKindSchema,
    content: Type.String(),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type DemoManagerArtifact = Static<typeof DemoManagerArtifactSchema>;

export const DemoManagerRunSchema = Type.Object(
  {
    demo_run_id: EntityIdSchema,
    project_id: EntityIdSchema,
    source_run_id: EntityIdSchema,
    owner_goal: Type.String({ minLength: 1, maxLength: 100_000 }),
    graph: RuntimeTaskGraphSchema,
    status: DemoManagerRunStatusSchema,
    checkpoint: Type.Union([RuntimeCheckpointSchema, Type.Null()]),
    error_code: Type.Union([Type.String(), Type.Null()]),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
    artifacts: Type.Array(DemoManagerArtifactSchema)
  },
  { additionalProperties: false }
);
export type DemoManagerRun = Static<typeof DemoManagerRunSchema>;

export const CreateDemoManagerRunRequestSchema = Type.Object(
  {
    source_run_id: EntityIdSchema,
    owner_goal: Type.String({ minLength: 1, maxLength: 100_000, pattern: "\\S" })
  },
  { additionalProperties: false }
);
export type CreateDemoManagerRunRequest = Static<typeof CreateDemoManagerRunRequestSchema>;

export const DemoManagerRunListResponseSchema = Type.Object(
  { items: Type.Array(DemoManagerRunSchema) },
  { additionalProperties: false }
);
export type DemoManagerRunListResponse = Static<typeof DemoManagerRunListResponseSchema>;
