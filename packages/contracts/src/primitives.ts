import { Type, type Static } from "typebox";

export const EntityIdSchema = Type.String({ minLength: 1, maxLength: 128 });
export type EntityId = Static<typeof EntityIdSchema>;

export const IsoDateTimeSchema = Type.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$"
});
export type IsoDateTime = Static<typeof IsoDateTimeSchema>;

export const CurrencySchema = Type.Union([Type.Literal("USD"), Type.Literal("RUB")]);
export type Currency = Static<typeof CurrencySchema>;
