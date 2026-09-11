import { createHash } from "node:crypto";
import type {
  UpdateCapabilityProfileRequest,
  UpdateProjectUsageLimitRequest
} from "@cosmora/contracts";

const payloadDigest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value), "utf8").digest("base64url");

export const autonomyProfileStepUpChallenge = (
  projectId: string,
  input: UpdateCapabilityProfileRequest
): string =>
  `project:${projectId}:autonomy-profile:${input.expected_version}:${payloadDigest({
    base_level: input.base_level,
    overrides: input.overrides.map((override) => ({
      override_id: override.override_id,
      capability_id: override.capability_id,
      mode: override.mode,
      object_ids: override.object_ids,
      purpose: override.purpose,
      valid_until: override.valid_until,
      remaining_uses: override.remaining_uses
    }))
  })}`;

export const projectUsageLimitStepUpChallenge = (
  projectId: string,
  input: UpdateProjectUsageLimitRequest
): string =>
  `project:${projectId}:usage-limit:${input.expected_version}:${payloadDigest({
    max_total_tokens: input.max_total_tokens,
    max_cost:
      input.max_cost === null
        ? null
        : { amount: input.max_cost.amount, currency: input.max_cost.currency }
  })}`;
