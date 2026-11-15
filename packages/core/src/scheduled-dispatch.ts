/** Локальные типы: packages/core не зависит от @cosmora/db. */
export type DispatchMode = "once" | "daily" | "weekdays" | "weekly";
export type DispatchStatus = "scheduled" | "ready" | "dispatched" | "cancelled";
export type ScheduledDispatch = {
  id: string;
  owner_id: string;
  kind: "message" | "work_task" | "koscode_task" | "team_task";
  mode: DispatchMode;
  due_at: string;
  status: DispatchStatus;
  payload: { text: string; title?: string };
};

/** Следующее время срабатывания по режиму, строго больше now.
 * Пропущенные повторы coalesce: не создаём пачку просроченных записей. */
export const nextDispatchAt = (
  mode: DispatchMode,
  dueAt: string,
  nowIso: string,
  timeZone = "Europe/Moscow"
): string | null => {
  if (mode === "once") return null;
  const stepMs = mode === "daily" ? 86_400_000 : mode === "weekly" ? 7 * 86_400_000 : 86_400_000;
  const now = Date.parse(nowIso);
  const start = Date.parse(dueAt);
  if (!Number.isFinite(now) || !Number.isFinite(start)) return null;
  let next = start;
  // Ограничиваем число шагов, чтобы очень старое расписание не крутило цикл вечно.
  for (let guard = 0; guard < 10_000 && next <= now; guard++) next += stepMs;
  if (mode !== "weekdays") return new Date(next).toISOString();
  // weekdays: переносим на ближайший будний день (пн–пт) в той же зоне.
  const weekday = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(new Date(iso));
  while (["Sat", "Sun"].includes(weekday(new Date(next).toISOString()))) next += 86_400_000;
  return new Date(next).toISOString();
};

/** Один явный тик для одного владельца: due → ready, повторные переставляются.
 * Ничего не отправляет и не вызывает модель — исполнение требует dispatch(). */
export const tickScheduledDispatches = (
  due: ScheduledDispatch[],
  nowIso: string
): { readyIds: string[]; rescheduled: Array<{ id: string; next_due_at: string }> } => {
  const readyIds: string[] = [];
  const rescheduled: Array<{ id: string; next_due_at: string }> = [];
  for (const item of due) {
    const next = nextDispatchAt(item.mode, item.due_at, nowIso);
    if (next) rescheduled.push({ id: item.id, next_due_at: next });
    readyIds.push(item.id);
  }
  return { readyIds, rescheduled };
};
