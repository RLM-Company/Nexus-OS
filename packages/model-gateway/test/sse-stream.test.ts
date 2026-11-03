import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { readSseData, SSE_MAX_EVENT_BYTES as limit } from "../src/sse-stream.js";

const encoder = new TextEncoder();
function stream(text: string, fragment = Infinity): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(text);
  let position = 0;
  return new ReadableStream({
    pull(controller) {
      if (position >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(bytes.length, position + fragment);
      controller.enqueue(bytes.slice(position, end));
      position = end;
    }
  });
}
async function collect(
  body: ReadableStream<Uint8Array>,
  signal = new AbortController().signal
): Promise<string[]> {
  const result: string[] = [];
  for await (const data of readSseData(body, signal, "test")) result.push(data);
  return result;
}
describe("bounded provider SSE framing", () => {
  it("does not deliver bytes when abort races a resolved read before generator resumption", async () => {
    const controller = new AbortController();
    const body = stream("data: should not arrive\n\n");
    const iterator = readSseData(body, controller.signal, "test");
    const pending = iterator.next();
    queueMicrotask(() => controller.abort());
    await expect(pending).rejects.toMatchObject({ code: "INTERRUPTED" });
    expect(body.locked).toBe(false);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
  it("interrupts after delivery of the final EOF payload without inventing completion", async () => {
    const abort = new AbortController();
    const source = stream("data: last");
    const iterator = readSseData(source, abort.signal, "test");
    expect((await iterator.next()).value).toBe("last");
    abort.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: "INTERRUPTED" });
    expect(source.locked).toBe(false);
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  });
  it.each([1, 2, 3, 7, 1000000])(
    "preserves UTF8 and handles fragmented CRLF, bare CR, LF and the initial BOM (%i bytes)",
    async (fragment) => {
      const text =
        "\uFEFF: hello\r\ndata: первый🙂\r\ndata:  second\r\n\r\ndata: troisième\r\rid: ignored\ndata: финал\n\n";
      expect(await collect(stream(text, fragment))).toEqual([
        "первый🙂\n second",
        "troisième",
        "финал"
      ]);
    }
  );
  it("keeps whitespace, recognizes only the data field, and distinguishes empty data from no data", async () => {
    expect(
      await collect(
        stream(
          "event: ping\n: comment\nDATA: ignored\n\ndata:\n\ndata\n\ndata:  x \t\n\ndata:\ndata:\n\ndata: \uFEFFy\n\n"
        )
      )
    ).toEqual(["", "", " x \t", "\n", "\uFEFFy"]);
    expect(await collect(stream("\n\uFEFFdata: ignored\n\n"))).toEqual([]);
    expect(await collect(stream("\uFEFF\uFEFFdata: ignored\n\n"))).toEqual([]);
  });
  it.each(["data: last", "data: last\n", "data: last\r", "data: one\ndata: two", "data: last\n\n"])(
    "retains the legacy EOF payload once: %j",
    async (text) => {
      expect(await collect(stream(text, 2))).toEqual([text.includes("one") ? "one\ntwo" : "last"]);
    }
  );
  it("accepts a large network chunk of many individually bounded events", async () => {
    const events = 50000;
    const results = await collect(stream("data: x\n\n".repeat(events)));
    expect(results).toHaveLength(events);
    expect(results.every((s) => s === "x")).toBe(true);
  });
  it("enforces the line limit before decoding and cancels a source without a newline", async () => {
    const controller = new AbortController();
    let cancelled = 0;
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode("data: " + "x".repeat(limit)));
      },
      cancel() {
        cancelled++;
      }
    });
    await expect(collect(source, controller.signal)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      diagnostic: "STREAM_EVENT_TOO_LARGE",
      retryable: false
    });
    expect(cancelled).toBe(1);
    expect(source.locked).toBe(false);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    await expect(collect(stream(":" + "x".repeat(limit) + "\n\n"))).rejects.toMatchObject({
      diagnostic: "STREAM_EVENT_TOO_LARGE"
    });
  });
  it("counts event UTF8 bytes and joined newlines independently of bounded lines", async () => {
    const unicode = "🙂".repeat(32768); // 131072 UTF8 bytes per line.
    await expect(collect(stream(`data: ${unicode}\ndata: ${unicode}\n\n`))).rejects.toMatchObject({
      diagnostic: "STREAM_EVENT_TOO_LARGE"
    });
    const first = "x".repeat(limit / 2),
      second = "y".repeat(limit / 2 - 1);
    const accepted = await collect(stream(`data: ${first}\ndata: ${second}\n\n`, 4093));
    expect(encoder.encode(accepted[0]).length).toBe(limit);
    await expect(collect(stream(`data: ${first}\ndata: ${second}z\n\n`))).rejects.toMatchObject({
      diagnostic: "STREAM_EVENT_TOO_LARGE"
    });
  });
  it("accepts the exact wire-line bound and bounds accumulation across tiny chunks", async () => {
    const payload = "x".repeat(limit - 6);
    expect((await collect(stream(`data: ${payload}\n\n`, 7)))[0]).toBe(payload);
    await expect(collect(stream(`data: ${payload}x`, 7))).rejects.toMatchObject({
      diagnostic: "STREAM_EVENT_TOO_LARGE"
    });
  });
  it.each(["resolve", "reject", "hang"])(
    "aborts a pending read even if underlying cancellation will %s",
    async (mode) => {
      const abort = new AbortController();
      let cancels = 0;
      const source = new ReadableStream<Uint8Array>({
        cancel() {
          cancels++;
          if (mode === "reject") return Promise.reject(Error("private source"));
          if (mode === "hang") return new Promise(() => {});
        }
      });
      const pending = collect(source, abort.signal);
      abort.abort("private abort reason");
      await expect(pending).rejects.toMatchObject({ code: "INTERRUPTED" });
      expect(cancels).toBe(1);
      expect(source.locked).toBe(false);
      expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
    }
  );
  it.each(["reject", "hang"])(
    "returns early without waiting for cancellation to %s",
    async (mode) => {
      const abort = new AbortController();
      let cancels = 0;
      const source = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode("data: first\n\ndata: second\n\n"));
        },
        cancel() {
          cancels++;
          return mode === "reject" ? Promise.reject(Error("private")) : new Promise(() => {});
        }
      });
      const iterator = readSseData(source, abort.signal, "test");
      expect(await iterator.next()).toMatchObject({ value: "first" });
      await expect(iterator.return(undefined)).resolves.toMatchObject({ done: true });
      expect(cancels).toBe(1);
      expect(source.locked).toBe(false);
      expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
    }
  );
  it("cancels when aborted during a yielded event and emits no further event", async () => {
    const abort = new AbortController();
    let cancels = 0;
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode("data: one\n\ndata: two\n\n"));
      },
      cancel() {
        cancels++;
      }
    });
    const iterator = readSseData(source, abort.signal, "test");
    expect((await iterator.next()).value).toBe("one");
    abort.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: "INTERRUPTED" });
    expect(cancels).toBe(1);
    expect(source.locked).toBe(false);
  });
  it("cleans up a pre-aborted signal and never serializes source exceptions", async () => {
    const abort = new AbortController();
    abort.abort();
    const source = stream("data: secret\n\n");
    await expect(collect(source, abort.signal)).rejects.toMatchObject({ code: "INTERRUPTED" });
    expect(source.locked).toBe(false);
    const broken = new ReadableStream<Uint8Array>({
      pull() {
        throw Error("private response and credentials");
      }
    });
    let error: unknown;
    try {
      await collect(broken);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({
      code: "PROVIDER_ERROR",
      diagnostic: "STREAM_READ_FAILED",
      retryable: true
    });
    expect(String(error)).not.toContain("private");
    expect(JSON.stringify(error)).not.toContain("credentials");
    expect(broken.locked).toBe(false);
  });
  it("removes each pending-read listener instead of accumulating an abort-promise race", async () => {
    const abort = new AbortController();
    let position = 0,
      maxListeners = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(c) {
        maxListeners = Math.max(maxListeners, getEventListeners(abort.signal, "abort").length);
        if (position++ < 2000) c.enqueue(encoder.encode("data: x\n\n"));
        else c.close();
      }
    });
    expect(await collect(source, abort.signal)).toHaveLength(2000);
    expect(maxListeners).toBeLessThanOrEqual(2);
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  });
});
