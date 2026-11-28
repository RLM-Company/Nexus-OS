import { Type, type Static } from "typebox";

const id = Type.String({ minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9_-]+$" });
const iso = Type.String({ minLength: 20, maxLength: 24 });
const timeZone = Type.String({ minLength: 1, maxLength: 64 });

/** A workflow procedure may declare verifiable conditions and human confirmation
 * points. All fields are additive: older definitions stay valid. */
export const WorkflowConditionSchema = Type.Object(
  {
    id,
    description: Type.String({ minLength: 1, maxLength: 400 }),
    kind: Type.Union([
      Type.Literal("source_allowlist"),
      Type.Literal("result_check"),
      Type.Literal("review")
    ]),
    /** Only project file ids already readable by the owner. Never a new grant. */
    file_ids: Type.Optional(Type.Array(id, { maxItems: 32, uniqueItems: true }))
  },
  { additionalProperties: false }
);
export type WorkflowCondition = Static<typeof WorkflowConditionSchema>;

export const WorkflowConfirmationSchema = Type.Object(
  {
    id,
    node_id: id,
    description: Type.String({ minLength: 1, maxLength: 400 }),
    /** The external effect requiring a separate human approval. */
    external_action: Type.String({ minLength: 1, maxLength: 400 })
  },
  { additionalProperties: false }
);
export type WorkflowConfirmation = Static<typeof WorkflowConfirmationSchema>;

/** Stable occurrence identity. Bindings are sorted so connector event ordering
 * cannot change the key. */
export const automationOccurrenceKey = (input: {
  triggerId: string;
  kind: "manual" | "event" | "schedule";
  dueAt?: string;
  source?: string;
  eventId?: string;
}): string => {
  if (input.kind === "event")
    return `event:${input.source ?? ""}:${input.eventId ?? ""}:${input.triggerId}`;
  if (input.kind === "schedule") return `schedule:${input.triggerId}:${input.dueAt ?? ""}`;
  return `manual:${input.triggerId}`;
};

export const eventDedupeKey = (source: string, eventId: string): string =>
  `${source}\u0000${eventId}`;

export const EventInboxStatusSchema = Type.Union([
  Type.Literal("accepted"),
  Type.Literal("duplicate"),
  Type.Literal("rejected")
]);
export type EventInboxStatus = Static<typeof EventInboxStatusSchema>;

/** Every event receipt is recorded, including duplicates and rejections, so a
 * connector can prove that one event produced at most one run. */
export const AutomationEventInboxSchema = Type.Object(
  {
    id: id,
    owner_id: Type.String({ minLength: 1, maxLength: 128 }),
    receipt_id: id,
    event_key: Type.String({ minLength: 1, maxLength: 400 }),
    source: Type.String({ minLength: 1, maxLength: 128 }),
    event_type: Type.String({ minLength: 1, maxLength: 128 }),
    event_id: Type.String({ minLength: 1, maxLength: 200 }),
    workflow_id: Type.String({ minLength: 1, maxLength: 128 }),
    definition_version: Type.Integer({ minimum: 1 }),
    project_id: Type.String({ minLength: 1, maxLength: 160 }),
    status: EventInboxStatusSchema,
    reason: Type.String({ maxLength: 500 }),
    trigger_id: Type.Optional(id),
    run_id: Type.Optional(id),
    received_at: iso,
    /** Original connector payload, kept only for an explicit safe replay. */
    body_json: Type.String({ maxLength: 20000 })
  },
  { additionalProperties: false }
);
export type AutomationEventInbox = Static<typeof AutomationEventInboxSchema>;

export const TriggerVersionPolicySchema = Type.Union([
  Type.Literal("pinned"),
  Type.Literal("follow_latest")
]);
export type TriggerVersionPolicy = Static<typeof TriggerVersionPolicySchema>;

export const AutomationTriggerSchema = Type.Object(
  {
    id,
    owner_id: Type.String({ minLength: 1, maxLength: 128 }),
    project_id: Type.String({ minLength: 1, maxLength: 160 }),
    workflow_id: Type.String({ minLength: 1, maxLength: 128 }),
    definition_version: Type.Integer({ minimum: 1 }),
    kind: Type.Union([Type.Literal("manual"), Type.Literal("event"), Type.Literal("schedule")]),
    /** pinned: run only the saved version; follow_latest: resolve current on each tick. */
    version_policy: Type.Optional(TriggerVersionPolicySchema),
    inputs: Type.Record(
      Type.String({ maxLength: 100 }),
      Type.Union([Type.String({ maxLength: 2000 }), Type.Number(), Type.Boolean()])
    ),
    /** Schedule: wall-clock local time in the owner's time zone. */
    schedule: Type.Optional(
      Type.Object(
        {
          mode: Type.Union([
            Type.Literal("once"),
            Type.Literal("daily"),
            Type.Literal("weekdays"),
            Type.Literal("weekly")
          ]),
          time_zone: timeZone,
          local_time: Type.String({ minLength: 4, maxLength: 5 }),
          due_at: iso,
          enabled: Type.Boolean()
        },
        { additionalProperties: false }
      )
    ),
    /** Event: source connector + stable event id; dedupe on (source, event_id). */
    event: Type.Optional(
      Type.Object(
        {
          source: Type.String({ minLength: 1, maxLength: 128 }),
          event_type: Type.String({ minLength: 1, maxLength: 128 }),
          event_id: Type.String({ minLength: 1, maxLength: 200 }),
          bindings: Type.Record(Type.String({ maxLength: 100 }), Type.String({ maxLength: 500 }))
        },
        { additionalProperties: false }
      )
    ),
    status: Type.Union([
      Type.Literal("enabled"),
      Type.Literal("paused"),
      Type.Literal("cancelled")
    ]),
    created_at: iso,
    updated_at: iso,
    version: Type.Integer({ minimum: 1 })
  },
  { additionalProperties: false }
);
export type AutomationTrigger = Static<typeof AutomationTriggerSchema>;

export const AutomationRunStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("claimed"),
  Type.Literal("awaiting_confirmation"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("unknown_external")
]);
export type AutomationRunStatus = Static<typeof AutomationRunStatusSchema>;

