import type { Currency, ModelFeature } from "@cosmora/contracts";

export interface CommonModelServiceOptions {
  preferredProvider: string;
  preferredModelAlias: string;
  requiredFeatures: ModelFeature[];
  timeoutMs: number;
  maxOutputTokens: number;
  maxCost: { amount: number; currency: Currency } | null;
}

const invalidOption = (field: string): Error => new Error(`Invalid model request option: ${field}`);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const MODEL_FEATURES = new Set<ModelFeature>([
  "streaming",
  "structured_output",
  "tool_calling",
  "vision"
]);

export const normalizeCommonModelServiceOptions = <T extends CommonModelServiceOptions>(
  options: T
): Omit<T, "requiredFeatures"> & { requiredFeatures: ModelFeature[] } => {
  if (!isNonEmptyString(options.preferredProvider)) throw invalidOption("preferredProvider");
  if (!isNonEmptyString(options.preferredModelAlias)) throw invalidOption("preferredModelAlias");
  if (!isPositiveSafeInteger(options.timeoutMs)) throw invalidOption("timeoutMs");
  if (!isPositiveSafeInteger(options.maxOutputTokens)) throw invalidOption("maxOutputTokens");
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
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new Error(`Invalid model request identity: ${field}`);
  }
}
