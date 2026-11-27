# DELIVERY — память в новых задачах и проверяемость исследования

- **Ветка:** `ops/deepseek-memory-research-loop` от main `e6736e0`.
- **Изолированная копия:** `memory-research-loop`.
- **Статус:** готово к интеграции; merge/deploy не делал.

## Петля по сценариям

1. **Квитанция источника (срез 1).** `researchSourceReceipts()` в
   `packages/core/src/research/index.ts` связывает каждое утверждение с точной
   выдержкой, датой проверки, URL, заголовком, digest снимка, SHA выдержки и
   позицией. Формат `kosmora.source-receipt.v1` предложен OpenCode №1 в
   `INTEGRATION.md`. Непрочитанный источник или неизвестный `S:E` не даёт
   квитанцию — выдуманного подтверждения нет.
2. **Длинный сценарий (срез 2).** `packages/db/test/memory-research-continuity.test.ts`:
   исследовательский факт с квитанцией → обновление материала (новая дата/digest,
   версия 2) → реальный reopen SQLite → следующая задача через `resolve()` видит
   **только** актуальное значение; старый текст не воскресает из snapshot,
   `versions()` сохраняет обе версии.
3. **Смена направления (срез 3).** `reviseResearchQuestion()` добавляет к следующему
   вопросу проверенную дату, `source_id` и новое противоречие;прежние gaps переносятся
   как ограничения, а не как подтверждённые факты.

## Entrypoint / пользовательский путь

```
исследование → researchEvidence()/parseResearchAnswer() → квитанции →
факт в ContextMemoryStore (версия + inexpensive source receipt) →
обновление материала → update(expected_version) → reopen SQLite →
resolve(target, owner, query) в следующей задаче → reviseResearchQuestion() при новом факте
```

## Пример (фикстура)

`docs/team/operation-2026-11-25/memory-research/source-receipt-example.json` —
реальный вывод чистых функций: спорная выдержка «12 октября 2027 / 12 недель»,
даты и digest, квитанция для утверждения и уточнённый вопрос.

## Проверки (фактические)

```
packages/core test/research-source-receipts.test.ts   3 passed
packages/db   test/memory-research-continuity.test.ts 1 passed
typecheck/lint core+db · prettier · check-secrets — green
```

## Границы

Фикстурные проверки; живой провайдер/VPS/owner-данные не использовались. Квоты,
тарифы, Multi-Agent, общий UI и VPS не тронуты. Общие контракты не менялись;
формат квитанций передан OpenCode №1 через INTEGRATION.md.
