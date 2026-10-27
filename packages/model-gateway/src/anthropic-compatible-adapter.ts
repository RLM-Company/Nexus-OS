import type { ModelMessage, ModelRequest } from "@cosmora/contracts";
import { usesTools } from "./tool-transcript.js";
import { GatewayRunError, type ModelProviderAdapter, type ProviderStreamEvent } from "./types.js";

export interface AnthropicCompatibleAdapterOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  anthropicVersion?: string;
  fetchImplementation?: typeof fetch;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
      >;
}

interface MessageStreamEvent {
  type?: string;
  message?: {
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  delta?: {
    type?: string;
    text?: string;
    stop_reason?: string | null;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

export class AnthropicCompatibleAdapter implements ModelProviderAdapter {
  readonly id: string;
  readonly modelId: string;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #anthropicVersion: string;
  readonly #fetch: typeof fetch;

  constructor(options: AnthropicCompatibleAdapterOptions) {
    this.id = options.id;
    this.modelId = options.model;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#anthropicVersion = options.anthropicVersion ?? "2023-06-01";
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<ProviderStreamEvent> {
    if (usesTools(request)) {
      throw new GatewayRunError(
        "PROVIDER_ERROR",
        this.id,
        "Anthropic-compatible tools are not supported yet",
        false
      );
    }
    const { system, messages } = this.#translateMessages(request.messages);
    const body: {
      model: string;
      max_tokens: number;
      messages: AnthropicMessage[];
      stream: true;
      system?: string;
    } = {
      model: this.#model,
      max_tokens: request.constraints.max_output_tokens,
      messages,
      stream: true
    };
    if (system) body.system = system;

    const response = await this.#fetch(`${this.#baseUrl}/messages`, {
      method: "POST",
      headers: {
        "anthropic-version": this.#anthropicVersion,
        "content-type": "application/json",
        "x-api-key": this.#apiKey
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      throw new GatewayRunError(
        "PROVIDER_ERROR",
        this.id,
        `Provider returned HTTP ${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500
      );
    }
    if (!response.body) {
      throw new GatewayRunError("PROVIDER_ERROR", this.id, "Provider returned an empty body", true);
    }

    let resolvedModel = this.#model;
    let finishReason: string | null = null;
    let ended = false;
    let started = false;
    let hasText = false;
    let usage = { inputTokens: null as number | null, outputTokens: null as number | null };

    for await (const payload of this.#readDataPayloads(response.body)) {
      let event: MessageStreamEvent;
      try {
        event = JSON.parse(payload) as MessageStreamEvent;
      } catch (error) {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          this.id,
          "Provider returned invalid streaming JSON",
          false,
          { cause: error }
        );
      }

      if (!event || typeof event !== "object") {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          this.id,
          "Invalid provider stream event",
          false
        );
      }
      if (event.type === "error") {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          this.id,
          "Provider returned a streaming error",
          false
        );
      }
      if (event.type === "message_start") {
        if (started)
          throw new GatewayRunError("PROVIDER_ERROR", this.id, "Duplicate message start", false);
        started = true;
        resolvedModel = event.message?.model ?? resolvedModel;
        usage = {
          inputTokens: event.message?.usage?.input_tokens ?? usage.inputTokens,
          outputTokens: event.message?.usage?.output_tokens ?? usage.outputTokens
        };
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        const delta = event.delta.text;
        if (typeof delta !== "string" || !started || finishReason !== null) {
          throw new GatewayRunError("PROVIDER_ERROR", this.id, "Invalid text delta", false);
        }
        if (delta) {
          hasText ||= delta.trim().length > 0;
          yield { type: "text.delta", delta };
        }
      }
      if (event.type === "message_delta") {
        finishReason = event.delta?.stop_reason ?? finishReason;
        usage = {
          inputTokens: event.usage?.input_tokens ?? usage.inputTokens,
          outputTokens: event.usage?.output_tokens ?? usage.outputTokens
        };
      }
      if (event.type === "message_stop") {
        ended = true;
        break;
      }
    }

    if (
      !started ||
      !ended ||
      !hasText ||
      !["end_turn", "stop_sequence"].includes(finishReason ?? "")
    ) {
      throw new GatewayRunError(
        "PROVIDER_ERROR",
        this.id,
        "Provider stream did not finish a non-empty text response",
        false
      );
    }
    yield {
      type: "response.completed",
      provider: this.id,
      model: resolvedModel,
      finishReason: finishReason!,
      usage
    };
  }

  #translateMessages(messages: ModelMessage[]): {
    system: string;
    messages: AnthropicMessage[];
  } {
    const system: string[] = [];
    const translated: AnthropicMessage[] = [];

    for (const message of messages) {
      if (message.role === "system") {
        system.push(message.content);
        continue;
      }
      if (message.role === "tool") {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          this.id,
          "Anthropic-compatible tool messages are not supported yet",
          false
        );
      }
      translated.push({
        role: message.role,
        content: message.images?.length
          ? [
              { type: "text", text: message.content },
              ...message.images.map((image) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: image.media_type,
                  data: image.data_base64
                }
              }))
            ]
          : message.content
      });
    }

    if (translated.length === 0) {
      throw new GatewayRunError(
        "PROVIDER_ERROR",
        this.id,
        "Anthropic-compatible requests require at least one user or assistant message",
        false
      );
    }

    return { system: system.join("\n\n"), messages: translated };
  }

  async *#readDataPayloads(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data:")) yield line.slice(5).trim();
        }
        if (done) break;
      }
      if (buffer.startsWith("data:")) yield buffer.slice(5).trim();
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
