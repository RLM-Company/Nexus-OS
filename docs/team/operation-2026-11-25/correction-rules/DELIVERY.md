# DELIVERY — предложение и применение правила проекта

- **Ветка:** `team/correction-rules` от main `e6736e0`.
- **Статус:** готово к интеграции; общий экран результата не трогал (GPT-разработчик).

## Что реализовано

- Переиспользован существующий цикл предложений исправлений:
  `proposeSkillCorrection()` из Skills. `POST /projects/:id/correction-rules/propose`
  возвращает **инертный** draft (`accepted: false`) с формулировкой правила;
  ничего не сохраняется до явного подтверждения.
- `POST /correction-rules/accept` сохраняет draft как **правило проекта** с
  `client_request_id` (идемпотентно) и версией 1; пользователь видит ту же
  формулировку, что была предложена.
- `ProjectCorrectionRuleStore` (миграция 0072): immutable версии, `enabled`,
  `disable/enable` с CAS по версии и текущему состоянию, `rollback` к предыдущей
  версии; история не переписывается.
- `GET /correction-rules` — список правил с версиями и состоянием.
- `POST /:id/disable`, `/:id/enable`, `/:id/rollback` — управление.
- `applyProjectRules()` в core — детерминированное применение активных правил
  к задаче сравнения поставщиков. Для первого сценария правило «в сравнении
  поставщиков всегда показывай доставку отдельной строкой» даёт отдельную
  строку `Доставка: …` и записывает `applied_rule_versions` с версией правила.
  Неизвестный текст правила не угадывается как действие (`ignored_rules`).

## Три прогона на сопоставимых данных

Файлы в `docs/team/operation-2026-11-25/correction-rules/`:

| Прогон              | Файл                      | Результат                                                                      |
| ------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| 1. Без правила      | `run-1-no-rule.txt`       | цена и доставка в одной строке, `applied_rule_versions: []`                    |
| 2. Правило принято  | `run-2-rule-accepted.txt` | `Доставка: 3 дня` / `7 дней` отдельными строками, версия правила `1` сохранена |
| 3. После отключения | `run-3-rule-disabled.txt` | вывод как в прогоне 1, версия остаётся в истории прогона 2                     |

Исходные данные одинаковы во всех трёх: Поставщик А — 100 ₽ / 3 дня; Поставщик Б — 90 ₽ / 7 дней.

## Проверки

```
packages/core  test/project-correction-rules.test.ts      4 passed (3 прогона + файлы)
packages/db    test/project-correction-rules.test.ts      1 passed (версии/disable/rollback)
apps/api       test/project-correction-rules-api.test.ts  1 passed (propose→accept→list→disable, CAS 409)
 typecheck/lint db+core+api · prettier · check-secrets — green
```

Границы: не менял общий экран результата, настройки прав/квот, тарифы, VPS и живые провайдеры.
