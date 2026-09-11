export * from "./agent-delegation.js";
export * from "./agent-instruction-plan.js";

import {
  AUTONOMY_MATRIX,
  CAPABILITY_IDS,
  CONDITIONAL_EXPANSIONS,
  PERMISSION_MODE_RANK,
  hasUniqueCapabilityOverrideIds,
  verdictForModes,
  type CapabilityGrant,
  type CapabilityId,
  type CapabilityOverride,
  type CapabilityProfile,
  type PermissionContract,
  type PermissionMode,
  type PolicyIntent,
  type PolicyVerdict,
  type PolicyVerdictKind
} from "@cosmora/contracts";

export interface PolicyEvaluationOptions {
  evaluatedAt: string;
  activeConditionIds?: readonly string[];
  policyVersion?: string;
}

export interface PolicyEvaluationInput {
  intent: PolicyIntent;
  profile: CapabilityProfile;
  permissionContracts: readonly PermissionContract[];
}

interface CapabilityResolution {
  grant: CapabilityGrant;
  permissionIds: string[];
  reasons: string[];
  pause: boolean;
}

const maxMode = (left: PermissionMode, right: PermissionMode): PermissionMode =>
  PERMISSION_MODE_RANK[right] > PERMISSION_MODE_RANK[left] ? right : left;

const isWithinTimeWindow = (now: number, validFrom: string, validUntil: string | null): boolean => {
  const start = Date.parse(validFrom);
  const end = validUntil === null ? Number.POSITIVE_INFINITY : Date.parse(validUntil);
  return (
    Number.isFinite(start) &&
    (validUntil === null || Number.isFinite(end)) &&
    start <= now &&
    now <= end
  );
};

const coversObjects = (
  allowedObjectIds: readonly string[],
  requestedObjectIds: readonly string[]
) =>
  allowedObjectIds.length === 0 ||
  requestedObjectIds.every((objectId) => allowedObjectIds.includes(objectId));

const isUsableOverride = (
  override: CapabilityOverride,
  capabilityId: CapabilityId,
  objectIds: readonly string[],
  purpose: string,
  now: number
): boolean =>
  override.capability_id === capabilityId &&
  override.purpose === purpose &&
  (override.remaining_uses === null || override.remaining_uses > 0) &&
  (override.valid_until === null || Date.parse(override.valid_until) >= now) &&
  coversObjects(override.object_ids, objectIds);

const usableOverridesForCapability = (
  profile: CapabilityProfile,
  capabilityId: CapabilityId,
  objectIds: readonly string[],
  purpose: string,
  now: number
): CapabilityOverride[] =>
  profile.overrides.filter((override) =>
    isUsableOverride(override, capabilityId, objectIds, purpose, now)
  );

export function getAppliedOverrideIds(
  profile: CapabilityProfile,
  intent: PolicyIntent,
  evaluatedAt: string
): string[] {
  const now = Date.parse(evaluatedAt);
  if (!Number.isFinite(now)) return [];
  return intent.capability_ids.flatMap((capabilityId) => {
    const overrides = usableOverridesForCapability(
      profile,
      capabilityId,
      intent.object_ids,
      intent.purpose,
      now
    );
    const applied = overrides.length === 1 ? overrides[0] : undefined;
    return applied ? [applied.override_id] : [];
  });
}

const activePermissionGrants = (
  contracts: readonly PermissionContract[],
  intent: PolicyIntent,
  capabilityId: CapabilityId,
  now: number
): Array<{ contract: PermissionContract; grant: CapabilityGrant }> => {
  const matches: Array<{ contract: PermissionContract; grant: CapabilityGrant }> = [];

  for (const contract of contracts) {
    if (
      contract.state !== "ACTIVE" ||
      contract.project_id !== intent.project_id ||
      contract.subject_id !== intent.actor_id ||
      contract.purpose !== intent.purpose ||
      !isWithinTimeWindow(now, contract.valid_from, contract.valid_until) ||
      !coversObjects(contract.object_ids, intent.object_ids)
    ) {
      continue;
    }

    for (const grant of contract.capabilities) {
      if (grant.capability_id === capabilityId && coversObjects(grant.scope, intent.object_ids)) {
        matches.push({ contract, grant });
      }
    }
  }

  return matches;
};

const validateBaseProfileIntegrity = (profile: CapabilityProfile): string[] => {
  const issues: string[] = [];
  if (!hasUniqueCapabilityOverrideIds(profile.overrides)) {
    issues.push("Capability profile contains duplicate point override IDs.");
  }
  for (const capabilityId of CAPABILITY_IDS) {
    const grants = profile.grants.filter((grant) => grant.capability_id === capabilityId);
    if (grants.length !== 1) {
      issues.push(
        `Expected exactly one profile grant for ${capabilityId}; found ${grants.length}.`
      );
      continue;
    }
    const grant = grants[0];
    if (grant === undefined) continue;
    const canonicalMode = AUTONOMY_MATRIX[capabilityId][profile.base_level];
    if (grant.mode !== canonicalMode) {
      issues.push(
        `Profile ${profile.profile_id} base grant for ${capabilityId} does not match ${profile.base_level}.`
      );
    }
  }
  return issues;
};

