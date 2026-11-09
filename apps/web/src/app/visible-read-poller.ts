type Events = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type Activity = { visible: () => boolean; document: Events; window: Events };

/** Read-only polling; hiding a view never pauses or resumes agent execution. */
export function startVisibleReadPolling(
  read: (signal: AbortSignal) => Promise<void>,
  options: { intervalMs: number; onError: (error: unknown) => void; activity?: Activity }
): () => void {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1)
    throw new RangeError("Invalid read polling interval");
  const activity = options.activity ?? {
    visible: () => document.visibilityState !== "hidden",
    document,
    window
  };
  const lifetime = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  const tick = async () => {
    if (pending || lifetime.signal.aborted || !activity.visible()) return;
    clearTimeout(timer);
    pending = true;
    const request = new AbortController();
    try {
      await read(AbortSignal.any([lifetime.signal, request.signal]));
    } catch (error) {
      if (!lifetime.signal.aborted) options.onError(error);
    } finally {
      // Also stop sibling reads when Promise.all rejects early.
      request.abort();
      pending = false;
      if (!lifetime.signal.aborted && activity.visible())
        timer = setTimeout(() => void tick(), options.intervalMs);
    }
  };
  const wake = () => {
    clearTimeout(timer);
    if (activity.visible()) void tick();
  };
  activity.document.addEventListener("visibilitychange", wake);
  activity.window.addEventListener("focus", wake);
  activity.window.addEventListener("online", wake);
  void tick();
  return () => {
    lifetime.abort();
    clearTimeout(timer);
    activity.document.removeEventListener("visibilitychange", wake);
    activity.window.removeEventListener("focus", wake);
    activity.window.removeEventListener("online", wake);
  };
}
