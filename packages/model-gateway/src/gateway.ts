import type { Currency, ModelRequest, ModelRouteRequest } from "@cosmora/contracts";
import {
  assertToolCall,
  assertToolTranscript,
  MAX_TOOL_CALLS,
  usesTools
} from "./tool-transcript.js";
import { ModelRouteError, type ModelRoute, type ModelRouter } from "./router.js";
import type { RuntimeClock } from "./runtime-clock.js";
import {
  GatewayRunError,
  type ModelGatewayStreamEvent,
  type ModelGatewayReliabilityOptions,
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

const DEFAULT_RELIABILITY: ModelGatewayReliabilityOptions = {
  maxAttemptsPerRoute: 2,
  retryBaseDelayMs: 250,
  retryMaxDelayMs: 2_000,
  circuitFailureThreshold: 3,
  circuitOpenMs: 30_000
};

const sleep = (delayMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Retry interrupted"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Retry interrupted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

interface CircuitState {
  failures: number;
  openedAt: number | null;
  probeInFlight: boolean;
}

export class ModelGateway {
  readonly #adapters: Map<string, ModelProviderAdapter>;
  readonly #router: ModelRouter;
  readonly #fallbackOrder: string[];
  readonly #reliability: ModelGatewayReliabilityOptions;
  readonly #now: () => number;
  readonly #sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  readonly #circuits = new Map<string, CircuitState>();

  constructor(
    adapters: ModelProviderAdapter[],
    router: ModelRouter,
    fallbackOrder: string[] = [],
    reliability: Partial<ModelGatewayReliabilityOptions> = {},
    private readonly runtimeClock?: RuntimeClock
  ) {
    if (new Set(adapters.map((adapter) => adapter.id)).size !== adapters.length) {
      throw new Error("Model provider adapter IDs must be unique");
    }
    this.#adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
    this.#router = router;
    this.#fallbackOrder = fallbackOrder;
    this.#reliability = { ...DEFAULT_RELIABILITY, ...reliability };
    for (const [name, value] of Object.entries(this.#reliability)) {
      if (name === "now" || name === "sleep") continue;
      if (!Number.isInteger(value) || Number(value) < 0) {
        throw new Error(`Invalid Model Gateway reliability option: ${name}`);
      }
    }
    if (
      this.#reliability.maxAttemptsPerRoute < 1 ||
      this.#reliability.circuitFailureThreshold < 1
    ) {
      throw new Error("Model Gateway reliability attempts and threshold must be positive");
    }
    this.#now = reliability.now ?? Date.now;
    this.#sleep = reliability.sleep ?? sleep;
  }

  hasProvider(providerId: string): boolean {
    return this.#adapters.has(providerId);
  }

  /** Validate the primary registry route without dispatching or touching circuits. */
  assertRoute(request: ModelRequest): void {
    request = this.runtimeClock?.contextualize(request) ?? request;
    assertToolTranscript(request, request.routing.preferred_provider);
    const resolved = this.#resolveAttempt(request, request.routing.preferred_provider, 0, true);
    if (resolved instanceof GatewayRunError) throw resolved;
  }

  async *stream(
    request: ModelRequest,
    externalSignal?: AbortSignal
  ): AsyncGenerator<ModelGatewayStreamEvent> {
    request = this.runtimeClock?.contextualize(request) ?? request;
    const toolNames = assertToolTranscript(request, request.routing.preferred_provider);
    const previousToolIds = new Set(
      request.messages.flatMap((message) => message.tool_calls?.map((call) => call.id) ?? [])
    );
    const providerIds = [
      request.routing.preferred_provider,
      ...(request.routing.fallback_allowed ? this.#fallbackOrder : [])
    ].filter((value, index, values) => values.indexOf(value) === index);

    let lastError: GatewayRunError | null = null;
    let attempt = 0;
    for (const [providerIndex, providerId] of providerIds.entries()) {
      const resolved = this.#resolveAttempt(request, providerId, attempt, providerIndex === 0);
      if (resolved instanceof GatewayRunError) {
        lastError = resolved;
        continue;
      }
      const { adapter, modelRoute } = resolved;
      const circuitKey = `${modelRoute.provider_id}:${modelRoute.model_id}`;

      for (
        let routeAttempt = 0;
        routeAttempt < this.#reliability.maxAttemptsPerRoute;
        routeAttempt++
      ) {
        const route: ModelRouteAttempt = { ...resolved.route, attempt: attempt++ };
        request = this.runtimeClock?.contextualize(request) ?? request;
        yield { type: "route.selected", route };

        const circuitAccess = this.#acquireCircuit(circuitKey);
        if (circuitAccess === null) {
          lastError = new GatewayRunError(
            "CIRCUIT_OPEN",
            providerId,
            `Model route circuit is open: ${circuitKey}`,
            true
          );
          yield {
            type: "route.failed",
            route,
            errorCode: lastError.code,
            retryable: lastError.retryable
          };
          break;
        }

        let emittedOutput = false;
        const toolIds = new Set<string>();
        let completed = false;
        let circuitRecorded = false;
        try {
          for await (const event of this.#streamWithTimeout(
            adapter,
            request,
            request.constraints.timeout_ms,
            externalSignal
          )) {
            if (event.type === "text.delta") {
              if (completed) {
                throw new GatewayRunError(
                  "PROVIDER_ERROR",
                  providerId,
                  "Provider emitted text after completion",
                  false
                );
              }
              emittedOutput = true;
              yield event;
              continue;
            }
            if (event.type === "tool.call") {
              try {
                if (
                  completed ||
                  toolIds.has(event.id) ||
                  previousToolIds.has(event.id) ||
                  toolIds.size >= MAX_TOOL_CALLS
                )
                  throw new Error("Invalid call order");
                assertToolCall(event.id, event.name, event.arguments, toolNames);
              } catch (cause) {
                throw new GatewayRunError(
                  "PROVIDER_ERROR",
                  providerId,
                  "Invalid structured tool call",
                  false,
                  { cause }
                );
              }
              toolIds.add(event.id);
              emittedOutput = true;
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
            if ((event.finishReason === "tool_calls") !== toolIds.size > 0) {
              throw new GatewayRunError(
                "PROVIDER_ERROR",
                providerId,
                "Invalid structured tool completion",
                false
              );
            }
            completed = true;
            emittedOutput = true;
            yield {
              ...event,
              route,
              calculatedCost: calculateCost(modelRoute, event.usage)
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
          this.#recordCircuitSuccess(circuitKey);
          circuitRecorded = true;
          return;
        } catch (error) {
          const normalized = this.#normalizeError(error, providerId, externalSignal);
          this.#recordCircuitFailure(circuitKey, normalized);
          circuitRecorded = true;
          yield {
            type: "route.failed",
            route,
            errorCode: normalized.code,
            retryable: normalized.retryable,
            ...(normalized.diagnostic ? { diagnostic: normalized.diagnostic } : {})
          };
          if (emittedOutput || normalized.code === "INTERRUPTED") throw normalized;
          lastError = normalized;

          const canRetry =
            normalized.retryable && routeAttempt + 1 < this.#reliability.maxAttemptsPerRoute;
          if (!canRetry) break;

          const retryDelay = Math.min(
            this.#reliability.retryBaseDelayMs * 2 ** routeAttempt,
            this.#reliability.retryMaxDelayMs
          );
          try {
            await this.#sleep(retryDelay, externalSignal);
          } catch (sleepError) {
            throw this.#normalizeError(sleepError, providerId, externalSignal);
          }
        } finally {
          if (!circuitRecorded && circuitAccess === "probe") {
            this.#releaseCircuitProbe(circuitKey);
          }
        }
      }

      if (!request.routing.fallback_allowed && lastError) throw lastError;
    }

    throw (
      lastError ??
      new GatewayRunError("ROUTE_UNAVAILABLE", "none", "No safe model route is configured", false)
    );
  }

  #resolveAttempt(
    request: ModelRequest,
    providerId: string,
    attempt: number,
    primaryProvider: boolean
  ):
    | { adapter: ModelProviderAdapter; modelRoute: ModelRoute; route: ModelRouteAttempt }
    | GatewayRunError {
    const routeRequest: ModelRouteRequest = {
      role: request.role,
      task_type: request.task_type,
      preferred_provider: providerId,
      preferred_model_alias: primaryProvider ? request.routing.preferred_model_alias : null,
      required_features: usesTools(request)
        ? [...new Set([...request.routing.required_features, "tool_calling" as const])]
        : request.routing.required_features,
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
    timeoutMs: number,
    externalSignal?: AbortSignal
  ): AsyncGenerator<ProviderStreamEvent> {
    if (externalSignal?.aborted) {
      throw new GatewayRunError("INTERRUPTED", adapter.id, "Model run was interrupted", false);
    }
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = (): void => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Provider timeout"));
    }, timeoutMs);

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

  #acquireCircuit(key: string): "closed" | "probe" | null {
    const state = this.#circuits.get(key);
    if (!state || state.openedAt === null) return "closed";
    if (this.#now() - state.openedAt < this.#reliability.circuitOpenMs) return null;
    if (state.probeInFlight) return null;
    state.probeInFlight = true;
    return "probe";
  }

  #releaseCircuitProbe(key: string): void {
    const state = this.#circuits.get(key);
    if (state) state.probeInFlight = false;
  }

  #recordCircuitSuccess(key: string): void {
    this.#circuits.delete(key);
  }

  #recordCircuitFailure(key: string, error: GatewayRunError): void {
    const state = this.#circuits.get(key) ?? {
      failures: 0,
      openedAt: null,
      probeInFlight: false
    };
    state.probeInFlight = false;
    if (error.code !== "PROVIDER_ERROR" && error.code !== "PROVIDER_TIMEOUT") {
      this.#circuits.set(key, state);
      return;
    }
    state.failures += 1;
    if (state.failures >= this.#reliability.circuitFailureThreshold) {
      state.openedAt = this.#now();
    }
    this.#circuits.set(key, state);
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
