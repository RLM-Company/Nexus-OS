import { Type, type Static } from "typebox";

export const POLICY_CONTRACT_VERSION = "1.1.0" as const;

export const AutonomyLevelSchema = Type.Union([
  Type.Literal("A0"),
  Type.Literal("A1"),
  Type.Literal("A2"),
  Type.Literal("A3"),
  Type.Literal("A4"),
  Type.Literal("A5"),
  Type.Literal("A6")
]);
export type AutonomyLevel = Static<typeof AutonomyLevelSchema>;

export const CapabilityIdSchema = Type.Union([
  Type.Literal("context.web.read"),
  Type.Literal("context.project.read"),
  Type.Literal("context.global.read"),
  Type.Literal("workspace.write"),
  Type.Literal("integration.private.use"),
  Type.Literal("external.communicate"),
  Type.Literal("audience.expand"),
  Type.Literal("account.manage"),
  Type.Literal("production.deploy"),
  Type.Literal("finance.spend"),
  Type.Literal("finance.credit"),
  Type.Literal("legal.accept_terms"),
  Type.Literal("contract.finalize"),
  Type.Literal("data.disclose"),
  Type.Literal("agent.manage"),
  Type.Literal("prompt.temporary"),
  Type.Literal("prompt.permanent"),
  Type.Literal("strategy.change"),
  Type.Literal("sandbox.experiment")
]);
export type CapabilityId = Static<typeof CapabilityIdSchema>;

export const PermissionModeSchema = Type.Union([
  Type.Literal("DENY"),
  Type.Literal("CONFIRM"),
  Type.Literal("SCOPED"),
  Type.Literal("AUTONOMOUS"),
  Type.Literal("FULL")
]);
export type PermissionMode = Static<typeof PermissionModeSchema>;

export const PermissionStateSchema = Type.Union([
  Type.Literal("REQUESTED"),
  Type.Literal("APPROVED"),
  Type.Literal("ACTIVE"),
  Type.Literal("SUSPENDED"),
  Type.Literal("CONSUMED"),
  Type.Literal("EXPIRED"),
  Type.Literal("REVOKING"),
  Type.Literal("REVOKED"),
  Type.Literal("FAILED")
]);
export type PermissionState = Static<typeof PermissionStateSchema>;

export const PolicyVerdictKindSchema = Type.Union([
  Type.Literal("ALLOW"),
  Type.Literal("ALLOW_WITH_LIMITS"),
  Type.Literal("NEEDS_CONFIRMATION"),
  Type.Literal("DENY"),
  Type.Literal("PAUSE")
]);
export type PolicyVerdictKind = Static<typeof PolicyVerdictKindSchema>;

export const CapabilityGrantSchema = Type.Object(
  {
    capability_id: CapabilityIdSchema,
    mode: PermissionModeSchema,
    scope: Type.Array(Type.String({ minLength: 1 }), { default: [] }),
    conditions: Type.Array(Type.String({ minLength: 1 }), { default: [] })
  },
  { additionalProperties: false }
);
export type CapabilityGrant = Static<typeof CapabilityGrantSchema>;

export const CapabilityOverrideSchema = Type.Object(
  {
    override_id: Type.String({ minLength: 1, maxLength: 128 }),
    capability_id: CapabilityIdSchema,
    mode: PermissionModeSchema,
    object_ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    purpose: Type.String({ minLength: 1, maxLength: 2_000 }),
    valid_until: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    remaining_uses: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])
  },
  { additionalProperties: false }
);
export type CapabilityOverride = Static<typeof CapabilityOverrideSchema>;

