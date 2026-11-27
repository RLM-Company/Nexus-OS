import type { ServerResponse } from "node:http";

type HeartbeatResponse = Pick<ServerResponse, "destroyed" | "writableEnded" | "write"> & {
  once(event: "close" | "finish", listener: () => void): unknown;
  off(event: "close" | "finish", listener: () => void): unknown;
};

/** SSE comments keep a silent model/queue observable without inventing progress. */
export function startChatStreamHeartbeat(
  response: HeartbeatResponse,
  intervalMs = 15_000
): () => void {
  const period = Number.isInteger(intervalMs) && intervalMs > 0 ? intervalMs : 15_000;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    response.off("close", stop);
    response.off("finish", stop);
  };
  const timer = setInterval(() => {
    if (response.destroyed || response.writableEnded) stop();
    else response.write(": keep-alive\n\n");
  }, period);
  timer.unref?.();
  response.once("close", stop);
  response.once("finish", stop);
  return stop;
}
