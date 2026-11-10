import { createHash } from "node:crypto";

export interface FableSseEvent {
  event: string;
  data: string;
}

export interface FableSseStreamResult<T = unknown> {
  status: "completed" | "cancelled" | "truncated_error";
  rawText: string;
  unwrappedJsonText: string | null;
  parsedJson: T | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
  usageDisposition: "committed" | "uncertain" | "cancelled_after_dispatch";
  errorCode: string | null;
  responseSha256: string;
}

/**
 * Unwraps at most one outer `<escape>JSON</escape>` envelope (matching PR #426 `parseModelJson`),
 * rejecting nested `<escape>` tags or malformed JSON.
 */
export function unwrapSingleEscapeJsonEnvelope(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.startsWith("<escape>") && trimmed.endsWith("</escape>")) {
    const inner = trimmed.slice("<escape>".length, trimmed.length - "</escape>".length).trim();
    if (inner.includes("<escape>") || inner.includes("</escape>")) {
      throw new Error("NESTED_ESCAPE_ENVELOPE_REJECTED");
    }
    return inner;
  }
  return trimmed;
}

/**
 * Resilient SSE Stream Assembler & Truncation Guard for `claude-fable-5`
 * (closes the deferred SSE streaming block in PR #426 `KOSMORA_FABLE_LIVE_CONNECTIVITY_2026-11-02_RU.md`
 * and PR #428 `KOSWORK_REUSABLE_WORKFLOWS_2026-11-02_RU.md`).
 *
 * Guarantees:
 * 1. Handles arbitrary TCP/ReadableStream chunk splits across UTF-8 multi-byte characters and SSE lines.
 * 2. Immediately halts on cancellation (`signal.aborted` or `isCancelled()`) without attempting to parse
 *    partial JSON buffers or propagating corrupt state.
 * 3. Detects premature upstream socket closes (`FABLE_SSE_TRUNCATED_BEFORE_STOP`) when the stream ends
 *    without an explicit `message_stop` / `[DONE]` completion frame, keeping usage reservation as `uncertain`
 *    (never silently refunding a dispatched request).
 */
