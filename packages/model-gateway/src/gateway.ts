import type { Currency, ModelRequest, ModelRouteRequest } from "@cosmora/contracts";
import { ModelRouteError, type ModelRoute, type ModelRouter } from "./router.js";
import {
  GatewayRunError,
  type ModelGatewayStreamEvent,
  type ModelProviderAdapter,
  type ModelRouteAttempt,
  type ProviderStreamEvent,
  type ProviderUsage
} from "./types.js";

const calculateCost = (
  route: ModelRoute,
  usage: ProviderUsage
): { amount: number; currency: Currency } | null => {
  if (!route.pricing || usage.inputTokens === null || usage.outputTokens === null) return null;
  return {
    currency: route.pricing.currency,
    amount:
      (usage.inputTokens * route.pricing.input_per_million_tokens +
        usage.outputTokens * route.pricing.output_per_million_tokens) /
      1_000_000
  };
};

const isValidTokenCount = (value: number | null): boolean =>
  value === null || (Number.isInteger(value) && value >= 0);

export class ModelGateway {
  readonly #adapters: Map<string, ModelProviderAdapter>;
  readonly #router: ModelRouter;
  readonly #fallbackOrder: string[];

  constructor(adapters: ModelProviderAdapter[], router: ModelRouter, fallbackOrder: string[] = []) {
    if (new Set(adapters.map((adapter) => adapter.id)).size !== adapters.length) {
      throw new Error("Model provider adapter IDs must be unique");
    }
    this.#adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
    this.#router = router;
    this.#fallbackOrder = fallbackOrder;
  }

  hasProvider(providerId: string): boolean {
    return this.#adapters.has(providerId);
  }

  async *stream(
    request: ModelRequest,
    externalSignal?: AbortSignal
  ): AsyncGenerator<ModelGatewayStreamEvent> {
    const providerIds = [
      request.routing.preferred_provider,
      ...(request.routing.fallback_allowed ? this.#fallbackOrder : [])
    ].filter((value, index, values) => values.indexOf(value) === index);

    let lastError: GatewayRunError | null = null;
    for (const [attempt, providerId] of providerIds.entries()) {
      const resolved = this.#resolveAttempt(request, providerId, attempt);
      if (resolved instanceof GatewayRunError) {
        lastError = resolved;
        continue;
      }
      const { adapter, route } = resolved;
      yield { type: "route.selected", route };

      let emittedText = false;
      let completed = false;
      try {
        for await (const event of this.#streamWithTimeout(adapter, request, externalSignal)) {
          if (event.type === "text.delta") {
            if (completed) {
              throw new GatewayRunError(
                "PROVIDER_ERROR",
                providerId,
                "Provider emitted text after completion",
                false
              );
            }
            emittedText = true;
            yield event;
            continue;
          }
          if (completed) {
            throw new GatewayRunError(
              "PROVIDER_ERROR",
              providerId,
              "Provider emitted more than one completion event",
              false
            );
          }
          if (event.provider !== route.provider_id || event.model !== route.model_id) {
            throw new GatewayRunError(
              "PROVIDER_ERROR",
              providerId,
              `Provider completion identity does not match registry route ${route.provider_id}:${route.model_id}`,
              false
            );
          }
          if (
            !isValidTokenCount(event.usage.inputTokens) ||
            !isValidTokenCount(event.usage.outputTokens)
          ) {
            throw new GatewayRunError(
              "PROVIDER_ERROR",
              providerId,
              "Provider returned invalid token usage",
              false
            );
          }
          completed = true;
          yield {
            ...event,
            route,
            calculatedCost: calculateCost(resolved.modelRoute, event.usage)
          };
        }
        if (!completed) {
          throw new GatewayRunError(
            "PROVIDER_ERROR",
            providerId,
            "Provider stream ended without completion",
            true
          );
        }
        return;
      } catch (error) {
        const normalized = this.#normalizeError(error, providerId, externalSignal);
        yield {
          type: "route.failed",
          route,
          errorCode: normalized.code,
          retryable: normalized.retryable
        };
        if (emittedText || !request.routing.fallback_allowed) throw normalized;
        lastError = normalized;
      }
    }

    throw (
      lastError ??
      new GatewayRunError("ROUTE_UNAVAILABLE", "none", "No safe model route is configured", false)
    );
  }

  #resolveAttempt(
    request: ModelRequest,
    providerId: string,
    attempt: number
  ):
    | { adapter: ModelProviderAdapter; modelRoute: ModelRoute; route: ModelRouteAttempt }
    | GatewayRunError {
    const routeRequest: ModelRouteRequest = {
      role: request.role,
      task_type: request.task_type,
      preferred_provider: providerId,
      preferred_model_alias: attempt === 0 ? request.routing.preferred_model_alias : null,
      required_features: request.routing.required_features,
      confidential: request.routing.confidential,
      estimated_input_tokens: request.routing.estimated_input_tokens,
      max_output_tokens: request.constraints.max_output_tokens,
      max_cost: request.routing.max_cost,
      optimize_for: request.routing.optimize_for
    };

    let modelRoute: ModelRoute;
    try {
      modelRoute = this.#router.resolve(routeRequest);
    } catch (error) {
      if (error instanceof ModelRouteError) {
        return new GatewayRunError("ROUTE_UNAVAILABLE", providerId, error.message, false, {
          cause: error
        });
      }
      throw error;
    }

    const adapter = this.#adapters.get(modelRoute.provider_id);
    if (!adapter || adapter.modelId !== modelRoute.model_id) {
      return new GatewayRunError(
        "ROUTE_UNAVAILABLE",
        modelRoute.provider_id,
        `No adapter matches registry route ${modelRoute.provider_id}:${modelRoute.model_id}`,
        false
      );
    }

    return {
      adapter,
      modelRoute,
      route: {
        attempt,
        registry_version: modelRoute.registry_version,
        provider_id: modelRoute.provider_id,
        model_id: modelRoute.model_id,
        estimated_input_tokens: request.routing.estimated_input_tokens,
        max_output_tokens: request.constraints.max_output_tokens,
        estimated_cost: modelRoute.estimated_max_cost
      }
    };
  }

  async *#streamWithTimeout(
    adapter: ModelProviderAdapter,
    request: ModelRequest,
    externalSignal?: AbortSignal
  ): AsyncGenerator<ProviderStreamEvent> {
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = (): void => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Provider timeout"));
    }, request.constraints.timeout_ms);

    try {
      for await (const event of adapter.stream(request, controller.signal)) yield event;
      if (timedOut) {
        throw new GatewayRunError("PROVIDER_TIMEOUT", adapter.id, "Model provider timed out", true);
      }
    } catch (error) {
      if (timedOut) {
        throw new GatewayRunError(
          "PROVIDER_TIMEOUT",
          adapter.id,
          "Model provider timed out",
          true,
          { cause: error }
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  #normalizeError(
    error: unknown,
    providerId: string,
    externalSignal?: AbortSignal
  ): GatewayRunError {
    if (error instanceof GatewayRunError) return error;
    if (externalSignal?.aborted) {
      return new GatewayRunError("INTERRUPTED", providerId, "Model run was interrupted", false, {
        cause: error
      });
    }
    return new GatewayRunError("PROVIDER_ERROR", providerId, "Model provider failed", true, {
      cause: error
    });
  }
}
