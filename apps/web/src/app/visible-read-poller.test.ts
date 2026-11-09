import { afterEach, describe, expect, it, vi } from "vitest";
import { startVisibleReadPolling } from "./visible-read-poller";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const stop of disposers.splice(0)) stop();
  vi.useRealTimers();
});
function activity() {
  let visible = true;
  const document = new EventTarget(),
    window = new EventTarget();
  return {
    events: { visible: () => visible, document, window },
    hide() {
      visible = false;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    show() {
      visible = true;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    wake() {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    }
  };
}
describe("visible read polling", () => {
  it("retains foreground cadence, pauses hidden reads and refreshes on return", async () => {
    vi.useFakeTimers();
    const page = activity(),
      read = vi.fn(async () => {});
    disposers.push(
      startVisibleReadPolling(read, { intervalMs: 750, onError: vi.fn(), activity: page.events })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(749);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    page.hide();
    await vi.advanceTimersByTimeAsync(10000);
    expect(read).toHaveBeenCalledTimes(2);
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("coalesces wake events while a read is pending and does not rearm behind a hidden view", async () => {
    vi.useFakeTimers();
    const page = activity();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = vi.fn(() => held);
    disposers.push(
      startVisibleReadPolling(read, { intervalMs: 1000, onError: vi.fn(), activity: page.events })
    );
    page.wake();
    page.show();
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(1);
    page.hide();
    release();
    await vi.advanceTimersByTimeAsync(10000);
    expect(read).toHaveBeenCalledTimes(1);
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("reports read failures, aborts their remaining transport and keeps the next foreground tick", async () => {
    vi.useFakeTimers();
    const page = activity(),
      errors = vi.fn();
    const signals: AbortSignal[] = [];
    const read = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? Promise.reject(new Error("temporary")) : Promise.resolve();
    });
    disposers.push(
      startVisibleReadPolling(read, { intervalMs: 750, onError: errors, activity: page.events })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(signals[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(750);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("aborts on disposal, removes wake handlers and suppresses late errors", async () => {
    vi.useFakeTimers();
    const page = activity(),
      errors = vi.fn();
    let reject!: (error: Error) => void;
    let signal!: AbortSignal;
    const held = new Promise<void>((_resolve, no) => {
      reject = no;
    });
    const read = vi.fn((next: AbortSignal) => {
      signal = next;
      return held;
    });
    const stop = startVisibleReadPolling(read, {
      intervalMs: 750,
      onError: errors,
      activity: page.events
    });
    stop();
    expect(signal.aborted).toBe(true);
    reject(new Error("late"));
    page.show();
    page.wake();
    await vi.advanceTimersByTimeAsync(10000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  });
});