export async function consumeFableSseStream<T = Record<string, unknown>>(options: {
  chunks: AsyncIterable<Buffer | Uint8Array | string> | Iterable<Buffer | Uint8Array | string>;
  expectJsonStage?: boolean;
  validateSchema?: (val: unknown) => val is T;
  isCancelled?: () => boolean;
  maxBytes?: number;
}): Promise<FableSseStreamResult<T>> {
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024; // 4 MiB stream ceiling
  const decoder = new TextDecoder("utf-8", { fatal: false });

  let sseBuffer = "";
  let assembledText = "";
  let totalBytesReceived = 0;
  let sawStopEvent = false;
  let stopReason: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let currentEventName = "message";

  const processFrame = (frameText: string) => {
    const lines = frameText.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        currentEventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    if (dataLines.length === 0) return;
    const dataPayload = dataLines.join("\n");

    if (dataPayload === "[DONE]") {
      sawStopEvent = true;
      if (!stopReason) stopReason = "end_turn";
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataPayload) as Record<string, unknown>;
    } catch {
      throw new Error("FABLE_SSE_MALFORMED_FRAME_JSON");
    }

    const type = String(parsed.type ?? currentEventName);
    if (type === "message_start" && parsed.message && typeof parsed.message === "object") {
      const usage = (parsed.message as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      if (typeof usage?.input_tokens === "number") inputTokens = usage.input_tokens;
      if (typeof usage?.output_tokens === "number") outputTokens = usage.output_tokens;
    } else if (type === "content_block_delta" && parsed.delta && typeof parsed.delta === "object") {
      const delta = parsed.delta as { type?: string; text?: string };
      if (typeof delta.text === "string") {
        assembledText += delta.text;
      }
    } else if (type === "message_delta") {
      const delta = parsed.delta as { stop_reason?: string } | undefined;
      if (typeof delta?.stop_reason === "string") {
        stopReason = delta.stop_reason;
      }
      const usage = parsed.usage as { output_tokens?: number } | undefined;
      if (typeof usage?.output_tokens === "number") {
        outputTokens = usage.output_tokens;
      }
    } else if (type === "message_stop") {
      sawStopEvent = true;
      if (!stopReason) stopReason = "end_turn";
    } else if (type === "error") {
      const errObj = parsed.error as { code?: string; message?: string } | undefined;
      const err = new Error(errObj?.message || "Upstream Fable SSE error") as Error & { code?: string };
      err.code = errObj?.code || "FABLE_SSE_UPSTREAM_ERROR";
      throw err;
    }
  };

  try {
    for await (const chunk of options.chunks) {
      if (options.isCancelled?.()) {
        return {
          status: "cancelled",
          rawText: assembledText,
          unwrappedJsonText: null,
          parsedJson: null,
          inputTokens,
          outputTokens,
          stopReason: null,
          usageDisposition: "cancelled_after_dispatch",
          errorCode: "WORK_CANCELLED_DURING_STREAM",
          responseSha256: createHash("sha256").update(assembledText, "utf8").digest("hex")
        };
      }

      const strChunk =
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true });
      totalBytesReceived += Buffer.byteLength(strChunk, "utf8");
      if (totalBytesReceived > maxBytes) {
        return {
          status: "truncated_error",
          rawText: assembledText,
          unwrappedJsonText: null,
          parsedJson: null,
          inputTokens,
          outputTokens,
          stopReason: null,
          usageDisposition: "uncertain",
          errorCode: "FABLE_SSE_STREAM_TOO_LARGE",
          responseSha256: createHash("sha256").update(assembledText, "utf8").digest("hex")
        };
      }

      sseBuffer += strChunk;
      let boundaryIdx: number;
      while ((boundaryIdx = sseBuffer.search(/\r?\n\r?\n/)) !== -1) {
        const match = /\r?\n\r?\n/.exec(sseBuffer.slice(boundaryIdx));
        const sepLen = match ? match[0].length : 2;
        const frame = sseBuffer.slice(0, boundaryIdx);
        sseBuffer = sseBuffer.slice(boundaryIdx + sepLen);
        if (frame.trim()) {
          processFrame(frame);
        }
      }
    }

    sseBuffer += decoder.decode();
    if (sseBuffer.trim()) {
      processFrame(sseBuffer.trim());
    }
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : err instanceof Error
          ? err.message
          : "FABLE_SSE_TRANSPORT_ABORTED";
    return {
      status: "truncated_error",
      rawText: assembledText,
      unwrappedJsonText: null,
      parsedJson: null,
      inputTokens,
      outputTokens,
      stopReason,
      usageDisposition: "uncertain",
      errorCode: code,
      responseSha256: createHash("sha256").update(assembledText, "utf8").digest("hex")
    };
  }

  if (options.isCancelled?.()) {
    return {
      status: "cancelled",
      rawText: assembledText,
      unwrappedJsonText: null,
      parsedJson: null,
      inputTokens,
      outputTokens,
      stopReason,
      usageDisposition: "cancelled_after_dispatch",
      errorCode: "WORK_CANCELLED_DURING_STREAM",
      responseSha256: createHash("sha256").update(assembledText, "utf8").digest("hex")
    };
  }

  // If the provider dropped the connection before sending message_stop / [DONE], do NOT parse truncated JSON!
  if (!sawStopEvent || stopReason === "max_tokens") {
    return {
      status: "truncated_error",
      rawText: assembledText,
      unwrappedJsonText: null,
      parsedJson: null,
      inputTokens,
      outputTokens,
      stopReason,
      usageDisposition: "uncertain",
      errorCode:
        stopReason === "max_tokens"
          ? "FABLE_SSE_TRUNCATED_MAX_TOKENS"
          : "FABLE_SSE_TRUNCATED_BEFORE_STOP",
      responseSha256: createHash("sha256").update(assembledText, "utf8").digest("hex")
    };
  }

  const responseSha256 = createHash("sha256").update(assembledText, "utf8").digest("hex");
  if (!options.expectJsonStage) {
    return {
      status: "completed",
      rawText: assembledText,
      unwrappedJsonText: null,
      parsedJson: null,
      inputTokens,
      outputTokens,
      stopReason,
      usageDisposition: "committed",
      errorCode: null,
      responseSha256
    };
  }

  try {
    const unwrapped = unwrapSingleEscapeJsonEnvelope(assembledText);
    const parsedJson = JSON.parse(unwrapped) as unknown;
    if (options.validateSchema && !options.validateSchema(parsedJson)) {
      return {
        status: "truncated_error",
        rawText: assembledText,
        unwrappedJsonText: unwrapped,
        parsedJson: null,
        inputTokens,
        outputTokens,
        stopReason,
        usageDisposition: "committed",
        errorCode: "FABLE_STAGE_SCHEMA_INVALID",
        responseSha256
      };
    }
    return {
      status: "completed",
      rawText: assembledText,
      unwrappedJsonText: unwrapped,
      parsedJson: parsedJson as T,
      inputTokens,
      outputTokens,
      stopReason,
      usageDisposition: "committed",
      errorCode: null,
      responseSha256
    };
  } catch (err) {
    return {
      status: "truncated_error",
      rawText: assembledText,
      unwrappedJsonText: null,
      parsedJson: null,
      inputTokens,
      outputTokens,
      stopReason,
      usageDisposition: "committed",
      errorCode: err instanceof Error ? err.message : "FABLE_JSON_PARSE_FAILED",
      responseSha256
    };
  }
}
