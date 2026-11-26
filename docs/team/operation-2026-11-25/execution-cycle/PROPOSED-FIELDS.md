# Proposed diff для стыка цикла исполнения с кандидатом #664

Запрос интегратора в #661: «Пришлите в PR список полей и один полный прогон через существующую отправку Work».

База: main `a6126d424626b15b616a5278cfa788eb08bd1516`.
Кандидат интегратора: #664 @ `daa34066188fb28f4e4ebd9854aba70e20022354`.

## Что уже есть в main (мои поставки #666 и #670)

- `extractSupplierInput(parts)` → `{ input, gaps, needs_answer, ready }`.
- `applySupplierCycleEvent(state,event)` → versioned state machine:
  `collecting | extracting | awaiting_answer | calculating | result_ready | paused | cancelled`;
  события `parts | answer | error | instructions | pause | resume | cancel`;
  `expected_version` CAS через `SupplierCycleConflict`.
- `acceptSupplierResult(state, report)` → `result_ready`.
- Все принятые `parts`, `extraction`, `instructions`, `result` сохраняются при
  ошибке, новых указаниях, паузе и отмене.

## Предлагаемые поля в `ManagerWork` (минимальный diff, пока НЕ применён)

Использовать существующий `supplier_handoff` как якорь источника и добавить:

| Поле                             | Тип            | Назначение                                                         |
| -------------------------------- | -------------- | ------------------------------------------------------------------ |
| `execution_cycle.stage`          | enum           | Текущая стадия state machine                                       |
| `execution_cycle.version`        | integer        | CAS для команд управления (тот же принцип, что `expected_version`) |
| `execution_cycle.question`       | string \| null | Вопрос владельцу, виден в existing Work panel                      |
| `execution_cycle.gaps`           | array          | `{code,path,question?}` из извлечения                              |
| `execution_cycle.instructions`   | string[]       | Новые указания в порядке поступления                               |
| `execution_cycle.error_code`     | string \| null | Промежуточная ошибка                                               |
| `execution_cycle.accepted_parts` | unknown[]      | Принятые части файлов, не очищаются                                |
| `execution_cycle.result_ref`     | string \| null | Ссылка на уже сохранённый расчёт                                   |

Не предлагается менять `input_sha256`, `source_files`, `checks[]`, `disputes[]` —
они уже определены в #664 и остаются источником истины для квитанции.

## CAS и последовательность

1. Transition из сообщения сохраняет `supplier_handoff`, `input_sha256`, `source_files`.
2. Извлечение записывает `gaps`/`question` и `version`; расчёт не вызывается,
   пока `ready !== true`.
3. Ответ владельца/patch вложений проходит с `expected_version`; при расхождении
   409, как в остальных control-командах.
4. После успешного расчёта `result_ref` указывает на существующие CSV/Markdown
   и `supplier-evidence.json`; accepted version сохраняется.
5. Пауза/продолжение/отмена меняют `stage`, но не удаляют accepted parts и result.

## Полный локальный прогон (без модели и VPS)

Команда:

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
  --import ./scripts/cycle-resolve-hook.mjs \
  scripts/koswork-supplier-full-run.mjs
```

Фактический вывод:

```
извлечение: вопрос — Уточните: хотя бы одно дополнительное предложение поставщика для сравнения.
ответ: принято — 2 частей, извлечение готово
ошибка: сохранено — parts=2, code=CALCULATION_INTERRUPTED
указания: принято — Проверить валюту и срока поставки перед расчётом
пауза/продолжение: готово — стадия calculating восстановлена
расчёт: готово — kosmora.supplier-offer-comparison.v1, CSV 568 байт
отмена: результат сохранён — csv=568 байт
FULL RUN PASSED
exit 0
```

Артефакт: `docs/team/operation-2026-11-25/execution-cycle/full-run.json`
(содержит journal и report; сохраняется локально при запуске).

Прогон проходит через **существующий пользовательский вход BIZ-013**: те же два
JSON-вложения, которые подаются в форму «Сравнить поставщиков». Модель, сеть,
платные вызовы и VPS не участвуют.

## Проверки поставок

| SHA                                        | PR   | Проверки                                                       |
| ------------------------------------------ | ---- | -------------------------------------------------------------- |
| `c347cfdb81ca2e2525e7e97993e5916a7068188e` | #666 | extractor 4/4, prettier 0, eslint 0, tsc 0; CI зелёный         |
| `4a77dd3a2e3efffe2a46d1b59050e34c9fdec28b` | #670 | cycle 5/5, prettier 0, eslint 0, tsc 0; CI зелёный после rerun |

## Границы

Общие файлы (`contracts/manager-work.ts`, `manager-work-coordinator.ts`,
`manager-work-routes.ts`, `manager-work-store.ts`, `apps/web/src/app/page.tsx`)
не изменены: proposed fields выше — только предложение для согласования.
Живой прогон через реальный UI Koswork станет возможен после того, как
интегратор примет эти поля в #664.
