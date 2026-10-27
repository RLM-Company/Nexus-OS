import { Type, type Static } from "typebox";

export const ClockCalculationSchema = Type.Union([
  Type.Object(
    {
      operation: Type.Literal("add_days"),
      date: Type.String({ minLength: 10, maxLength: 10 }),
      days: Type.Integer({ minimum: -36600, maximum: 36600 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      operation: Type.Literal("between"),
      from: Type.String({ minLength: 20, maxLength: 35 }),
      to: Type.String({ minLength: 20, maxLength: 35 })
    },
    { additionalProperties: false }
  )
]);
export type ClockCalculation = Static<typeof ClockCalculationSchema>;
