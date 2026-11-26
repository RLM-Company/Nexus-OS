# Правила Koswork на обычных задачах —continued #662

**Ветка:** `section/koswork-correction-rules` от PR #662 `9199200a`.
Изолированная рабочая копия: `.../koswork-rules`.
**База:** main `e6736e0…`. **PR:** отдельная поставка поверх #662.

## Что добавлено

1. `packages/core/src/project-rule-workflow.ts` — применяет принятые правила к
   результату обычной задачи Koswork на новых исходных данных:
   - доставка отдельной строкой (первый согласованный сценарий);
   - стиль документа как видимый заголовок (второй сценарий);
   - точные версии в `applied_rule_versions`;
   - конфликт старого и нового правила — `conflicts` + `conflict` status;
   - неизвестные/неприменимые правила — `ignored_unknown` / `ignored_not_applicable`.
2. `POST /api/v1/projects/:id/correction-rules/work-apply` — пользовательский вход
   через реальные результаты Work API (`coordinator.results`). Оригинал артефакта
   не переписывается; возвращаются содержимое и статусы правил.
3. Тесты: core, HTTP-цикл и **реальный запуск Work API** с локальным mock-провайдером.

## Реальный прогон (без платных вызовов)

Файлы в `docs/team/operation-2026-11-25/correction-rules/work-runs/`
созданы тестом `apps/api/test/real-work-rule-lifecycle.test.ts`:

| Прогон           | Файл                             | Результат                                          |
| ---------------- | -------------------------------- | -------------------------------------------------- |
| без правила      | `work-1-no-rule.txt/.json`       | `Север: 250 ₽ (доставка 5 дней)`, версий нет       |
| правило принято  | `work-2-rule-accepted.txt/.json` | `Доставка: 5 дней` отдельной строкой, версия **1** |
| после отключения | `work-3-rule-disabled.txt/.json` | исходный вид, версия осталась в истории прогона 2  |

Исходные данные новые (не из первой поставки #662): Север 250 ₽ / 5 дней, Юг 220 ₽ / 11 дней.

Конфликт, неизвестное и стиль проверены фикстурными HTTP-тестами:
`apps/api/test/project-rule-work-api.test.ts`.

## Команды

```bash
pnpm --filter @cosmora/core exec vitest run --pool=threads --maxWorkers=1 test/project-correction-rules.test.ts
pnpm --filter @cosmora/api exec vitest run --pool=threads --maxWorkers=1 \
  test/project-rule-work-api.test.ts test/project-correction-rules-api.test.ts test/real-work-rule-lifecycle.test.ts
pnpm --filter @cosmora/core run typecheck
pnpm --filter @cosmora/api run typecheck
```

## Границы

Multi-Agent, расходы/квоты/тарифы, VPS, живые провайдеры и общий экран результата
не тронуты. Общие контракты не изменялись: новый endpoint и core-функции не меняют
типа `WorkDagNode.result`; пересечение с интегратором — только `app.ts` (одна строка
wiring) и `packages/core/src/index.ts` (export нового модуля).
