import type { Currency, ModelRequest } from "@cosmora/contracts";

export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

/** A complete validated call, never an executable partial argument delta. */
export interface ModelToolCallEvent {
  type: "tool.call";
  id: string;
  name: string;
  arguments: string;
}

export type ProviderStreamEvent =
  | ModelToolCallEvent
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
  | ModelToolCallEvent
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
  | "ROUTE_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "CIRCUIT_OPEN"
  | "INTERRUPTED"
  | "CONTEXT_TOO_LARGE";

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
  readonly diagnostic: string | undefined;

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
    // Error.message is deliberately not serialized by the runtime logger. Keep
    // an allowlisted operator hint without logging provider bodies or secrets.
    const httpStatus = /^Provider returned HTTP ([45]\d{2})$/u.exec(message)?.[1];
    const protocolReasons: Record<string, string> = {
      "Provider returned an empty body": "EMPTY_BODY",
      "Provider returned invalid streaming JSON": "INVALID_STREAM_JSON",
      "Invalid provider stream event": "INVALID_STREAM_EVENT",
      "Invalid text delta": "INVALID_TEXT_DELTA",
      "Text after finish reason": "TEXT_AFTER_FINISH",
      "Provider stream did not finish a non-empty text response": "INCOMPLETE_TEXT_RESPONSE",
      "Provider stream ended without completion": "MISSING_COMPLETION"
    };
    this.diagnostic =
      code === "PROVIDER_ERROR"
        ? httpStatus
          ? `HTTP_${httpStatus}`
          : Object.hasOwn(protocolReasons, message)
            ? protocolReasons[message]
            : undefined
        : undefined;
  }
}
