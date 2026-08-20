import { Type, type Static } from "typebox";
import { IsoDateTimeSchema } from "./primitives.js";

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("ok"), Type.Literal("degraded")]),
    version: Type.String({ minLength: 1 }),
    database: Type.Union([Type.Literal("ok"), Type.Literal("error")]),
    timestamp: IsoDateTimeSchema
  },
  { additionalProperties: false }
);

export type HealthResponse = Static<typeof HealthResponseSchema>;
