import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startChatStreamHeartbeat } from "../src/chat-stream-heartbeat.js";

describe("chat stream heartbeat", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["close", "finish"])("keeps silent streams alive and releases timers on %s", (event) => {
    vi.useFakeTimers();
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      write: vi.fn(() => true)
    });
    const stop = startChatStreamHeartbeat(response, 100);
    vi.advanceTimersByTime(300);
    expect(response.write.mock.calls).toEqual([
      [": keep-alive\n\n"],
      [": keep-alive\n\n"],
      [": keep-alive\n\n"]
    ]);
    response.emit(event);
    stop();
    vi.advanceTimersByTime(300);
    expect(response.write).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
    expect(response.listenerCount("finish")).toBe(0);
  });

  it("never writes to a destroyed response", () => {
    vi.useFakeTimers();
    const response = Object.assign(new EventEmitter(), {
      destroyed: true,
      writableEnded: false,
      write: vi.fn(() => true)
    });
    startChatStreamHeartbeat(response, 100);
    vi.advanceTimersByTime(100);
    expect(response.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
