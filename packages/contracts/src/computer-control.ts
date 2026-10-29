import { Type, type Static, type TSchema } from "typebox";

const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const text = (maximum: number) => Type.String({ minLength: 1, maxLength: maximum });

/** Proposals, never executable JavaScript, shell commands or an unbounded RPC. */
export const ComputerActionSchema = Type.Union([
  object({ kind: Type.Literal("observe") }),
  object({ kind: Type.Literal("list_apps") }),
  object({ kind: Type.Literal("find_apps"), query: text(100) }),
  object({ kind: Type.Literal("open_app"), app_id: text(240) }),
  object({ kind: Type.Literal("open_url"), url: text(2048) }),
  object({ kind: Type.Literal("open_file"), path: text(1000) }),
  object({ kind: Type.Literal("focus"), window_id: text(32) }),
  object({
    kind: Type.Literal("click"),
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 }),
    button: Type.Union([Type.Literal("left"), Type.Literal("right")]),
    count: Type.Integer({ minimum: 1, maximum: 2 })
  }),
  object({ kind: Type.Literal("type_text"), text: text(4000) }),
  object({ kind: Type.Literal("press"), keys: Type.Array(text(16), { minItems: 1, maxItems: 4 }) }),
  object({
    kind: Type.Literal("scroll"),
    direction: Type.Union([Type.Literal("up"), Type.Literal("down")]),
    amount: Type.Integer({ minimum: 1, maximum: 10 })
  }),
  object({
    kind: Type.Literal("wait"),
    milliseconds: Type.Integer({ minimum: 100, maximum: 2000 })
  }),
  object({ kind: Type.Literal("ask_user"), question: text(2000) }),
  object({ kind: Type.Literal("done"), summary: text(4000) })
]);
export type ComputerAction = Static<typeof ComputerActionSchema>;

export const ComputerProposalSchema = object({
  action: ComputerActionSchema,
  message: Type.String({ maxLength: 1000 }),
  requires_confirmation: Type.Boolean()
});
export type ComputerProposal = Static<typeof ComputerProposalSchema>;

/** Added by the API from a completed Gateway run, never accepted from model output. */
export const ComputerDecisionSchema = object({
  ...ComputerProposalSchema.properties,
  decision_source: object({
    kind: Type.Literal("model_gateway"),
    mode: Type.Union([Type.Literal("provider"), Type.Literal("test")]),
    provider_id: text(160),
    model_id: text(240),
    run_id: text(128),
    session_id: text(128),
    step: Type.Integer({ minimum: 0, maximum: 29 })
  })
});
export type ComputerDecision = Static<typeof ComputerDecisionSchema>;
export const ComputerSessionAcceptanceSchema = object({
  id: text(128),
  expires_at: text(64),
  planner: object({
    kind: Type.Literal("model_gateway"),
    mode: Type.Union([Type.Literal("provider"), Type.Literal("test")])
  })
});

export const ComputerObservationSchema = object({
  observation_id: text(128),
  active_window: Type.String({ maxLength: 32 }),
  description: Type.String({ maxLength: 16000 }),
  width: Type.Integer({ minimum: 1, maximum: 8192 }),
  height: Type.Integer({ minimum: 1, maximum: 8192 }),
  image_jpeg_base64: text(1_333_336)
});
export type ComputerObservation = Static<typeof ComputerObservationSchema>;

export const CreateComputerSessionSchema = object({
  client_request_id: text(128),
  client_secret: Type.String({ minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]+$" }),
  goal: text(8000),
  max_steps: Type.Integer({ minimum: 1, maximum: 30 })
});
export type CreateComputerSession = Static<typeof CreateComputerSessionSchema>;
export const ComputerStepSchema = object({
  step: Type.Integer({ minimum: 0, maximum: 29 }),
  observation: ComputerObservationSchema,
  previous_result: Type.String({ maxLength: 16000 })
});
export type ComputerStep = Static<typeof ComputerStepSchema>;
export const AuthorizeComputerActionSchema = object({
  step: Type.Integer({ minimum: 0, maximum: 29 }),
  action_hash: Type.String({ minLength: 64, maxLength: 64, pattern: "^[a-f0-9]+$" })
});
