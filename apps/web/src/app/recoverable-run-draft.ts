import { restoredRunState, type TerminalRunObservation } from "./restored-run-state";

type RunMessage = Parameters<typeof restoredRunState>[0][number];

/** Only the latest failed/cancelled run can offer its original request. */
export function recoverableRunDraft<T extends RunMessage>(
  messages: readonly T[],
  terminal: TerminalRunObservation | null = null
): T | null {
  const state = restoredRunState(messages, terminal);
  if (state.phase !== "failed" && state.phase !== "cancelled") return null;
  const runId = messages.findLast((message) => message.run_id !== null)?.run_id;
  if (!runId) return null;
  return (
    messages.findLast((message) => message.run_id === runId && message.role === "user") ?? null
  );
}
