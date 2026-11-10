import { createHash } from "node:crypto";

export interface FableRegistryProfile {
  registryVersion: string;
  providerId: "tokenshop";
  providerAdapter: "openai-compatible";
  baseUrl: string;
  modelName: "claude-fable-5";
  contextWindowTokens: number;
  maxOutputTokens: number;
  fallbackToMock: false;
  maxAttemptsPerRoute: 1;
  managerTimeoutMs: number;
  discoveredAt: string;
  discoveryExpiresAt: string;
  discoverySha256?: string;
}

export const DEFAULT_FABLE_5_PROFILE: FableRegistryProfile = {
  registryVersion: "tokenshop.fable.v1",
  providerId: "tokenshop",
  providerAdapter: "openai-compatible",
  baseUrl: "https://token-shop.online/v1",
  modelName: "claude-fable-5",
  contextWindowTokens: 1_000_000,
  maxOutputTokens: 100_000,
  fallbackToMock: false,
  maxAttemptsPerRoute: 1,
  managerTimeoutMs: 600_000,
  discoveredAt: "2026-11-02T00:00:00.000Z",
  discoveryExpiresAt: "2026-11-09T00:00:00.000Z"
};

/**
 * Validates the `config/model-registry.tokenshop.fable.v1.json` profile from PR #426
 * (`KOSMORA_FABLE_LIVE_CONNECTIVITY_2026-11-02_RU.md`), enforcing:
 * 1. Zero embedded secrets (`apiKey`, `secret`, `token`, `Bearer `).
 * 2. Discovery validity window check (`discoveryExpiresAt = 2026-11-09T00:00:00.000Z`),
 *    blocking dispatch when the discovery window has expired (`MODEL_DISCOVERY_EXPIRED_REFRESH_REQUIRED`).
 * 3. Safe discovery refresh (`refreshFableModelDiscovery`) that extends the 7-day discovery window
 *    after a verified `/v1/models` response without persisting any API keys.
 */
export function validateFableRegistryProfile(
  profile: FableRegistryProfile,
  nowIso = new Date().toISOString()
): { valid: true; remainingValidityMs: number } {
  const serialized = JSON.stringify(profile);
  if (/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+|api_key|apiKey|secret)/i.test(serialized)) {
    throw new Error("FABLE_REGISTRY_CONTAINS_SECRET_MATERIAL");
  }

  if (profile.fallbackToMock !== false) {
    throw new Error("FABLE_MOCK_FALLBACK_MUST_BE_DISABLED");
  }
  if (profile.maxAttemptsPerRoute !== 1) {
    throw new Error("FABLE_MAX_ATTEMPTS_PER_ROUTE_MUST_BE_1");
  }
  if (profile.contextWindowTokens > 1_000_000 || profile.maxOutputTokens > 100_000) {
    throw new Error("FABLE_LIMITS_EXCEED_SPECIFICATION");
  }

  const nowMs = Date.parse(nowIso);
  const expiresMs = Date.parse(profile.discoveryExpiresAt);
  if (!Number.isFinite(expiresMs) || nowMs >= expiresMs) {
    const err = new Error(
      `MODEL_DISCOVERY_EXPIRED_REFRESH_REQUIRED: Discovery expired at ${profile.discoveryExpiresAt}`
    ) as Error & { code?: string };
    err.code = "MODEL_DISCOVERY_EXPIRED_REFRESH_REQUIRED";
    throw err;
  }

  return {
    valid: true,
    remainingValidityMs: expiresMs - nowMs
  };
}

export function refreshFableModelDiscovery(options: {
  currentProfile: FableRegistryProfile;
  upstreamModelsList: Array<{ id: string }>;
  verifiedAtIso: string;
  validityDays?: number;
}): FableRegistryProfile {
  const found = options.upstreamModelsList.some(
    (m) => m.id === options.currentProfile.modelName
  );
  if (!found) {
    throw new Error(`FABLE_MODEL_NOT_PRESENT_IN_UPSTREAM_DISCOVERY:${options.currentProfile.modelName}`);
  }

  const verifiedAtMs = Date.parse(options.verifiedAtIso);
  const validityDays = Math.min(Math.max(options.validityDays ?? 7, 1), 14);
  const nextExpiresIso = new Date(verifiedAtMs + validityDays * 86_400_000).toISOString();

  const discoverySha256 = createHash("sha256")
    .update(
      JSON.stringify({
        providerId: options.currentProfile.providerId,
        baseUrl: options.currentProfile.baseUrl,
        modelName: options.currentProfile.modelName,
        verifiedAtIso: options.verifiedAtIso
      }),
      "utf8"
    )
    .digest("hex");

  return {
    ...options.currentProfile,
    discoveredAt: options.verifiedAtIso,
    discoveryExpiresAt: nextExpiresIso,
    discoverySha256
  };
}
