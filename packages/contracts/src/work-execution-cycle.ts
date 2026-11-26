import { Type, type Static } from "typebox";
import { EntityIdSchema } from "./primitives.js";

/** Additive contract for the standalone supplier execution cycle. It does not
 * modify ManagerWork or any existing contract shape. */
export const WorkCycleEventSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("parts"),
      parts: Type.Array(Type.Unknown(), { maxItems: 8 }),
      expected_version: Type.Integer({ minimum: 0 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("answer"),
      parts: Type.Array(Type.Unknown(), { maxItems: 8 }),
      expected_version: Type.Integer({ minimum: 0 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("error"),
      code: Type.String({ minLength: 1, maxLength: 128 }),
      expected_version: Type.Integer({ minimum: 0 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("instructions"),
      text: Type.String({ minLength: 1, maxLength: 2000 }),
      expected_version: Type.Integer({ minimum: 0 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    { type: Type.Literal("pause"), expected_version: Type.Integer({ minimum: 0 }) },
    { additionalProperties: false }
  ),
  Type.Object(
    { type: Type.Literal("resume"), expected_version: Type.Integer({ minimum: 0 }) },
    { additionalProperties: false }
  ),
  Type.Object(
    { type: Type.Literal("cancel"), expected_version: Type.Integer({ minimum: 0 }) },
    { additionalProperties: false }
  )
]);
export type WorkCycleEvent = Static<typeof WorkCycleEventSchema>;

export const WorkCycleGetSchema = Type.Object(
  { work_id: EntityIdSchema },
  { additionalProperties: false }
);
