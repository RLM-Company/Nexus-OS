import type { ModelRequest } from "@cosmora/contracts";
import {
  assertToolCall,
  assertToolTranscript,
  MAX_TOOL_ARGUMENT_BYTES,
  MAX_TOOL_CALLS
} from "./tool-transcript.js";
import { GatewayRunError, type ModelProviderAdapter, type ProviderStreamEvent } from "./types.js";

export interface OpenAICompatibleAdapterOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImplementation?: typeof fetch;
}

interface CompletionChunk {
  error?: unknown;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
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
    const allowedNames = assertToolTranscript(request, this.id);
    const previousCallIds = new Set(
      request.messages.flatMap((message) => message.tool_calls?.map((call) => call.id) ?? [])
    );
    const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.#model,
        messages: request.messages.map(({ role, content, images, tool_calls, tool_call_id }) => ({
          role,
          ...(tool_calls ? { tool_calls } : {}),
          ...(tool_call_id ? { tool_call_id } : {}),
          content: images?.length
            ? [
                { type: "text", text: content },
                ...images.map((image) => ({
                  type: "image_url",
                  image_url: { url: `data:${image.media_type};base64,${image.data_base64}` }
                }))
              ]
            : content
        })),
        ...(request.tools ? { tools: request.tools, tool_choice: "auto" } : {}),
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

    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    let argumentBytes = 0;
    let resolvedModel = this.#model;
    let finishReason: string | null = null;
    let ended = false;
    let hasText = false;
    let usage = { inputTokens: null as number | null, outputTokens: null as number | null };

    for await (const payload of this.#readDataPayloads(response.body, signal)) {
      if (payload === "[DONE]") {
        ended = true;
        break;
      }
      let chunk: CompletionChunk;
      try {
        chunk = JSON.parse(payload) as CompletionChunk;
      } catch (error) {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          this.id,
          "Provider returned invalid streaming JSON",
          false,
          { cause: error }
        );
      }

      if (!chunk || typeof chunk !== "object" || chunk.error !== undefined) {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          this.id,
          "Invalid provider stream event",
          false
        );
      }
      if (chunk.model) resolvedModel = chunk.model;
      if (chunk.choices && (!Array.isArray(chunk.choices) || chunk.choices.length > 1)) {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          this.id,
          "Invalid provider stream event",
          false
        );
      }
      const choice = chunk.choices?.[0];
      if (choice?.index !== undefined && choice.index !== 0) {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          this.id,
          "Invalid provider stream event",
          false
        );
      }
      const fragments = choice?.delta?.tool_calls;
      if (fragments !== undefined) {
        if (
          finishReason !== null ||
          !Array.isArray(fragments) ||
          !allowedNames.size ||
          fragments.length > MAX_TOOL_CALLS
        ) {
          throw new GatewayRunError(
            "PROVIDER_ERROR",
            this.id,
            "Invalid structured tool call",
            false
          );
        }
        for (const fragment of fragments) {
          if (
            !fragment ||
            !Number.isInteger(fragment.index) ||
            fragment.index < 0 ||
            fragment.index >= MAX_TOOL_CALLS ||
            (fragment.type !== undefined && fragment.type !== "function") ||
            (fragment.id !== undefined && typeof fragment.id !== "string") ||
            (fragment.function !== undefined &&
              (!fragment.function || typeof fragment.function !== "object")) ||
            (fragment.function?.name !== undefined && typeof fragment.function.name !== "string") ||
            (fragment.function?.arguments !== undefined &&
              typeof fragment.function.arguments !== "string")
          ) {
            throw new GatewayRunError(
              "PROVIDER_ERROR",
              this.id,
              "Invalid structured tool call",
              false
            );
          }
          const call = calls.get(fragment.index) ?? { id: "", name: "", arguments: "" };
          call.id += fragment.id ?? "";
          call.name += fragment.function?.name ?? "";
          call.arguments += fragment.function?.arguments ?? "";
          argumentBytes += new TextEncoder().encode(fragment.function?.arguments ?? "").length;
          if (
            call.id.length > 128 ||
            call.name.length > 64 ||
            argumentBytes > MAX_TOOL_ARGUMENT_BYTES
          ) {
            throw new GatewayRunError(
              "PROVIDER_ERROR",
              this.id,
              "Invalid structured tool call",
              false
            );
          }
          calls.set(fragment.index, call);
        }
      }
      const delta = choice?.delta?.content;
      if (delta !== undefined && delta !== null && typeof delta !== "string") {
        throw new GatewayRunError("PROVIDER_ERROR", this.id, "Invalid text delta", false);
      }
      if (delta) {
        if (finishReason !== null) {
          throw new GatewayRunError("PROVIDER_ERROR", this.id, "Text after finish reason", false);
        }
        hasText ||= delta.trim().length > 0;
        yield { type: "text.delta", delta };
      }
      if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
        if (finishReason !== null || typeof choice.finish_reason !== "string") {
          throw new GatewayRunError(
            "PROVIDER_ERROR",
            this.id,
            "Invalid provider stream event",
            false
          );
        }
        finishReason = choice.finish_reason;
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? null,
          outputTokens: chunk.usage.completion_tokens ?? null
        };
      }
    }

    if (
      !ended ||
      (calls.size ? finishReason !== "tool_calls" : finishReason !== "stop" || !hasText)
    ) {
      throw new GatewayRunError(
        "PROVIDER_ERROR",
        this.id,
        "Provider stream did not finish a non-empty text response",
        false
      );
    }
    const completeCalls = [...calls.entries()].sort(([a], [b]) => a - b);
    const ids = new Set<string>();
    try {
      for (const [index, call] of completeCalls) {
        if (index !== ids.size || ids.has(call.id) || previousCallIds.has(call.id))
          throw new Error("Duplicate or noncontiguous tool call");
        assertToolCall(call.id, call.name, call.arguments, allowedNames);
        ids.add(call.id);
      }
    } catch (cause) {
      throw new GatewayRunError("PROVIDER_ERROR", this.id, "Invalid structured tool call", false, {
        cause
      });
    }
    for (const [, call] of completeCalls) {
      if (signal.aborted)
        throw new GatewayRunError("INTERRUPTED", this.id, "Model run was interrupted", false);
      yield { type: "tool.call", ...call };
    }
    yield {
      type: "response.completed",
      provider: this.id,
      model: resolvedModel,
      finishReason: finishReason!,
      usage
    };
  }

  async *#readDataPayloads(
    stream: ReadableStream<Uint8Array>,
    signal: AbortSignal
  ): AsyncGenerator<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const onAbort = (): void => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      while (true) {
        if (signal.aborted)
          throw new GatewayRunError("INTERRUPTED", this.id, "Model run was interrupted", false);
        const { done, value } = await reader.read();
        if (signal.aborted)
          throw new GatewayRunError("INTERRUPTED", this.id, "Model run was interrupted", false);
        buffer += decoder.decode(value, { stream: !done });
        if (buffer.length > 262_144)
          throw new GatewayRunError(
            "PROVIDER_ERROR",
            this.id,
            "Invalid provider stream event",
            false
          );
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data:")) yield line.slice(5).trim();
        }
        if (done) break;
      }
      if (buffer.startsWith("data:")) yield buffer.slice(5).trim();
    } finally {
      signal.removeEventListener("abort", onAbort);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
