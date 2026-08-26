import type {
  Currency,
  ModelFeature,
  ModelRegistryEntry,
  ModelRouteRequest
} from "@cosmora/contracts";
import type { ModelRegistry } from "./model-registry.js";

export type ModelRouteFailureCode =
  | "NO_ENABLED_MODEL"
  | "PREFERRED_ROUTE_UNAVAILABLE"
  | "CAPABILITY_UNAVAILABLE"
  | "CONFIDENTIAL_ROUTE_UNAVAILABLE"
  | "CONTEXT_WINDOW_EXCEEDED"
  | "BUDGET_EXCEEDED";

export interface ModelRoute {
  registry_version: string;
  provider_id: string;
  model_id: string;
  protocol: ModelRegistryEntry["protocol"];
  estimated_max_cost: { amount: number; currency: Currency } | null;
  pricing: ModelRegistryEntry["pricing"];
}

export class ModelRouteError extends Error {
  readonly code: ModelRouteFailureCode;

  constructor(code: ModelRouteFailureCode) {
    super(`No safe model route: ${code}`);
    this.name = "ModelRouteError";
    this.code = code;
  }
}

const supports = (entry: ModelRegistryEntry, feature: ModelFeature): boolean =>
  entry.capabilities[feature];

const allows = (allowlist: readonly string[], value: string): boolean =>
  allowlist.length === 0 || allowlist.includes(value);

const estimateCost = (
  entry: ModelRegistryEntry,
  request: ModelRouteRequest
): { amount: number; currency: Currency } | null => {
  if (!entry.pricing) return null;
  return {
    currency: entry.pricing.currency,
    amount:
      (request.estimated_input_tokens * entry.pricing.input_per_million_tokens +
        request.max_output_tokens * entry.pricing.output_per_million_tokens) /
      1_000_000
  };
};

const score = (
  entry: ModelRegistryEntry,
  request: ModelRouteRequest,
  cost: number | null
): number => {
  if (request.optimize_for === "quality") return entry.quality_tier * 1_000 - entry.latency_tier;
  if (request.optimize_for === "latency") return (6 - entry.latency_tier) * 1_000;
  if (request.optimize_for === "cost") return cost === null ? Number.NEGATIVE_INFINITY : -cost;
  return entry.quality_tier * 100 + (6 - entry.latency_tier) * 10 - (cost ?? 1_000);
};

export class ModelRouter {
  readonly #registry: ModelRegistry;

  constructor(registry: ModelRegistry) {
    this.#registry = registry;
  }

  resolve(request: ModelRouteRequest): ModelRoute {
    let candidates = this.#registry.list().filter((entry) => entry.status === "active");
    if (candidates.length === 0) throw new ModelRouteError("NO_ENABLED_MODEL");

    candidates = candidates.filter(
      (entry) => allows(entry.roles, request.role) && allows(entry.task_types, request.task_type)
    );
    if (request.preferred_provider) {
      candidates = candidates.filter((entry) => entry.provider_id === request.preferred_provider);
    }
    if (request.preferred_model_alias) {
      candidates = candidates.filter((entry) =>
        [entry.model_id, ...entry.aliases].includes(request.preferred_model_alias!)
      );
    }
    if (candidates.length === 0) throw new ModelRouteError("PREFERRED_ROUTE_UNAVAILABLE");

    candidates = candidates.filter((entry) =>
      request.required_features.every((feature) => supports(entry, feature))
    );
    if (candidates.length === 0) throw new ModelRouteError("CAPABILITY_UNAVAILABLE");

    if (request.confidential) {
      candidates = candidates.filter(
        (entry) =>
          entry.privacy.confidential_compatible &&
          entry.privacy.training_usage === "none" &&
          entry.privacy.retention !== "unknown"
      );
      if (candidates.length === 0) {
        throw new ModelRouteError("CONFIDENTIAL_ROUTE_UNAVAILABLE");
      }
    }

    candidates = candidates.filter(
      (entry) =>
        request.max_output_tokens <= entry.max_output_tokens &&
        request.estimated_input_tokens + request.max_output_tokens <= entry.context_window_tokens
    );
    if (candidates.length === 0) throw new ModelRouteError("CONTEXT_WINDOW_EXCEEDED");

    const costed = candidates.flatMap((entry) => {
      const estimated = estimateCost(entry, request);
      if (request.max_cost) {
        if (!estimated || estimated.currency !== request.max_cost.currency) return [];
        if (estimated.amount > request.max_cost.amount) return [];
      }
      return [{ entry, estimated }];
    });
    if (costed.length === 0) throw new ModelRouteError("BUDGET_EXCEEDED");

    costed.sort((left, right) => {
      const difference =
        score(right.entry, request, right.estimated?.amount ?? null) -
        score(left.entry, request, left.estimated?.amount ?? null);
      if (difference !== 0) return difference;
      return `${left.entry.provider_id}:${left.entry.model_id}`.localeCompare(
        `${right.entry.provider_id}:${right.entry.model_id}`
      );
    });
    const selected = costed[0];
    if (!selected) throw new ModelRouteError("NO_ENABLED_MODEL");
    return {
      registry_version: this.#registry.version,
      provider_id: selected.entry.provider_id,
      model_id: selected.entry.model_id,
      protocol: selected.entry.protocol,
      estimated_max_cost: selected.estimated,
      pricing: selected.entry.pricing ? structuredClone(selected.entry.pricing) : null
    };
  }
}
