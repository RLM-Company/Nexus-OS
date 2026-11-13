export type TerminalRunObservation = {
  runId: string;
  phase: "completed" | "failed" | "cancelled";
};

type RunMessage = {
  run_id: string | null;
  role: string;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
};

type RestoredRunState = {
  phase: "idle" | "queued" | "running" | "streaming" | TerminalRunObservation["phase"];
  activeRunId: string | null;
};

export const restoredRunState = (
  messages: readonly RunMessage[],
  terminal: TerminalRunObservation | null = null
): RestoredRunState => {
  const latestRunMessage = [...messages].reverse().find((message) => message.run_id !== null);
  if (!latestRunMessage?.run_id) return { phase: "idle", activeRunId: null };
  const runId = latestRunMessage.run_id;
  // A history read may lag the authoritative terminal event, or have no
  // assistant at all when generation was cancelled before it started.
  if (terminal?.runId === runId) return { phase: terminal.phase, activeRunId: null };

  const latestRunMessages = messages.filter((message) => message.run_id === runId);
  const assistant = [...latestRunMessages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (!assistant) {
    return latestRunMessages.some((message) => message.role === "user")
      ? { phase: "queued", activeRunId: runId }
      : { phase: "idle", activeRunId: null };
  }
  if (assistant.status === "pending") return { phase: "running", activeRunId: runId };
  if (assistant.status === "streaming") return { phase: "streaming", activeRunId: runId };
  if (assistant.status === "completed") return { phase: "completed", activeRunId: null };
  if (assistant.status === "failed") return { phase: "failed", activeRunId: null };
  return { phase: "cancelled", activeRunId: null };
};
