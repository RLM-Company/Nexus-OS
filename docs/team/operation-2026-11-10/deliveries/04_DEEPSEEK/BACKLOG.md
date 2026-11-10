# BACKLOG — память Kosmora/Koswork (исполнитель DeepSeek Harness, ID 04_DEEPSEEK)

- **База:** `9d972e8ba447f681fbfb49253b73d9f02dd1d325` (совпадает с актуальным `main` на 10 ноября 2026).
- **Ветка:** `ops/deepseek-memory`.
- **Статус:** в работе.
- Принцип: «наличие файла, mock или отчёта не означает функцию». Ниже — только проверенные факты кода.

## Активные entrypoints (реально вызываются в продуктовом пути)

| Слой      | Entrypoint                                                                                                                                                                                                                  | Подключение                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Контракт  | `packages/contracts/src/context-memory.ts` (`ContextMemoryBundle`, `ContextMemoryEvidence`, `ContextMemoryRanker/Encoder`)                                                                                                  | импортируется storage/core/api                                                                                          |
| Хранилище | `packages/db/src/context-memory-store.ts` — `resolve()`, `resolveAsync()`, `fuseSemantic()`, `semanticSource()`, `semanticSourcePage()`, `forget()`, `versions()`, `profileCandidates()`                                    | `GeneralChatStore.contextMemory`, `ManagerWorkStore.contextMemory`                                                      |
| Индекс    | `packages/db/src/semantic-index-store.ts` (`rows/summary/progress/commit/purge`) + `apps/api/src/semantic-memory/index-service.ts` (`SemanticHistoryIndex.resolve/buildOnce/quiesce`)                                       | `server.ts:138-145` через `KOSMORA_SEMANTIC_MODEL_DIR`; `app.ts:1456-1458`                                              |
| Ранкер    | `apps/api/src/semantic-memory/local-ranker.ts` (`LocalMemoryRanker`, E5 ONNX worker `encoder-worker.mjs`, `model-manifest.mjs`)                                                                                             | `server.ts` при наличии каталога модели                                                                                 |
| Упаковка  | `packages/core/src/context-memory.ts` (`fitContextMemory`, `mergeContextMemory`, `assertContextMemoryComplete`, `CONTEXT_MEMORY_RULES`) и `context-evidence-selection.ts` (`compactContextEvidence`, `rankContextEvidence`) | `context-messages.ts`, `chat.ts`, `general-chat-store.ts`, `manager-work-coordinator.ts`, `computer-control/service.ts` |
| Сжатие    | `packages/core/src/history-compaction.ts` (`compactChatHistory`, `verifyHistoryCompaction`)                                                                                                                                 | `historyCompactionForRun`                                                                                               |
| HTTP      | `apps/api/src/context-memory-routes.ts`, `project-memory-routes.ts`, `semantic-memory-privacy.ts`                                                                                                                           | `app.ts`                                                                                                                |
| UI        | `apps/web/src/app/context-memory-settings.tsx`, `memory-usage-history.tsx`, `work-manager-memory.tsx`                                                                                                                       | существующий раздел настроек                                                                                            |

## НЕ активные (не включать по названию)

- `packages/core/src/apex/**` — 512 самодостаточных прототипов (`f103-working-memory-session-buffer`, `f104-episodic-workspace-memory`, `f109-hierarchical-semantic-chunker`, `f113-cross-workspace-memory-isolation`, `f171-semantic-salience-segment-ranker`, `f170-citation-anchoring...` и др.). Вызываются только из своего `stage*/index.ts` через `verifyF…Module()` для self-check и перечислены в `apex/catalog.ts`. В продуктовую цепочку памяти **не импортируются**.
- `scripts/bench-context-memory.mjs`, `bench-context-selection.mjs`, `bench-semantic-memory.mjs`, `measure-memory-acceptance.mjs`, `install-semantic-memory-model.mjs` — measurement/операторские скрипты, не runtime.
- `packages/core/src/project-memory/index.ts` (35 строк) — тонкий адаптер, не второе хранилище.

## Уже работает (проверено кодом и тестами базы)

