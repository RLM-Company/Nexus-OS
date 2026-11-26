# Цикл исполнения Koswork: сценарий 1 (извлечение предложений)

## Исходная зона

Довести цикл исполнения: понять цель → выбрать инструмент → выполнить →
прочитать результат → проверить → изменить план → завершить. Первый сценарий:
получить разрешённые предложения поставщиков из файлов, извлечь данные,
вызвать существующий расчёт и подготовить итог. Агент обнаруживает пропуски,
корректирует извлечение и задаёт вопрос, когда без ответа нельзя завершить.

## Что уже есть в main `e6736e0b`

- `packages/core/src/supplier-offer-comparison.ts` — существующий расчёт BIZ-013;
  требует от 1 до 200 требований и **от 2 до 12 предложений**.
- `apps/api/src/business-work-reports.ts` — пользовательский вход Koswork:
  `output_contract.kind === "supplier_comparison"`, данные берутся из `goal` JSON,
  вызывается `compareSupplierOffers`, сохраняются CSV и Markdown.
- `apps/web/src/app/manager-work-panel.tsx` — форма «Сравнить поставщиков»
  с полем JSON и запуском обычной задачи.
- Transition сообщение → вложения → ManagerWork → принятие готовится в
  открытом PR #661 (`wareon1112-crypto`), который ещё не слит.

## Что добавлено в этой поставке

`packages/core/src/supplier-input-extraction.ts` — чистая функция
`extractSupplierInput(parts)`:

- объединяет несколько разобранных JSON-частей (по одной на вложение);
- сохраняет исходные числа, ID и валюты без нормализации текста;
- возвращает `input` для существующего расчёта только при полном комплекте;
- возвращает перечень `gaps` с путём поля и вопросом владельцу;
- помечает `needs_answer`, когда без ответа нельзя завершить задачу;
- не выдумывает валюту, цену или сумму неизвестного расхода;
- отдельно требует второе предложение — одно предложение не является сравнением.

Ничего не вызывается автоматически, модель и сеть не используются.
API/UI/общие контракты **не изменены**: файлы #661 и #662 не затронуты.

## Стыковка с интегратором (до реализации согласована записью в PR #661)

Интегратору нужно подключить `extractSupplierInput()` в
`apps/api/src/business-work-reports.ts` вместо прямого `JSON.parse(goal)`:

- `ready === true` → existing `compareSupplierOffers(extraction.input)`;
- `ready === false` → сохранить задачу с понятным вопросом из `gaps` и не
  вызывать расчёт с неполными данными;
- после ответа владельца повторно извлечь из уточнённых частей.

Отдельно нужно agreed решение: где хранить вопрос и accepted part для
continuation — это пересекается с `manager-work-coordinator.ts` и общим
контрактом `ManagerWork`, поэтому в этой поставке не менялось.

## Проверки (по факту)

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
  --import ./scripts/context-quality-ts-resolve-hook.mjs \
  scripts/check-supplier-extraction.mjs
→ extractor checks: 4 passed, exit 0

prettier --check .                                  → 0
eslint packages/core/src/supplier-input-extraction.ts
       packages/core/test/supplier-input-extraction.test.ts → 0
tsc --noEmit -p packages/core/tsconfig.json          → 0
```

Юнит-тест `packages/core/test/supplier-input-extraction.test.ts` готов для CI
(локально vitest недоступен из-за sandbox EPERM в vite/rolldown).

## Ограничение

Это первая поставка цикла: извлечение и честные пропуски. Шаги «вопрос →
продолжение», «промежуточная ошибка», «новые указания», «пауза/отмена» требуют
изменения API и общего контракта и будут следующими PR после ответа интегратора.
