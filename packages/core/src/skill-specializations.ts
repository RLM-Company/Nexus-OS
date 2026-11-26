/** Three useful specializations built on the existing Skills mechanism.
 * A pack is inert data: no new runtime, no new permissions, no auto-activation.
 * Each pack names task, inputs, procedure, tools, result format and check criteria. */

export type SkillSpecialization = {
  key: string;
  title: string;
  task: string;
  inputs: string[];
  procedure: string[];
  tools: string[];
  result_format: string[];
  check_criteria: string[];
};

export const SKILL_SPECIALIZATIONS: readonly SkillSpecialization[] = [
  {
    key: "document-analyst",
    title: "Аналитик документов",
    task: "Извлечь проверяемые поля из выбранных PDF/сканов и отметить пропуски.",
    inputs: ["список файлов", "схема полей", "приоритетные поля"],
    procedure: [
      "прочитать страницы через существующий PDF/OCR конвейер",
      "сопоставить каждое поле с сохранённой выдержкой",
      "пометить сомнительный OCR и отсутствующие поля"
    ],
    tools: ["extractLibraryPages", "createLibraryOcr", "field register"],
    result_format: ["CSV: значение, файл, страница, статус проверки", "список пропусков"],
    check_criteria: [
      "значения сверены с исходником",
      "критичные поля без сверки с изображением отмечены",
      "противоречия не скрыты"
    ]
  },
  {
    key: "procurement-assistant",
    title: "Помощник закупок",
    task: "Сравнить поставщиков по цене и доставке с учётом принятых правил проекта.",
    inputs: ["строки поставщиков", "активные правила проекта", "снимок версий правил"],
    procedure: [
      "разобрать строки сравнения",
      "применить активные правила с объяснением",
      "показать конфликты и неприменимые правила"
    ],
    tools: ["applyProjectRulesToWorkResult", "project correction rules"],
    result_format: ["итоговый текст", "rule_statuses", "applied_rule_versions", "объяснение"],
    check_criteria: [
      "результат на новой задаче отличается после принятой правки",
      "старая задача сохраняет снимок",
      "версия применённого правила сохранена"
    ]
  },
  {
    key: "project-style-editor",
    title: "Редактор в стиле проекта",
    task: "Применить согласованный шаблон оформления к новому тексту, которого не было в примерах.",
    inputs: ["новый текст", "утверждённый шаблон", "активные стилевые правила"],
    procedure: [
      "проверить применимость правила к типу текста",
      "добавить заголовок стиля только при одном однозначном правиле",
      "объяснить отказ при конфликте или неприменимости"
    ],
    tools: ["applyProjectRulesToWorkResult", "Skills style rules"],
    result_format: ["текст с оформлением", "причина применения или отказа"],
    check_criteria: [
      "стиль применён к новому тексту",
      "конфликт не разрешён молча",
      "исходный текст не переписан скрытно"
    ]
  }
];

export const specializationByKey = (key: string): SkillSpecialization | undefined =>
  SKILL_SPECIALIZATIONS.find((pack) => pack.key === key);
