import type { ModelRequest } from "@nexus/contracts";
import { GatewayRunError, type ModelProviderAdapter, type ProviderStreamEvent } from "./types.js";

export class ModelGateway {
  readonly #adapters: Map<string, ModelProviderAdapter>;
  readonly #fallbackOrder: string[];

  constructor(adapters: ModelProviderAdapter[], fallbackOrder: string[] = []) {
    this.#adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
    this.#fallbackOrder = fallbackOrder;
  }

  hasProvider(providerId: string): boolean {
    return this.#adapters.has(providerId);
  }

  async *stream(
    request: ModelRequest,
    externalSignal?: AbortSignal
  ): AsyncGenerator<ProviderStreamEvent> {
    const providerIds = [
      request.routing.preferred_provider,
      ...(request.routing.fallback_allowed ? this.#fallbackOrder : [])
    ].filter((value, index, values) => values.indexOf(value) === index);

    let lastError: GatewayRunError | null = null;
    for (const providerId of providerIds) {
      const adapter = this.#adapters.get(providerId);
      if (!adapter) {
        lastError = new GatewayRunError(
          "PROVIDER_ERROR",
          providerId,
          `Provider "${providerId}" is not configured`,
          false
        );
        continue;
      }

      let emittedText = false;
      try {
        for await (const event of this.#streamWithTimeout(adapter, request, externalSignal)) {
          if (event.type === "text.delta") emittedText = true;
          yield event;
        }
        return;
      } catch (error) {
        const normalized = this.#normalizeError(error, providerId, externalSignal);
        if (emittedText || !request.routing.fallback_allowed) throw normalized;
        lastError = normalized;
      }
    }

    throw (
      lastError ??
      new GatewayRunError("PROVIDER_ERROR", "none", "No model provider is configured", false)
    );
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
