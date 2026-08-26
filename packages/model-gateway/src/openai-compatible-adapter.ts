import type { ModelRequest } from "@cosmora/contracts";
import { GatewayRunError, type ModelProviderAdapter, type ProviderStreamEvent } from "./types.js";

export interface OpenAICompatibleAdapterOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImplementation?: typeof fetch;
}

interface CompletionChunk {
  model?: string;
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  } | null;
}

export class OpenAICompatibleAdapter implements ModelProviderAdapter {
  readonly id: string;
  readonly modelId: string;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.id = options.id;
    this.modelId = options.model;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<ProviderStreamEvent> {
    const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.#model,
        messages: request.messages,
        max_tokens: request.constraints.max_output_tokens,
        stream: true,
        stream_options: { include_usage: true }
      }),
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
    let usage = { inputTokens: null as number | null, outputTokens: null as number | null };

    for await (const payload of this.#readDataPayloads(response.body)) {
      if (payload === "[DONE]") break;
      let chunk: CompletionChunk;
      try {
        chunk = JSON.parse(payload) as CompletionChunk;
      } catch (error) {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          this.id,
          "Provider returned invalid streaming JSON",
          true,
          { cause: error }
        );
      }

      if (chunk.model) resolvedModel = chunk.model;
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) yield { type: "text.delta", delta };
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? null,
          outputTokens: chunk.usage.completion_tokens ?? null
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
