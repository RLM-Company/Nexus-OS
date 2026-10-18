import styles from "./work-plan-view.module.css";

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
