# Длинный сценарий: память и проверяемые исследования

База: PR #667 `e05d2678` (ветка `ops/deepseek-memory-research-loop`).
Изолированная рабочая копия: `.../memory-research`. Живые провайдеры, VPS,
платные вызовы и merge не использовались.

## Сценарий (один сквозной прогон)

1. **Исследование с расхождением.** Пользователь запускает Research по тарифу
   Alpha. Два источника дают разные ???????? (50 ₽ при годовой оплате, 70 ₽ при
   помесячной). Повторяющаяся публикация-зеркало не считается независимым
   подтверждением (`research-workflow.test.ts`).
2. **Квитанция.** Для принятого вывода сохраняется `kosmora.source-receipt.v1`:
   источник, дата проверки (`checked_at`), точная выдержка, digest снимка, SHA
   выдержки и позиция. Выдуманная citations `S9:E9` не проходит
   `parseResearchAnswer`, квитанции не создаёт (`research-receipts-user-run.test.ts`).
   Квитанции пишутся в `ResearchRun.receipts` в момент сохранения ответа и
   возвращаются пользовательскому запуску Research без join.
3. **Факт в памяти и смена ???????.** Факт «срок поставки 12 октября 2027»
   сохраняется в `ContextMemoryStore`. Материалы обновляются: новая дата проверки
   и digest, версия 2 («20 октября 2027»). Агент видит новую выдержку и через
   `reviseResearchQuestion()` уточняет следующий вопрос, перенося старые gaps
   как ограничения, а не как подтверждённые факты.
4. **Перезапуск.** Реальный `db.close()` + новое открытие SQLite из файла:
   следующая задача видит только версию 2; `versions()` хранит обе версии;
   старый summary не воскресает из localSnapshot.
5. **Исключение источника.** `forget(id, version 2, owner)` удаляет производную
   память, но не оригинальные сообщения; следующий `resolve()` даёт
   `answer_evidence: "absent"` и не возвращает текст исключённого источника.
6. **Итог.** Отчёт исследования включает подтверждённые выдержки, даты,
   противоречия, повторные публикации и пропуски; пользователь может открыть
   фрагмент и продолжить с ним работу.

## Проверено (фактически)

| Проверка                                                     | Результат                      |
| ------------------------------------------------------------ | ------------------------------ |
| `packages/core test/research-source-receipts.test.ts`        | 3 passed (#667)                |
| `packages/core test/research-question-revision` (часть #667) | в наборе #667                  |
| `apps/api test/research-workflow.test.ts`                    | 8 passed                       |
| `apps/api test/research-receipts-user-run.test.ts`           | 1 passed (новый)               |
| `packages/db test/memory-research-continuity.test.ts`        | 1 passed (расширен: exclusion) |
| typecheck core/db/api, lint, prettier, check-secrets         | green                          |

## Команды

```bash
pnpm --filter @cosmora/core exec vitest run --pool=threads --maxWorkers=1 test/research-source-receipts.test.ts
pnpm --filter @cosmora/api exec vitest run --pool=threads --maxWorkers=1 test/research-workflow.test.ts test/research-receipts-user-run.test.ts
pnpm --filter @cosmora/db exec vitest run --pool=threads --maxWorkers=1 test/memory-research-continuity.test.ts
```

## Формат и отзыв доступа

Согласовано в [INTEGRATION.md](INTEGRATION.md): `kosmora.source-receipt.v1`,
отзыв через `forget()` без удаления исходных сообщений, `answer_evidence: absent`
в следующей задаче.

## Границы

Изображения/видео/музыка — Gemini; Multi-Agent, квоты/тарифы, VPS, живые
провайдеры и общий UI не трогались. Референсы Ruflo и Gemini переиспользованы
как уже адаптированные механизмы (source-proof, honest truncation), без новых
внешних источников.
