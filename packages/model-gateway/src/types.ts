import type { ModelRequest } from "@cosmora/contracts";

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
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
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent>;
}

export type GatewayErrorCode = "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" | "INTERRUPTED";

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
