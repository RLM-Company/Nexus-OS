import type { ModelMessage, ModelRequest } from "@cosmora/contracts";
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
  content: string;
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
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #anthropicVersion: string;
  readonly #fetch: typeof fetch;

  constructor(options: AnthropicCompatibleAdapterOptions) {
    this.id = options.id;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#anthropicVersion = options.anthropicVersion ?? "2023-06-01";
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<ProviderStreamEvent> {
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
    let finishReason = "stop";
    let usage = { inputTokens: 0, outputTokens: 0 };

    for await (const payload of this.#readDataPayloads(response.body)) {
      let event: MessageStreamEvent;
      try {
        event = JSON.parse(payload) as MessageStreamEvent;
      } catch (error) {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          this.id,
          "Provider returned invalid streaming JSON",
          true,
          { cause: error }
        );
      }

      if (event.type === "error") {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          this.id,
          event.error?.message ?? "Provider returned a streaming error",
          true
        );
      }
      if (event.type === "message_start") {
        resolvedModel = event.message?.model ?? resolvedModel;
        usage = {
          inputTokens: event.message?.usage?.input_tokens ?? usage.inputTokens,
          outputTokens: event.message?.usage?.output_tokens ?? usage.outputTokens
        };
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        const delta = event.delta.text;
        if (delta) yield { type: "text.delta", delta };
      }
      if (event.type === "message_delta") {
        finishReason = event.delta?.stop_reason ?? finishReason;
        usage = {
          inputTokens: event.usage?.input_tokens ?? usage.inputTokens,
          outputTokens: event.usage?.output_tokens ?? usage.outputTokens
        };
      }
    }

    yield {
      type: "response.completed",
      provider: this.id,
      model: resolvedModel,
      finishReason,
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
      translated.push({ role: message.role, content: message.content });
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
      reader.releaseLock();
    }
  }
}
