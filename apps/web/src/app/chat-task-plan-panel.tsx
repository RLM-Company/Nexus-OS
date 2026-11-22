"use client";
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
  completed: "завершён",
  blocked: "заблокирован"
};
const TIMING_LABEL: Record<TimingKind, string> = {
  model: "модель",
  tool: "инструменты",
  queue: "очередь",
  pause: "пауза",
  await_owner: "ожидание решения"
};

/** Compact collapsible panel above the composer. Pure presentation: the parent
 * owns the durable plan and feeds it measured event intervals. No invented
 * metrics — only intervals actually recorded from run/tool events are shown. */
export function ChatTaskPlanPanel({
  plan,
  onChange
}: {
  plan: ChatTaskPlan;
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
        {`Шагов: ${summary.total} · завершено ${summary.completed} · выполняется ${summary.running} · ожидает ${summary.pending} · заблокировано ${summary.blocked}`}
        {active ? ` · активный: ${active.title}` : ""}
      </p>
      {!plan.collapsed && (
        <>
          <ol className={styles.steps}>
            {plan.steps.map((step) => (
              <li key={step.id} className={styles.step} data-status={step.status}>
                <span className={styles.status}>{STATUS_LABEL[step.status]}</span>
                <span className={styles.title}>{step.title}</span>
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
          <div className={styles.timing} aria-label="Время по событиям">
            {(Object.keys(TIMING_LABEL) as TimingKind[]).map((kind) => (
              <span key={kind} data-kind={kind}>
                {TIMING_LABEL[kind]}: {formatDuration(summary.timing[kind])}
              </span>
            ))}
            <span data-kind="total">всего: {formatDuration(summary.total_ms)}</span>
          </div>
        </>
      )}
    </section>
  );
}
