export type SkillPermissionId =
  | "project.read"
  | "context.read"
  | "documents.read"
  | "network.preview"
  | "github.read";

export type SkillPermission = {
  id: SkillPermissionId;
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
    summary: "Собирает структуру исследования из уже доступного проектного контекста.",
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
    summary: "Показывает будущий контракт анализа документов без выполнения внешнего кода.",
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
    summary: "Демонстрирует read-only контракт репозитория и CI без OAuth или write-операций.",
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
        description: "Показывает будущую сетевую границу; реальные запросы не выполняются."
      }
    ]
  }
];

const isSafePermission = (permission: SkillPermission): boolean =>
  permission.mode === "read" || permission.mode === "preview";

export const loadMockSkillCatalog = (): SkillManifest[] =>
  catalog
    .filter((skill) => skill.source === "mock" && skill.execution === "disabled")
    .map((skill) => ({
      ...skill,
      permissions: skill.permissions.filter(isSafePermission)
    }));
