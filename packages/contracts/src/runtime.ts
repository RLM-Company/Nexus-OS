import { Type, type Static } from "typebox";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const ModelRuntimeStatusSchema = Type.Object(
  {
    mode: Type.Union([
      Type.Literal("mock"),
      Type.Literal("openai-compatible"),
      Type.Literal("anthropic-compatible")
    ]),
    provider: Type.String({ minLength: 1, maxLength: 128 }),
    model: Type.String({ minLength: 1 }),
    registry_version: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    credential_configured: Type.Boolean(),
    fallback_to_mock: Type.Boolean(),
    max_attempts_per_route: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
    max_output_tokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 }))
  },
  { additionalProperties: false }
);

export type ModelRuntimeStatus = Static<typeof ModelRuntimeStatusSchema>;

export const EmergencyStopScopeSchema = Type.Union([
  Type.Literal("process"),
  Type.Literal("project")
]);
export type EmergencyStopScope = Static<typeof EmergencyStopScopeSchema>;

export const ActivateEmergencyStopRequestSchema = Type.Object(
  {
    scope: EmergencyStopScopeSchema,
    project_id: Type.Optional(EntityIdSchema),
    reason: Type.String({ minLength: 1, maxLength: 500 })
  },
  { additionalProperties: false }
);
export type ActivateEmergencyStopRequest = Static<typeof ActivateEmergencyStopRequestSchema>;

export const CLEAR_EMERGENCY_STOP_ACKNOWLEDGEMENT = "CLEAR EMERGENCY STOP" as const;

export const ClearEmergencyStopRequestSchema = Type.Object(
  {
    scope: EmergencyStopScopeSchema,
    project_id: Type.Optional(EntityIdSchema),
    expected_activated_at: IsoDateTimeSchema,
    reason: Type.String({ minLength: 1, maxLength: 500 }),
    acknowledgement: Type.Literal(CLEAR_EMERGENCY_STOP_ACKNOWLEDGEMENT)
  },
  { additionalProperties: false }
);
export type ClearEmergencyStopRequest = Static<typeof ClearEmergencyStopRequestSchema>;

export const EmergencyStopStateSchema = Type.Object(
  {
    scope: EmergencyStopScopeSchema,
    project_id: Type.Union([EntityIdSchema, Type.Null()]),
    active: Type.Literal(true),
    reason: Type.String({ minLength: 1 }),
    activated_at: IsoDateTimeSchema,
    activated_by: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);
export type EmergencyStopState = Static<typeof EmergencyStopStateSchema>;

export const EmergencyStopClearanceEventSchema = Type.Object(
  {
    event_id: EntityIdSchema,
    scope: EmergencyStopScopeSchema,
    project_id: Type.Union([EntityIdSchema, Type.Null()]),
    activation_reason: Type.String({ minLength: 1, maxLength: 500 }),
    activated_at: IsoDateTimeSchema,
    activated_by: Type.String({ minLength: 1 }),
    clearance_reason: Type.String({ minLength: 1, maxLength: 500 }),
    cleared_at: IsoDateTimeSchema,
    cleared_by: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);
export type EmergencyStopClearanceEvent = Static<typeof EmergencyStopClearanceEventSchema>;

export const EmergencyStopClearanceListResponseSchema = Type.Object(
  {
    items: Type.Array(EmergencyStopClearanceEventSchema),
    limit: Type.Integer({ minimum: 1, maximum: 100 })
  },
  { additionalProperties: false }
);
export type EmergencyStopClearanceListResponse = Static<
  typeof EmergencyStopClearanceListResponseSchema
>;

const GatewayFailureCountersSchema = Type.Object(
  {
    ROUTE_UNAVAILABLE: Type.Integer({ minimum: 0 }),
    CONTEXT_TOO_LARGE: Type.Integer({ minimum: 0 }),
    PROVIDER_TIMEOUT: Type.Integer({ minimum: 0 }),
    PROVIDER_ERROR: Type.Integer({ minimum: 0 }),
    CIRCUIT_OPEN: Type.Integer({ minimum: 0 }),
    INTERRUPTED: Type.Integer({ minimum: 0 }),
    EMERGENCY_STOP: Type.Integer({ minimum: 0 }),
    USAGE_LIMIT_EXCEEDED: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);

export const RuntimeOperationsStatusSchema = Type.Object(
  {
    generated_at: IsoDateTimeSchema,
    active_runs: Type.Integer({ minimum: 0 }),
    process_stop: Type.Union([EmergencyStopStateSchema, Type.Null()]),
    active_project_stops: Type.Integer({ minimum: 0 }),
    metrics: Type.Object(
      {
        runs_started: Type.Integer({ minimum: 0 }),
        runs_completed: Type.Integer({ minimum: 0 }),
        runs_failed: Type.Integer({ minimum: 0 }),
        runs_cancelled: Type.Integer({ minimum: 0 }),
        route_attempts: Type.Integer({ minimum: 0 }),
        route_failures: GatewayFailureCountersSchema,
        last_failure_at: Type.Union([IsoDateTimeSchema, Type.Null()])
      },
      { additionalProperties: false }
    ),
    alerts: Type.Array(
      Type.Object(
        {
          code: Type.Union([
            Type.Literal("PROCESS_EMERGENCY_STOP"),
            Type.Literal("PROJECT_EMERGENCY_STOP"),
            Type.Literal("MODEL_CIRCUIT_OPEN")
          ]),
          severity: Type.Union([Type.Literal("warning"), Type.Literal("critical")]),
          message: Type.String({ minLength: 1 })
        },
        { additionalProperties: false }
      )
    )
  },
  { additionalProperties: false }
);
export type RuntimeOperationsStatus = Static<typeof RuntimeOperationsStatusSchema>;