export const AutomationRunSchema = Type.Object(
  {
    id: id,
    trigger_id: id,
    owner_id: Type.String({ minLength: 1, maxLength: 128 }),
    project_id: Type.String({ minLength: 1, maxLength: 160 }),
    workflow_id: Type.String({ minLength: 1, maxLength: 128 }),
    definition_version: Type.Integer({ minimum: 1 }),
    dag_id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    occurrence_key: Type.String({ minLength: 1, maxLength: 300 }),
    /** Stable event identity; repeated events never create two runs. */
    event_key: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
    kind: Type.Union([Type.Literal("manual"), Type.Literal("event"), Type.Literal("schedule")]),
    status: AutomationRunStatusSchema,
    /** Current step being executed, if a plan was launched. */
    node_id: Type.Optional(id),
    /** Server-side lease: only the claiming process may advance this run. */
    lease_owner: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    lease_expires_at: Type.Optional(iso),
    attempt: Type.Integer({ minimum: 0 }),
    error_code: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    error_reason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    confirmation_id: Type.Optional(id),
    external_action_id: Type.Optional(id),
    created_at: iso,
    updated_at: iso,
    version: Type.Integer({ minimum: 1 })
  },
  { additionalProperties: false }
);
export type AutomationRun = Static<typeof AutomationRunSchema>;

export const AutomationEventSchema = Type.Object(
  {
    id: id,
    run_id: id,
    owner_id: Type.String({ minLength: 1, maxLength: 128 }),
    at: iso,
    kind: Type.String({ minLength: 1, maxLength: 128 }),
    reason: Type.String({ maxLength: 500 }),
    actor: Type.String({ minLength: 1, maxLength: 128 })
  },
  { additionalProperties: false }
);
export type AutomationEvent = Static<typeof AutomationEventSchema>;

