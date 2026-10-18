import type { ReactNode } from "react";
import styles from "./work-plan-view.module.css";

type PlanState = { status: string };

/** Presentation only: every count comes from the current saved plan. */
export function WorkPlanOverview({ nodes }: { nodes: readonly PlanState[] }) {
  const completed = nodes.filter((node) => node.status === "completed").length;
  const running = nodes.filter((node) => node.status === "running").length;
  const blocked = nodes.filter((node) => node.status === "blocked").length;
  const failed = nodes.filter((node) => node.status === "failed").length;
  const cancelled = nodes.filter((node) => node.status === "cancelled").length;
  return (
    <div className={styles.overview} aria-label="Обзор выполнения плана">
      <div className={styles.progressHeading}>
        <span>Выполнение плана</span>
        <strong>
          {completed} из {nodes.length}
        </strong>
      </div>
      <progress aria-label="Прогресс плана" value={completed} max={Math.max(1, nodes.length)} />
      <dl className={styles.metrics}>
        {[
          ["Всего шагов", nodes.length],
          ["Завершено", completed],
          ["В работе", running],
          ["Заблокировано", blocked]
        ].map(([label, count]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
      {(failed > 0 || cancelled > 0) && (
        <p className={styles.note}>
          С ошибкой: {failed} · Отменено: {cancelled}
        </p>
      )}
    </div>
  );
}

export function WorkPlanStepHeading({
  index,
  title,
  status,
  statusLabel,
  children
}: {
  index: number;
  title: string;
  status: string;
  statusLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.stepHeading}>
      <span className={styles.marker} data-state={status} aria-hidden="true">
        {status === "completed" ? "✓" : status === "failed" ? "!" : index + 1}
      </span>
      <div className={styles.stepTitle}>
        <strong>{title}</strong>
        {children}
      </div>
      <span className={styles.status} data-state={status}>
        {statusLabel}
      </span>
    </div>
  );
}

export function WorkPlanEditorTracker({
  titleReady,
  completedSteps,
  totalSteps,
  onNavigate
}: {
  titleReady: boolean;
  completedSteps: number;
  totalSteps: number;
  onNavigate: (section: "title" | "steps" | "save") => void;
}) {
  const stepsReady = totalSteps > 0 && completedSteps === totalSteps;
  const ready = titleReady && stepsReady;
  const items = [
    {
      id: "title" as const,
      title: "Настройка",
      detail: titleReady ? "Название заполнено" : "Назовите план",
      done: titleReady
    },
    {
      id: "steps" as const,
      title: "Шаги",
      detail: `${completedSteps} из ${totalSteps} заполнено`,
      done: stepsReady
    },
    {
      id: "save" as const,
      title: "Сохранение",
      detail: ready ? "Проверьте и сохраните" : "Сначала заполните план",
      done: false
    }
  ];
  const activeIndex = !titleReady ? 0 : !stepsReady ? 1 : 2;
  return (
    <ol className={styles.tracker} aria-label="Подготовка плана">
      {items.map((item, index) => (
        <li
          key={item.id}
          data-state={item.done ? "completed" : index === activeIndex ? "current" : "pending"}
        >
          <button
            type="button"
            onClick={() => onNavigate(item.id)}
            aria-current={index === activeIndex ? "step" : undefined}
          >
            <span className={styles.trackerNumber} aria-hidden="true">
              {item.done ? "✓" : index + 1}
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
