import type { Currency, ModelFeature } from "@cosmora/contracts";

export interface CommonModelServiceOptions {
  preferredProvider: string;
  preferredModelAlias: string;
  fallbackAllowed: boolean;
  requiredFeatures: ModelFeature[];
  confidential: boolean;
  maxCost: { amount: number; currency: Currency } | null;
  optimizeFor: "balanced" | "quality" | "latency" | "cost";
  timeoutMs: number;
  maxOutputTokens: number;
  systemPrompt: string;
}

const invalidOption = (field: string): Error => new Error(`Invalid model request option: ${field}`);

const isCanonicalIdentifier = (value: unknown, maximum: number): value is string =>
  typeof value === "string" &&
  value.length <= maximum &&
  value.trim().length > 0 &&
  value === value.trim() &&
  !/\s/u.test(value);

const isNonEmptyPrompt = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 100_000;

const isBoundedPositiveSafeInteger = (value: unknown, maximum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;

const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_TOKENS = 100_000;

const MODEL_FEATURES = new Set<ModelFeature>([
  "streaming",
  "structured_output",
  "tool_calling",
  "vision"
]);

export const normalizeCommonModelServiceOptions = <T extends CommonModelServiceOptions>(
  options: T
): Omit<T, "requiredFeatures"> & { requiredFeatures: ModelFeature[] } => {
  if (!isCanonicalIdentifier(options.preferredProvider, 128)) {
    throw invalidOption("preferredProvider");
  }
  if (!isCanonicalIdentifier(options.preferredModelAlias, 256)) {
    throw invalidOption("preferredModelAlias");
  }
  if (typeof options.fallbackAllowed !== "boolean") throw invalidOption("fallbackAllowed");
  if (typeof options.confidential !== "boolean") throw invalidOption("confidential");
  if (!["balanced", "quality", "latency", "cost"].includes(options.optimizeFor)) {
    throw invalidOption("optimizeFor");
  }
  if (!isNonEmptyPrompt(options.systemPrompt)) throw invalidOption("systemPrompt");
  if (!isBoundedPositiveSafeInteger(options.timeoutMs, MAX_TIMEOUT_MS)) {
    throw invalidOption("timeoutMs");
  }
  if (!isBoundedPositiveSafeInteger(options.maxOutputTokens, MAX_OUTPUT_TOKENS)) {
    throw invalidOption("maxOutputTokens");
  }
  if (
    !Array.isArray(options.requiredFeatures) ||
    options.requiredFeatures.some((feature) => !MODEL_FEATURES.has(feature))
  ) {
    throw invalidOption("requiredFeatures");
  }

  if (
    options.maxCost !== null &&
    (!Number.isFinite(options.maxCost.amount) ||
      options.maxCost.amount < 0 ||
      (options.maxCost.currency !== "USD" && options.maxCost.currency !== "RUB"))
  ) {
    throw invalidOption("maxCost");
  }

  return {
    ...options,
    requiredFeatures: [...new Set(options.requiredFeatures)]
  };
};

export function assertEntityId(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || /\s/.test(value)) {
    throw new Error(`Invalid model request identity: ${field}`);
  }
}
