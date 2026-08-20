import { Type, type Static } from "typebox";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

const RunRefSchema = Type.Object({ run_id: EntityIdSchema }, { additionalProperties: false });

export const StreamEventSchema = Type.Union([
  Type.Object({
    type: Type.Literal("run.started"),
    data: Type.Object(
      { run_id: EntityIdSchema, timestamp: IsoDateTimeSchema },
      { additionalProperties: false }
    )
  }),
  Type.Object({
    type: Type.Literal("message.started"),
    data: Type.Object(
      { run_id: EntityIdSchema, message_id: EntityIdSchema },
      { additionalProperties: false }
    )
  }),
  Type.Object({
    type: Type.Literal("message.delta"),
    data: Type.Object(
      {
        run_id: EntityIdSchema,
        message_id: EntityIdSchema,
        seq: Type.Integer({ minimum: 0 }),
        delta: Type.String()
      },
      { additionalProperties: false }
    )
  }),
  Type.Object({
    type: Type.Literal("message.completed"),
    data: Type.Object(
      {
        run_id: EntityIdSchema,
        message_id: EntityIdSchema,
        size: Type.Integer({ minimum: 0 }),
        finish_reason: Type.String()
      },
      { additionalProperties: false }
    )
  }),
  Type.Object({
    type: Type.Literal("run.completed"),
    data: Type.Object(
      {
        run_id: EntityIdSchema,
        provider: Type.String(),
        model_resolved: Type.String()
      },
      { additionalProperties: false }
    )
  }),
  Type.Object({
    type: Type.Literal("run.failed"),
    data: Type.Object(
      {
        run_id: EntityIdSchema,
        error_code: Type.String(),
        retryable: Type.Boolean()
      },
      { additionalProperties: false }
    )
  }),
  Type.Object({
    type: Type.Literal("run.cancelled"),
    data: RunRefSchema
  }),
  Type.Object({
    type: Type.Literal("heartbeat"),
    data: Type.Object({ timestamp: IsoDateTimeSchema }, { additionalProperties: false })
  })
]);
export type StreamEvent = Static<typeof StreamEventSchema>;