export const CapabilityProfileSchema = Type.Object(
  {
    profile_id: Type.String({ minLength: 1, maxLength: 128 }),
    project_id: Type.String({ minLength: 1, maxLength: 128 }),
    base_level: AutonomyLevelSchema,
    grants: Type.Array(CapabilityGrantSchema, { minItems: 19, maxItems: 19 }),
    overrides: Type.Array(CapabilityOverrideSchema),
    version: Type.Integer({ minimum: 1 }),
    issued_at: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);
export type CapabilityProfile = Static<typeof CapabilityProfileSchema>;

export const PermissionContractSchema = Type.Object(
  {
    permission_id: Type.String({ minLength: 1, maxLength: 128 }),
    version: Type.Integer({ minimum: 1 }),
    project_id: Type.String({ minLength: 1, maxLength: 128 }),
    subject_id: Type.String({ minLength: 1, maxLength: 128 }),
    organizational_role: Type.Union([
      Type.Literal("account_owner"),
      Type.Literal("project_admin"),
      Type.Literal("organization_representative"),
      Type.Literal("financial_controller"),
      Type.Literal("legal_signatory"),
      Type.Literal("data_controller"),
      Type.Literal("observer")
    ]),
    state: PermissionStateSchema,
    capabilities: Type.Array(CapabilityGrantSchema, { minItems: 1 }),
    purpose: Type.String({ minLength: 1, maxLength: 2_000 }),
    object_ids: Type.Array(Type.String({ minLength: 1 })),
    valid_from: Type.String({ minLength: 1 }),
    valid_until: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    limits: Type.Object(
      {
        money_minor: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        tokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        operations: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
        delegation_depth: Type.Integer({ minimum: 0 })
      },
      { additionalProperties: false }
    ),
    parent_permission_id: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    approval: Type.Object(
      {
        approver_id: Type.String({ minLength: 1 }),
        method: Type.Union([Type.Literal("session"), Type.Literal("step_up")]),
        terms_version: Type.String({ minLength: 1 }),
        nonce: Type.String({ minLength: 1 }),
        approved_at: Type.String({ minLength: 1 })
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
);
export type PermissionContract = Static<typeof PermissionContractSchema>;

export const PolicyIntentSchema = Type.Object(
  {
    operation_id: Type.String({ minLength: 1, maxLength: 128 }),
    project_id: Type.String({ minLength: 1, maxLength: 128 }),
    actor_id: Type.String({ minLength: 1, maxLength: 128 }),
    capability_ids: Type.Array(CapabilityIdSchema, { minItems: 1, uniqueItems: true }),
    object_ids: Type.Array(Type.String({ minLength: 1 })),
    purpose: Type.String({ minLength: 1, maxLength: 2_000 }),
    idempotency_key: Type.String({ minLength: 1, maxLength: 256 })
  },
  { additionalProperties: false }
);
export type PolicyIntent = Static<typeof PolicyIntentSchema>;

export const PolicyVerdictSchema = Type.Object(
  {
    operation_id: Type.String({ minLength: 1, maxLength: 128 }),
    verdict: PolicyVerdictKindSchema,
    evaluated_capabilities: Type.Array(CapabilityGrantSchema, { minItems: 1 }),
    permission_ids: Type.Array(Type.String({ minLength: 1 })),
    reasons: Type.Array(Type.String({ minLength: 1 })),
    evaluated_at: Type.String({ minLength: 1 }),
    policy_version: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);
export type PolicyVerdict = Static<typeof PolicyVerdictSchema>;

export const PolicyEvaluationEnvelopeSchema = Type.Object(
  {
    contract_version: Type.Literal(POLICY_CONTRACT_VERSION),
    intent: PolicyIntentSchema,
    profile: CapabilityProfileSchema,
    permission_contracts: Type.Array(PermissionContractSchema),
    verdict: PolicyVerdictSchema
  },
  { additionalProperties: false }
);
export type PolicyEvaluationEnvelope = Static<typeof PolicyEvaluationEnvelopeSchema>;

export const AUTONOMY_LEVELS = ["A0", "A1", "A2", "A3", "A4", "A5", "A6"] as const;

export const CAPABILITY_IDS = [
  "context.web.read",
  "context.project.read",
  "context.global.read",
  "workspace.write",
  "integration.private.use",
  "external.communicate",
  "audience.expand",
  "account.manage",
  "production.deploy",
  "finance.spend",
  "finance.credit",
  "legal.accept_terms",
  "contract.finalize",
  "data.disclose",
  "agent.manage",
  "prompt.temporary",
  "prompt.permanent",
  "strategy.change",
  "sandbox.experiment"
] as const satisfies readonly CapabilityId[];

export const PERMISSION_MODE_RANK: Readonly<Record<PermissionMode, number>> = {
  DENY: 0,
  CONFIRM: 1,
  SCOPED: 2,
  AUTONOMOUS: 3,
  FULL: 4
};

type LevelModes = Readonly<Record<AutonomyLevel, PermissionMode>>;
export type AutonomyMatrix = Readonly<Record<CapabilityId, LevelModes>>;

const modes = (
  A0: PermissionMode,
  A1: PermissionMode,
  A2: PermissionMode,
  A3: PermissionMode,
  A4: PermissionMode,
  A5: PermissionMode,
  A6: PermissionMode
): LevelModes => ({ A0, A1, A2, A3, A4, A5, A6 });

export const AUTONOMY_MATRIX: AutonomyMatrix = {
  "context.web.read": modes(
    "DENY",
    "SCOPED",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ),
  "context.project.read": modes(
    "DENY",
    "SCOPED",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ),
  "context.global.read": modes("DENY", "SCOPED", "SCOPED", "SCOPED", "SCOPED", "SCOPED", "FULL"),
  "workspace.write": modes(
    "DENY",
    "DENY",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ),
  "integration.private.use": modes(
    "DENY",
    "SCOPED",
    "SCOPED",
    "SCOPED",
    "SCOPED",
    "AUTONOMOUS",
    "FULL"
  ),
  "external.communicate": modes(
    "DENY",
    "DENY",
    "CONFIRM",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ),
  "audience.expand": modes("DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "AUTONOMOUS", "FULL"),
  "account.manage": modes("DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "AUTONOMOUS", "FULL"),
  "production.deploy": modes("DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"),
  "finance.spend": modes("DENY", "DENY", "CONFIRM", "CONFIRM", "AUTONOMOUS", "AUTONOMOUS", "FULL"),
  "finance.credit": modes("DENY", "DENY", "DENY", "DENY", "DENY", "DENY", "FULL"),
  "legal.accept_terms": modes("DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"),
  "contract.finalize": modes("DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"),
  "data.disclose": modes("DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"),
  "agent.manage": modes(
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ),
  "prompt.temporary": modes(
    "DENY",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ),
  "prompt.permanent": modes("DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"),
  "strategy.change": modes("DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"),
  "sandbox.experiment": modes(
    "DENY",
    "SCOPED",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  )
};

export const CONDITIONAL_EXPANSIONS = [
  {
    level: "A3",
    capability_id: "data.disclose",
    condition_id: "approved_campaign_material",
    mode: "AUTONOMOUS"
  },
  {
    level: "A5",
    capability_id: "production.deploy",
    condition_id: "subsequent_release_after_approved_first_release",
    mode: "AUTONOMOUS"
  },
  {
    level: "A5",
    capability_id: "legal.accept_terms",
    condition_id: "standard_free_terms",
    mode: "AUTONOMOUS"
  },
  {
    level: "A5",
    capability_id: "data.disclose",
    condition_id: "project_passport_allows_disclosure",
    mode: "AUTONOMOUS"
  }
] as const;

export function getCapabilityMode(
  level: AutonomyLevel,
  capabilityId: CapabilityId
): PermissionMode {
  return AUTONOMY_MATRIX[capabilityId][level];
}

export function isAtLeastAsAutonomous(
  candidate: PermissionMode,
  baseline: PermissionMode
): boolean {
  return PERMISSION_MODE_RANK[candidate] >= PERMISSION_MODE_RANK[baseline];
}

export function verdictForModes(permissionModes: readonly PermissionMode[]): PolicyVerdictKind {
  if (permissionModes.includes("DENY")) return "DENY";
  if (permissionModes.includes("CONFIRM")) return "NEEDS_CONFIRMATION";
  if (permissionModes.includes("SCOPED")) return "ALLOW_WITH_LIMITS";
  return "ALLOW";
}