- Записи с источником (`source` + `sha256`), версии (`context_memory_versions`), `source_status` (`current/changed/unavailable/manual`), `expires_at`, idempotent creation key, CAS по `expected_version`.
- `forget()` удаляет запись + версии каскадом; `forgetScope()` (влито из PR #464) забывает область; semantic index снимается триггерами и `purge(owner)`.
- Scope: `settings.enabled`, `use_personal`, `source_chat_ids`, `project_ids`; `grants()` проверяет владельца и активность чата/проекта; `owned()`/`active()`/`assertWritable` + privacy fence.
- Индекс: `rows()`/`summary()` фильтруют по `owner`, `encoder`, grants; `fuseSemantic()` перечитывает каждый original, сверяет fingerprint/version/content/source и grant; `quiesce(owner)` абортит jobs владельца и чистит индекс.
- Сжатие: `compactChatHistory` сохраняет числа/исключения/цели, `verifyHistoryCompaction` проверяет хеши источника; `compactContextEvidence` убирает только точные повторы/поглощения без нормализации чисел.
- `fitContextMemory` считает реальные UTF-8 байты, не даёт тихо выкинуть приоритетное, `mergeContextMemory` сверяет target.
- `CONTEXT_MEMORY_RULES` уже содержит absent-fact правило (влито PR #482): «Если ни один источник не отвечает прямо на текущий вопрос, скажи прямо, что таких данных нет».
- Usage-квитанции (`context_memory_usage`) и privacy export/delete через `AccountCorePrivacyAdapter`.

## Сломано / отсутствует (приоритет)

1. **[P0, изоляция/ложный recall] Нет явного сигнала «ответа нет» в bundle.**
   `resolve()` всегда добавляет «стабильные» записи (pinned/constraint/preference/personal) независимо от `overlap`. При вопросе без ответа bundle непустой, модель видит тематически далёкие факты. Правило в `CONTEXT_MEMORY_RULES` есть, но сам retrieval не помечает «релевантных источников 0», поэтому честный отказ зависит только от внимания модели. Требуется машинный признак в контракте + расчёт в `resolve`/`fuseSemantic` + тесты absent-fact.
2. **[P0, изоляция] Async-смена владельца не перепроверяется после `await`.**
   `resolveAsync` и `SemanticHistoryIndex.resolve` снимают `settings/grants` до `await ranker.rank(...)`/`await encoder.embed(...)`; после await проверяется только `settings.version`, не факт что целевой чат/проект всё ещё принадлежит `owner` и что владелец не попал под privacy fence. `tracked()` абортит jobs при `quiesce(owner)`, но нет проверки «owner ещё активен» в точке слияния. Требуется re-check `active(owner)` + `owned(target, owner)` после await, до выдачи схемы.
3. **[P1] Не раскрыта причина выбора источника.** В настройках есть usage/предпросмотр, но нет объяснения, почему запись попала в контекст (grant + overlap + rank + source_status). Задание требует «диагностику причин выбора источника».
4. **[P1] Непрочитанные результаты / дочитывание оригинала.** `excerpt_only` есть, но нет явного «original available at reference» в diagnose; `sourceFor` есть на сервере, но не связан с диагностикой.
5. **[P1] Фиксированная панель измерений.** Есть разрозненные bench, нет единой панели с baseline/после: recall/precision, неподтверждённые ответы, размер контекста, задержка, forget/revoke/restart, cross-owner.
6. **[P2] Экономия без сохранения полезности не измеряется.** Нет сравнения «economic bytes» vs «сохранённый нужный факт» на одном корпусе.

## Требует решения владельца (не делаю сам)

- Изменение тарифа/модели/прав, включение memory OFF, автоподнятие квот — запрещено заданием.
- Внешний вид настроек: любые новые панели/компоновка → `VISUAL_WAITLIST.md`, не реализую попутно.
- Общие `contracts`/DB registration/migrations, `app.ts`/`server.ts`, gateway, auth → отдельный integration commit + `INTEGRATION.md`, канонический контракт согласует Codex.
- Drive importer — Codex; второй OAuth/crawler не подключаю. Skills/стиль — Claude; runtime задачи — Codex.

## Порядок срезов (автономная петля)

1. **Срез A (сейчас):** P0-1 + P0-2 — машинный absent-fact сигнал и re-check владельца после await, с вертикальным путём «запрос → bundle → модель/UI», тестами и фиксированной панелью.
2. **Срез B:** диагностика причин выбора источника + дочитывание оригинала в существующих настройках.
3. **Срез C:** единая панель измерений baseline/после с ограничениями.

Каждый срез = свой commit + обновление DELIVERY/CHECKPOINT, без накопления сотен файлов.
