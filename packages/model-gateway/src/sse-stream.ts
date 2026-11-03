import { GatewayRunError } from "./types.js";

export const SSE_MAX_EVENT_BYTES = 262_144;

/** Provider SSE data payloads, with bounded individual lines/events.
 * Unlike browser EventSource, retain the existing adapters' final EOF payload.
 * Callers MUST still validate their provider's terminal marker and finish reason.
 */
export async function* readSseData(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  provider: string
): AsyncGenerator<string> {
  const reader = stream.getReader();
  // Keep a BOM anywhere except the very beginning of the stream.
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const encoder = new TextEncoder();
  let line = new Uint8Array(4096),
    lineBytes = 0,
    firstLine = true,
    skipLF = false;
  let parts: string[] = [],
    eventBytes = 0,
    cancelled = false;
  const interrupted = () =>
    new GatewayRunError("INTERRUPTED", provider, "Model run was interrupted", false);
  const oversized = () =>
    new GatewayRunError(
      "PROVIDER_ERROR",
      provider,
      "Provider stream exceeded its event size limit",
      false
    );
  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    // Some sources never settle cancel(). Neither abort nor early return may
    // wait for it; attach rejection handling immediately, without exposing it.
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      /* Already released. */
    }
  };
  signal.addEventListener("abort", cancel, { once: true });
  const read = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(interrupted());
        return;
      }
      const abort = (): void => {
        signal.removeEventListener("abort", abort);
        reject(interrupted());
      };
      signal.addEventListener("abort", abort, { once: true });
      const fail = (): void => {
        signal.removeEventListener("abort", abort);
        reject(
          signal.aborted
            ? interrupted()
            : new GatewayRunError("PROVIDER_ERROR", provider, "Provider stream read failed", true)
        );
      };
      try {
        void reader.read().then((result) => {
          signal.removeEventListener("abort", abort);
          if (signal.aborted) reject(interrupted());
          else resolve(result);
        }, fail);
      } catch {
        fail();
      }
      if (signal.aborted) abort();
    });
  const append = (value: Uint8Array, start: number, end: number): void => {
    const required = lineBytes + end - start;
    if (required > SSE_MAX_EVENT_BYTES) throw oversized();
    if (required > line.length) {
      const next = new Uint8Array(
        Math.min(SSE_MAX_EVENT_BYTES, Math.max(required, line.length * 2))
      );
      next.set(line.subarray(0, lineBytes));
      line = next;
    }
    line.set(value.subarray(start, end), lineBytes);
    lineBytes = required;
  };
  const dispatch = (): string | undefined => {
    if (!parts.length) return undefined;
    const data = parts.join("\n");
    parts = [];
    eventBytes = 0;
    return data;
  };
  const consumeLine = (): string | undefined => {
    let text = decoder.decode(line.subarray(0, lineBytes));
    lineBytes = 0;
    if (firstLine) {
      firstLine = false;
      if (text.startsWith("\uFEFF")) text = text.slice(1);
    }
    if (!text.length) return dispatch();
    const colon = text.indexOf(":");
    if ((colon < 0 ? text : text.slice(0, colon)) !== "data") return undefined;
    let data = colon < 0 ? "" : text.slice(colon + 1);
    if (data.startsWith(" ")) data = data.slice(1);
    eventBytes += encoder.encode(data).byteLength + (parts.length ? 1 : 0);
    if (eventBytes > SSE_MAX_EVENT_BYTES) throw oversized();
    parts.push(data);
    return undefined;
  };
  try {
    if (signal.aborted) {
      cancel();
      throw interrupted();
    }
    while (true) {
      const { done, value } = await read();
      if (signal.aborted) throw interrupted();
      if (done) break;
      let start = 0;
      for (let index = 0; index < value.length; index++) {
        const byte = value[index];
        if (skipLF) {
          skipLF = false;
          if (byte === 10) {
            start = index + 1;
            continue;
          }
        }
        if (byte !== 10 && byte !== 13) {
          if (lineBytes + index - start >= SSE_MAX_EVENT_BYTES) throw oversized();
          continue;
        }
        append(value, start, index);
        start = index + 1;
        skipLF = byte === 13;
        const data = consumeLine();
        if (data !== undefined) {
          yield data;
          if (signal.aborted) throw interrupted();
        }
      }
      append(value, start, value.length);
    }
    if (signal.aborted) throw interrupted();
    if (lineBytes) {
      const data = consumeLine();
      if (data !== undefined) {
        yield data;
        if (signal.aborted) throw interrupted();
      }
    }
    if (signal.aborted) throw interrupted();
    const final = dispatch();
    if (final !== undefined) {
      yield final;
      if (signal.aborted) throw interrupted();
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    try {
      reader.releaseLock();
    } catch {
      /* A broken source must not block cleanup. */
    }
  }
}
