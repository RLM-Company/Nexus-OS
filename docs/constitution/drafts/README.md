# Synmetis AI — Конституции и автономность

> Статус: `SPECIFICATION WORKSPACE / NOT RUNTIME`  
> Обновлено: 2026-08-24

## Важно

Документы являются спецификациями, а не активными системными промптами. Рабочие названия A0–A6 и Synmetis могут быть изменены отдельно.

## Приоритет

1. применимый закон;
2. неизменяемая Конституция и системное ядро;
3. emergency stop и прямой запрет владельца;
4. capability profile, Permission Contract и overrides;
5. паспорт проекта, кампания и бюджет;
6. промпт Менеджера;
7. промпт агента;
8. текущая задача и данные.

Явное расширение более высокого уровня заменяет ограничение младшего для той же способности. Неупомянутое правило наследуется. Для составного действия наиболее строгий verdict применяется между затронутыми категориями, а не между историческими уровнями.

## Уровни

| Уровень | Рабочий смысл | Состояние |
| --- | --- | --- |
| A0 | Базовый чат | Переработан после аудита |
| A1 | Расширенный ИИ-помощник с данными и интернетом | Переработан после аудита |
| A2 | Внутреннее исполнение и интеграции | Обновлён |
| A3 | Внешнее исполнение | Обновлён |
| A4 | Финансовая автономность | Обновлён |
| A5 | Автономный проект | Обновлён; монотонность с A4 исправлена |
| A6 | Полная автономность выбранной категории | Переработан после аудита |

## Документы уровней

- [`A0-consultation.md`](./A0-consultation.md)
- [`A1-step-by-step.md`](./A1-step-by-step.md)
- [`A2-internal-execution.md`](./A2-internal-execution.md)
- [`A3-external-execution.md`](./A3-external-execution.md)
- [`A4-financial-autonomy.md`](./A4-financial-autonomy.md)
- [`A5-autonomous-project.md`](./A5-autonomous-project.md)
- [`A6-full-autonomy.md`](./A6-full-autonomy.md)

## Общие Конституции

- [`manager-constitution-v1.md`](./manager-constitution-v1.md) — Конституция Менеджера v1.1-rc.
- [`memory-learning-constitution-v1.md`](./memory-learning-constitution-v1.md) — Конституция памяти и обучения v1.1-rc.
- [`identity-model-naming-discovery.md`](./identity-model-naming-discovery.md) — отложенная идентичность и нейминг моделей.

## Исполняемые спецификации

- [`../specifications/autonomy-schema-v1.1.md`](../specifications/autonomy-schema-v1.1.md)
- [`../specifications/permission-contract-v1.md`](../specifications/permission-contract-v1.md)
- [`../specifications/execution-safety-v1.md`](../specifications/execution-safety-v1.md)
- [`../specifications/data-governance-v1.md`](../specifications/data-governance-v1.md)
- [`../specifications/model-routing-critic-v1.md`](../specifications/model-routing-critic-v1.md)
- [`../specifications/sandbox-constitution-v0.1.md`](../specifications/sandbox-constitution-v0.1.md)

## Аудит

- [`../reviews/2026-08-24-cross-system-audit-v1.md`](../reviews/2026-08-24-cross-system-audit-v1.md)

## Следующий этап

После утверждения resolution-пакета правила превращаются в JSON-контракты Policy Engine и автоматические тесты. Только затем совместно с владельцем пишется runtime-промпт Менеджера.
