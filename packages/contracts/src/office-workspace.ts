import { Type, type Static, type TSchema } from "typebox";
const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const text = (maxLength: number) => Type.String({ maxLength });
export const OfficeOperationSchema = Type.Union([
  object({
    kind: Type.Literal("replace_text"),
    target: text(120),
    find: Type.String({ minLength: 1, maxLength: 4000 }),
    replace: text(4000)
  }),
  object({
    kind: Type.Literal("set_cell"),
    target: Type.String({ pattern: "^sheet:[1-9][0-9]{0,2}$" }),
    address: Type.String({ pattern: "^[A-Z]{1,3}[1-9][0-9]{0,5}$" }),
    value: Type.Union([
      Type.Null(),
      Type.Number(),
      Type.Boolean(),
      text(500),
      object({ formula: text(256) })
    ])
  }),
  object({
    kind: Type.Literal("set_range"),
    target: Type.String({ pattern: "^sheet:[1-9][0-9]{0,2}$" }),
    start: Type.String({ pattern: "^[A-Z]{1,3}[1-9][0-9]{0,5}$" }),
    rows: Type.Array(
      Type.Array(
        Type.Union([
          Type.Null(),
          Type.Number(),
          Type.Boolean(),
          text(500),
          object({ formula: text(256) })
        ]),
        { minItems: 1, maxItems: 10 }
      ),
      { minItems: 1, maxItems: 10 }
    )
  }),
  object({ kind: Type.Literal("add_sheet"), name: Type.String({ minLength: 1, maxLength: 31 }) })
]);
export const OfficeOperationsSchema = Type.Array(OfficeOperationSchema, {
  minItems: 1,
  maxItems: 40
});
export const OfficeVersionSchema = Type.String({ pattern: "^sha256:[a-f0-9]{64}$" });
export const OfficeCursorSchema = object({
  target_offset: Type.Integer({ minimum: 0, maximum: 200000 }),
  content_offset: Type.Integer({ minimum: 0, maximum: 256000 })
});
export type OfficeCursor = Static<typeof OfficeCursorSchema>;
export const OfficeWorkspaceActions = [
  object({
    kind: Type.Literal("workspace_office_inspect_page"),
    path: text(512),
    target_offset: Type.Integer({ minimum: 0, maximum: 200000 }),
    content_offset: Type.Integer({ minimum: 0, maximum: 256000 }),
    expected_version: Type.Union([Type.Null(), OfficeVersionSchema])
  }),
  object({ kind: Type.Literal("workspace_office_inspect"), path: text(512) }),
  object({
    kind: Type.Literal("workspace_office_preview"),
    path: text(512),
    output_path: text(512),
    expected_version: OfficeVersionSchema,
    operations: OfficeOperationsSchema
  }),
  object({
    kind: Type.Literal("workspace_office_commit"),
    path: text(512),
    expected_version: OfficeVersionSchema,
    plan_id: Type.String({ pattern: "^[a-f0-9]{32}$" })
  })
] as const;
export type OfficeOperation = Static<typeof OfficeOperationSchema>;
