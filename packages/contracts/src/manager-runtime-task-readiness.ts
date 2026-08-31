import { Type, type Static } from "typebox";
import { RuntimeTaskStatusSchema } from "./manager-runtime.js";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const RuntimeTaskReadinessReasonSchema = Type.Union([
  Type.Literal("dependencies_satisfied"),
  Type.Literal("waiting_for_dependencies"),
  Type.Literal("dependency_failed"),
  Type.Literal("dependency_cancelled"),
  Type.Literal("already_blocked"),
  Type.Literal("already_running"),
  Type.Literal("already_terminal"),
  Type.Literal("invalid_graph")
]);
export type RuntimeTaskReadinessReason = Static<typeof RuntimeTaskReadinessReasonSchema>;

export const RuntimeTaskReadinessDecisionSchema = Type.Object(
  {
    task_id: EntityIdSchema,
    current_status: RuntimeTaskStatusSchema,
    derived_status: RuntimeTaskStatusSchema,
    reason: RuntimeTaskReadinessReasonSchema,
    blocking_dependency_ids: Type.Array(EntityIdSchema, { maxItems: 100, uniqueItems: true })
  },
  { additionalProperties: false }
);
export type RuntimeTaskReadinessDecision = Static<typeof RuntimeTaskReadinessDecisionSchema>;

export const RuntimeTaskReadinessSnapshotSchema = Type.Object(
  {
    graph_id: EntityIdSchema,
    project_id: EntityIdSchema,
    valid_graph: Type.Boolean(),
    graph_issues: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
      maxItems: 10_000
    }),
    decisions: Type.Array(RuntimeTaskReadinessDecisionSchema, { maxItems: 10_000 }),
    evaluated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type RuntimeTaskReadinessSnapshot = Static<typeof RuntimeTaskReadinessSnapshotSchema>;
