"use client";
import Link from "next/link";
import {
  formatDuration,
  planSummary,
  toggleCollapsed,
  type ChatTaskPlan,
  type TimingKind
} from "./chat-task-plan";
import styles from "./chat-task-plan.module.css";

const STATUS_LABEL: Record<string, string> = {
  pending: "ожидает",
  running: "выполняется",
  paused: "на паузе",
  completed: "завершён",
  blocked: "заблокирован"
};
const REASON_LABEL: Record<string, string> = {
  owner_pause: "пауза владельца",
  awaiting_permission: "ожидает разрешения",
  failed: "ошибка",
  cancelled: "отменён"
};
const TIMING_LABEL: Record<TimingKind, string> = {
  model: "ответы модели",
  tool: "инструменты",
  queue: "очередь",
  pause: "пауза",
  await_owner: "ожидание подтверждения"
};
const TIMING_SOURCE: Record<TimingKind, string> = {
  model: "нет замера завершённого запроса",
  tool: "нет замера записи файлов",
  queue: "нет завершённого замера очереди",
  pause: "нет завершённого замера паузы",
  await_owner: "нет завершённого замера ожидания"
};

/** Compact collapsible panel above the composer. Pure presentation: the parent
 * owns the durable plan and feeds it measured event intervals. No invented
 * metrics — only intervals actually recorded from run/tool events are shown. */
export function ChatTaskPlanPanel({
  plan,
  onChange,
  stale = false
}: {
  plan: ChatTaskPlan;
  stale?: boolean;
  onChange: (next: ChatTaskPlan) => void;
}) {
  const summary = planSummary(plan);
  const active = plan.steps.find((step) => step.id === plan.active_step_id) ?? null;
  return (
    <section className={styles.panel} aria-label="Задачи и план чата">
      <div className={styles.head}>
        <div className={styles.goal}>
          <span className={styles.eyebrow}>Текущая цель</span>
          <strong>{plan.goal}</strong>
        </div>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={!plan.collapsed}
          onClick={() => onChange(toggleCollapsed(plan))}
        >
          {plan.collapsed ? "Развернуть план" : "Свернуть план"}
        </button>
      </div>
      <p className={styles.summary} role="status">
        {`Шагов: ${summary.total} · завершено ${summary.completed} · выполняется ${summary.running} · на паузе ${summary.paused} · ожидает ${summary.pending} · заблокировано ${summary.blocked}`}
        {active ? ` · активный: ${active.title}` : ""}
      </p>
      {stale && <p role="alert">Связь прервана. Показана последняя подтверждённая версия плана.</p>}
      {!plan.collapsed && (
        <>
          <ol className={styles.steps}>
            {plan.steps.map((step) => (
              <li key={step.id} className={styles.step} data-status={step.status}>
                <span className={styles.status}>
                  {STATUS_LABEL[step.status]}
                  {step.block_reason ? ` (${REASON_LABEL[step.block_reason]})` : ""}
                </span>
                <span className={styles.title}>
                  {step.title}
                  {step.depends_on.length > 0 && (
                    <small>
                      {" "}
                      · После:{" "}
                      {step.depends_on
                        .map(
                          (id) => plan.steps.find((candidate) => candidate.id === id)?.title ?? id
                        )
                        .join(", ")}
                    </small>
                  )}
                </span>
                {step.started_at !== null && (
                  <span className={styles.time}>
                    {step.ended_at !== null
                      ? formatDuration(step.ended_at - step.started_at)
                      : "идёт"}
                  </span>
                )}
              </li>
            ))}
          </ol>
          <Link
            href={`/?project=${encodeURIComponent(plan.scope)}&view=plan&plan=${encodeURIComponent(plan.id)}`}
          >
            Открыть управление планом
          </Link>
          <div className={styles.timing} aria-label="Время по событиям">
            {(Object.keys(TIMING_LABEL) as TimingKind[]).map((kind) => (
              <span
                key={kind}
                data-kind={kind}
                title={summary.measured.has(kind) ? undefined : TIMING_SOURCE[kind]}
              >
                {TIMING_LABEL[kind]}:{" "}
                {summary.measured.has(kind) && summary.timing[kind] === 0
                  ? "0 мс"
                  : formatDuration(summary.timing[kind])}
                {summary.measured.has(kind) ? "" : ` (${TIMING_SOURCE[kind]})`}
              </span>
            ))}
            <span data-kind="total">
              измерено:{" "}
              {summary.measured.size && summary.total_ms === 0
                ? "0 мс"
                : formatDuration(summary.total_ms)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
