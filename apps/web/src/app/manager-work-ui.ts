export type ManagerWorkStage = "plan" | "draft" | "review" | "publish" | "done";

export type ManagerWorkStatus =
  | "queued"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

const statusLabels: Record<ManagerWorkStatus, string> = {
  queued: "В очереди",
  running: "Выполняется",
  paused: "На паузе",
  awaiting_approval: "Нужно подтверждение плана",
  blocked: "Нужно разрешение",
  completed: "Готово",
  failed: "Остановлено с ошибкой",
  cancelled: "Отменено"
};

const stageLabels: Record<ManagerWorkStage, string> = {
  plan: "План",
  draft: "Создание результата",
  review: "Проверка Критиком",
  publish: "Сохранение файлов",
  done: "Готово"
};

const attentionStatuses = new Set<ManagerWorkStatus>([
  "awaiting_approval",
  "blocked",
  "failed",
  "paused"
]);

export const managerWorkStatusLabel = (status: ManagerWorkStatus): string => statusLabels[status];

export const managerWorkStageLabel = (
  stage: ManagerWorkStage,
  status?: ManagerWorkStatus
): string => (status === "completed" ? "Готово" : stageLabels[stage]);

export const managerWorkNeedsAttention = (status: ManagerWorkStatus): boolean =>
  attentionStatuses.has(status);