/** Unknown-outcome external action. Publication/retry requires explicit verification. */
export const ExternalActionStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("unknown"),
  Type.Literal("verified"),
  Type.Literal("failed")
]);
export type ExternalActionStatus = Static<typeof ExternalActionStatusSchema>;

export const AutomationExternalActionSchema = Type.Object(
  {
    id: id,
    owner_id: Type.String({ minLength: 1, maxLength: 128 }),
    run_id: id,
    trigger_id: id,
    connector: Type.String({ minLength: 1, maxLength: 128 }),
    operation: Type.String({ minLength: 1, maxLength: 200 }),
    /** Stable operation identity, used by the connector to verify before retry. */
    operation_key: Type.String({ minLength: 1, maxLength: 300 }),
    status: ExternalActionStatusSchema,
    confirmation_id: Type.Optional(id),
    created_at: iso,
    updated_at: iso
  },
  { additionalProperties: false }
);
export type AutomationExternalAction = Static<typeof AutomationExternalActionSchema>;

export const CreateAutomationTriggerSchema = Type.Object(
  {
    client_request_id: id,
    workflow_id: Type.String({ minLength: 1, maxLength: 128 }),
    definition_version: Type.Integer({ minimum: 1 }),
    kind: Type.Union([Type.Literal("manual"), Type.Literal("event"), Type.Literal("schedule")]),
    version_policy: Type.Optional(TriggerVersionPolicySchema),
    inputs: AutomationTriggerSchema.properties.inputs,
    schedule: Type.Optional(AutomationTriggerSchema.properties.schedule),
    event: Type.Optional(AutomationTriggerSchema.properties.event)
  },
  { additionalProperties: false }
);
export type CreateAutomationTrigger = Static<typeof CreateAutomationTriggerSchema>;

export const AutomationTriggerControlSchema = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 1 }),
    status: Type.Union([Type.Literal("enabled"), Type.Literal("paused"), Type.Literal("cancelled")])
  },
  { additionalProperties: false }
);
export type AutomationTriggerControl = Static<typeof AutomationTriggerControlSchema>;

export const AutomationRunControlSchema = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 1 }),
    action: Type.Union([
      Type.Literal("run"),
      Type.Literal("pause"),
      Type.Literal("resume"),
      Type.Literal("cancel"),
      Type.Literal("confirm"),
      Type.Literal("verify_external")
    ]),
    reason: Type.Optional(Type.String({ maxLength: 500 })),
    /** Verification result supplied by the connector after a real check. */
    verified: Type.Optional(Type.Boolean()),
    operation_key: Type.Optional(Type.String({ minLength: 1, maxLength: 300 }))
  },
  { additionalProperties: false }
);
export type AutomationRunControl = Static<typeof AutomationRunControlSchema>;

/** Explicit, audited version change for a saved procedure trigger. */
export const AutomationTriggerVersionSchema = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 1 }),
    definition_version: Type.Integer({ minimum: 1 }),
    version_policy: Type.Optional(TriggerVersionPolicySchema),
    reason: Type.String({ minLength: 1, maxLength: 500 })
  },
  { additionalProperties: false }
);
export type AutomationTriggerVersion = Static<typeof AutomationTriggerVersionSchema>;

/** Replay a rejected/duplicate event only by an explicit operator decision. */
export const AutomationEventReplaySchema = Type.Object(
  {
    expected_status: Type.Union([
      Type.Literal("rejected"),
      Type.Literal("duplicate"),
      Type.Literal("accepted")
    ]),
    reason: Type.String({ minLength: 1, maxLength: 500 })
  },
  { additionalProperties: false }
);
export type AutomationEventReplay = Static<typeof AutomationEventReplaySchema>;
