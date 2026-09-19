export type SkillPermission = {
  id: string;
  label: string;
  mode: "read" | "preview";
  description: string;
};

export type SkillManifest = {
  id: string;
  name: string;
  version: string;
  summary: string;
  source: "mock";
  execution: "disabled";
  permissions: SkillPermission[];
};

const catalog: SkillManifest[] = [
  {
    id: "research-brief",
    name: "Research Brief",
    version: "0.1.0",
    summary: "Структура исследования из уже доступного проектного контекста.",
    source: "mock",
    execution: "disabled",
    permissions: [
      {
        id: "project.read",
        label: "Проект",
        mode: "read",
        description: "Чтение текущего проекта без изменений."
      },
      {
        id: "context.read",
        label: "Контекст",
        mode: "read",
        description: "Чтение подключённого контекста без автоматического расширения."
      }
    ]
  },
  {
    id: "document-review",
    name: "Document Review",
    version: "0.1.0",
    summary: "Preview контракта анализа документов без выполнения внешнего кода.",
    source: "mock",
    execution: "disabled",
    permissions: [
      {
        id: "documents.read",
        label: "Документы",
        mode: "read",
        description: "Только чтение уже разрешённых документов."
      }
    ]
  },
  {
    id: "github-audit-preview",
    name: "GitHub Audit Preview",
    version: "0.1.0",
    summary: "Read-only preview репозитория и CI без OAuth или write-операций.",
    source: "mock",
    execution: "disabled",
    permissions: [
      {
        id: "github.read",
        label: "GitHub",
        mode: "read",
        description: "Репозитории, ветки, commits, issues, pull requests и CI только для чтения."
      },
      {
        id: "network.preview",
        label: "Сеть",
        mode: "preview",
        description: "Показывает будущую сетевую границу без реальных запросов."
      }
    ]
  },
  {
    id: "token-economy",
    name: "Контекстный компрессор",
    version: "0.1.0",
    summary:
      "При включённой владельцем экономии передаёт только недавний контекст и сохраняет историю Cosmora целиком.",
    source: "mock",
    execution: "disabled",
    permissions: [
      {
        id: "conversation.read",
        label: "Диалог",
        mode: "read",
        description: "Отбирает недавние полные реплики только для следующего model-запроса."
      }
    ]
  },
  {
    id: "compact-result",
    name: "Короткий результат",
    version: "0.1.0",
    summary:
      "Паттерн краткого ответа без повторов; используется только вместе с явной настройкой экономии.",
    source: "mock",
    execution: "disabled",
    permissions: [
      {
        id: "response.preview",
        label: "Ответ",
        mode: "preview",
        description: "Показывает границу краткого ответа, не выполняя внешних действий."
      }
    ]
  }
];

const isSafePermission = (permission: SkillPermission): boolean => {
  return permission.mode === "read" || permission.mode === "preview";
};

export const loadMockSkillCatalog = (): SkillManifest[] => {
  const safeCatalog: SkillManifest[] = [];

  for (const skill of catalog) {
    if (skill.source !== "mock") continue;
    if (skill.execution !== "disabled") continue;

    const permissions: SkillPermission[] = [];
    for (const permission of skill.permissions) {
      if (isSafePermission(permission)) {
        permissions.push({ ...permission });
      }
    }

    safeCatalog.push({
      ...skill,
      permissions
    });
  }

  return safeCatalog;
};
