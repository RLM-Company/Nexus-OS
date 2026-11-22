/** Projector from a Work run into a compact status/timeline for chat plan and
 * timer cards. Pure and UI-agnostic: no storage, no model, no scheduling.
 * Only the public ManagerWork event contract is consumed. */
export type WorkTimelineSource = {
  id: string;
  status: string;
  stage: string;
  events: ReadonlyArray<{
    sequence: number;
    stage: string;
    message: string;
    at: string;
  }>;
  error_code?: string | null;
  model_requests?: number;
  plan?: unknown;
  draft?: unknown;
  result?: unknown;
};
export type WorkTimelineStep = {
  sequence: number;
  stage: string;
  message: string;
  at: string;
  /** Ownership/verification semantics: a critic verdict is not byte validation. */
  kind: "accepted" | "model" | "diagnostic" | "control";
};
export type WorkTimeline = {
  work_id: string;
  status: string;
  stage: string;
  progress: "queued" | "planning" | "awaiting_owner" | "delivering" | "closed";
  title: string;
  error_code: string | null;
  model_requests: number;
  steps: WorkTimelineStep[];
};
const CONTROLS = [
  "Задача принята",
  "Владелец",
  "Пауза",
  "Продолжено",
  "Отменено",
  "перезапуск",
  "Настройки"
];
const stepKind = (message: string): WorkTimelineStep["kind"] => {
  if (message.includes("Задача принята") || CONTROLS.some((c) => message.startsWith(c)))
    return "control";
  if (
    message.includes("ошиб") ||
    message.includes("остановлен") ||
    message.includes("Диагностика") ||
    message.includes("не удалось") ||
    message.includes("отклонён")
  )
    return "diagnostic";
  if (message.includes("модел") || message.includes("Критик") || message.includes("План"))
    return "model";
  return "control";
};
const progressOf = (work: WorkTimelineSource): WorkTimeline["progress"] => {
  switch (work.status) {
    case "completed":
    case "failed":
    case "cancelled":
      return "closed";
    case "awaiting_approval":
    case "blocked":
    case "paused":
      return "awaiting_owner";
    case "queued":
      return "queued";
    default:
      if (work.stage === "plan") return "planning";
      if (["draft", "review", "publish", "publishing"].includes(work.stage)) return "delivering";
      return "queued";
  }
};
const titleOf = (work: WorkTimelineSource): string => {
  const ready = work.plan as { summary?: string } | null | undefined;
  if (typeof ready?.summary === "string" && ready.summary.trim())
    return ready.summary.trim().slice(0, 200);
  const first = work.events[0]?.message;
  return first || `Задача ${work.id}`;
};
export const projectWorkTimeline = (work: WorkTimelineSource): WorkTimeline => ({
  work_id: work.id,
  status: work.status,
  stage: work.stage,
  progress: progressOf(work),
  title: titleOf(work),
  error_code: work.error_code ?? null,
  model_requests: work.model_requests ?? 0,
  steps: [...work.events]
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => ({
      sequence: event.sequence,
      stage: event.stage,
      message: event.message,
      at: event.at,
      kind: stepKind(event.message)
    }))
});
