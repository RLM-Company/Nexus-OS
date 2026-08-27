import type { Currency, ModelRequest } from "@cosmora/contracts";

export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export type ProviderStreamEvent =
  | { type: "text.delta"; delta: string }
  | {
      type: "response.completed";
      provider: string;
      model: string;
      finishReason: string;
      usage: ProviderUsage;
    };

export interface ModelProviderAdapter {
  readonly id: string;
  readonly modelId: string;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent>;
}

export interface ModelRouteAttempt {
  attempt: number;
  registry_version: string;
  provider_id: string;
  model_id: string;
  estimated_input_tokens: number;
  max_output_tokens: number;
  estimated_cost: { amount: number; currency: Currency } | null;
}

export type ModelGatewayStreamEvent =
  | { type: "text.delta"; delta: string }
  | { type: "route.selected"; route: ModelRouteAttempt }
  | {
      type: "route.failed";
      route: ModelRouteAttempt;
      errorCode: GatewayErrorCode;
      retryable: boolean;
    }
  | {
      type: "response.completed";
      provider: string;
      model: string;
      finishReason: string;
      usage: ProviderUsage;
      route: ModelRouteAttempt;
      calculatedCost: { amount: number; currency: Currency } | null;
    };

export type GatewayErrorCode =
  "ROUTE_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" | "CIRCUIT_OPEN" | "INTERRUPTED";

export interface ModelGatewayReliabilityOptions {
  maxAttemptsPerRoute: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  circuitFailureThreshold: number;
  circuitOpenMs: number;
  now?: () => number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

export class GatewayRunError extends Error {
  readonly code: GatewayErrorCode;
  readonly provider: string;
  readonly retryable: boolean;

  constructor(
    code: GatewayErrorCode,
    provider: string,
    message: string,
    retryable: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "GatewayRunError";
    this.code = code;
    this.provider = provider;
    this.retryable = retryable;
  }
}
