import { Type, type Static } from "typebox";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const ModelOutputCheckpointSchema = Type.Object(
  {
    kind: Type.Literal("unvalidated_model_output"),
    model_run_id: EntityIdSchema,
    stage: Type.Union([
      Type.Literal("plan"),
      Type.Literal("draft"),
      Type.Literal("review"),
      Type.Literal("code")
    ]),
    text: Type.String({ maxLength: 32768 }),
    received_bytes: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    truncated: Type.Boolean(),
    stream_completed: Type.Boolean(),
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ModelOutputCheckpoint = Static<typeof ModelOutputCheckpointSchema>;