const resolveCapability = (
  input: PolicyEvaluationInput,
  capabilityId: CapabilityId,
  options: Required<PolicyEvaluationOptions>,
  now: number
): CapabilityResolution => {
  const baseGrants = input.profile.grants.filter((grant) => grant.capability_id === capabilityId);
  if (baseGrants.length !== 1) {
    return {
      grant: { capability_id: capabilityId, mode: "DENY", scope: [], conditions: [] },
      permissionIds: [],
      reasons: [
        `Expected exactly one profile grant for ${capabilityId}; found ${baseGrants.length}.`
      ],
      pause: true
    };
  }

  const baseGrant = baseGrants[0];
  if (baseGrant === undefined) {
    throw new Error("Unreachable profile grant state");
  }

  let mode = coversObjects(baseGrant.scope, input.intent.object_ids) ? baseGrant.mode : "DENY";
  const permissionIds: string[] = [];
  const reasons = [`Profile ${input.profile.profile_id} resolved ${capabilityId} as ${mode}.`];

  const expansion = CONDITIONAL_EXPANSIONS.find(
    (candidate) =>
      candidate.level === input.profile.base_level &&
      candidate.capability_id === capabilityId &&
      options.activeConditionIds.includes(candidate.condition_id)
  );
  if (expansion !== undefined) {
    mode = maxMode(mode, expansion.mode);
    reasons.push(`Condition ${expansion.condition_id} expanded the mode to ${mode}.`);
  }

  for (const { contract, grant } of activePermissionGrants(
    input.permissionContracts,
    input.intent,
    capabilityId,
    now
  )) {
    const expandedMode = maxMode(mode, grant.mode);
    if (expandedMode !== mode) {
      mode = expandedMode;
      permissionIds.push(contract.permission_id);
      reasons.push(`Permission ${contract.permission_id} expanded the mode to ${mode}.`);
    }
  }

  const overrides = usableOverridesForCapability(
    input.profile,
    capabilityId,
    input.intent.object_ids,
    input.intent.purpose,
    now
  );
  if (overrides.length > 1) {
    return {
      grant: { ...baseGrant, mode: "DENY" },
      permissionIds,
      reasons: [...reasons, `Multiple active overrides exist for ${capabilityId}.`],
      pause: true
    };
  }
  const override = overrides[0];
  if (override !== undefined) {
    mode = override.mode;
    reasons.push(`Override ${override.override_id} set the final mode to ${mode}.`);
  }

  return {
    grant: { ...baseGrant, mode },
    permissionIds,
    reasons,
    pause: false
  };
};

const immediateVerdict = (
  intent: PolicyIntent,
  kind: PolicyVerdictKind,
  reason: string,
  options: Required<PolicyEvaluationOptions>
): PolicyVerdict => ({
  operation_id: intent.operation_id,
  verdict: kind,
  evaluated_capabilities: intent.capability_ids.map((capabilityId) => ({
    capability_id: capabilityId,
    mode: "DENY",
    scope: [],
    conditions: []
  })),
  permission_ids: [],
  reasons: [reason],
  evaluated_at: options.evaluatedAt,
  policy_version: options.policyVersion
});

export function evaluatePolicy(
  input: PolicyEvaluationInput,
  suppliedOptions: PolicyEvaluationOptions
): PolicyVerdict {
  const options: Required<PolicyEvaluationOptions> = {
    evaluatedAt: suppliedOptions.evaluatedAt,
    activeConditionIds: suppliedOptions.activeConditionIds ?? [],
    policyVersion: suppliedOptions.policyVersion ?? "1.1.0"
  };
  const now = Date.parse(options.evaluatedAt);
  if (!Number.isFinite(now)) {
    return immediateVerdict(input.intent, "PAUSE", "Evaluation timestamp is invalid.", options);
  }
  if (input.profile.project_id !== input.intent.project_id) {
    return immediateVerdict(
      input.intent,
      "DENY",
      "Intent and capability profile belong to different projects.",
      options
    );
  }
  const profileIssues = validateBaseProfileIntegrity(input.profile);
  if (profileIssues.length > 0) {
    return immediateVerdict(input.intent, "PAUSE", profileIssues.join(" "), options);
  }

  const resolutions = input.intent.capability_ids.map((capabilityId) =>
    resolveCapability(input, capabilityId, options, now)
  );
  const verdict = resolutions.some((resolution) => resolution.pause)
    ? "PAUSE"
    : verdictForModes(resolutions.map((resolution) => resolution.grant.mode));

  return {
    operation_id: input.intent.operation_id,
    verdict,
    evaluated_capabilities: resolutions.map((resolution) => resolution.grant),
    permission_ids: [...new Set(resolutions.flatMap((resolution) => resolution.permissionIds))],
    reasons: resolutions.flatMap((resolution) => resolution.reasons),
    evaluated_at: options.evaluatedAt,
    policy_version: options.policyVersion
  };
}
