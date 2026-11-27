import { Type, type Static } from "typebox";

const description = Type.String({ minLength: 1, maxLength: 1800, pattern: "\\S" });
const duration = Type.Union([Type.Literal(5), Type.Literal(10), Type.Literal(15)]);
const id = Type.String({ pattern: "^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$" });
const version = Type.Integer({ minimum: 1 });
const revision = Type.Object(
  { version, description, duration_seconds: duration },
  { additionalProperties: false }
);
const scene = Type.Object(
  {
    id,
    accepted_version: Type.Union([version, Type.Null()]),
    revisions: Type.Array(revision, { minItems: 1, maxItems: 12 })
  },
  { additionalProperties: false }
);

export const StudioStoryboardSchema = Type.Object(
  {
    format: Type.Literal("kosmora.storyboard.v1"),
    version: Type.Integer({ minimum: 0 }),
    last_operation_id: Type.Union([id, Type.Null()]),
    scenes: Type.Array(scene, { maxItems: 12 })
  },
  { additionalProperties: false }
);
export type StudioStoryboard = Static<typeof StudioStoryboardSchema>;

const command = { expected_version: Type.Integer({ minimum: 0 }), operation_id: id };
export const StudioStoryboardChangeSchema = Type.Union([
  Type.Object(
    { ...command, action: Type.Literal("add"), description, duration_seconds: duration },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      ...command,
      action: Type.Literal("revise"),
      scene_id: id,
      description,
      duration_seconds: duration
    },
    { additionalProperties: false }
  ),
  Type.Object(
    { ...command, action: Type.Literal("accept"), scene_id: id, revision: version },
    { additionalProperties: false }
  )
]);
export type StudioStoryboardChange = Static<typeof StudioStoryboardChangeSchema>;
