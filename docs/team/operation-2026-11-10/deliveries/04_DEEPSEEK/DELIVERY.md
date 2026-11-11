# DELIVERY — 04_DEEPSEEK, срез A: честный absent-fact + async re-check владельца

- **Статус:** готово к интеграции (дальнейшие статусы подтверждает Codex).
- **BASE_SHA:** `9d972e8ba447f681fbfb49253b73d9f02dd1d325` (совпадает с `main` на начало работ).
- **HEAD_SHA:** `5fbc40960e5b3aae2c28df3213443ced1c5c3198`.
- **Branch / PR:** `ops/deepseek-memory` → [PR #513](https://github.com/RLM-Company/Nexus-OS/pull/513) (срез A) **смержен Codex** 11 ноября, `mergedAt 2026-11-11T06:57:22Z`, merge commit `ec24ce4`. Срезы B/C идут отдельным PR (см. CHECKPOINT), без самостоятельного merge/deploy.
- **ID отчётов:** `04_DEEPSEEK`.
- **Синхронизация:** перед B/C влит `main` `d423d64` (46 коммитов), после
  обнаружения мерджа #513 влит `main` `d047ce1` ещё раз. Итоговый diff ветки
  против `main` содержит **только срезы B/C** — дублирования кода среза A нет.
- **Финальный CI среза A** (run `42892932896`): `Verify monorepo` pass 5m5s,
  `Browser acceptance` pass 9m13s, `Code sandbox isolation` pass,
  `identity-tests` pass — все четыре проверки зелёные.
- **Завершение:** срезы A, B и C выполнены; петля по памяти закрыта.
  `memory-panel.json` содержит фактические измерения с ограничениями.
- **HEAD_SHA (код):** см. `git log -1` ветки и `CHECKPOINT.md`.

## Сценарий до / после

**До.** `ContextMemoryStore.resolve()` всегда добавлял в bundle «стабильные»
записи (pinned / constraint / preference / personal) независимо от совпадения
с запросом. На вопрос, на который нет подтверждённого ответа, bundle был
непустым; `CONTEXT_MEMORY_RULES` содержал текстовое правило «скажи, что данных
нет», но **не было машинного признака**, что релевантных источников ноль.
Честный отказ зависел только от внимания модели. Дополнительно `resolveAsync` /
`SemanticHistoryIndex.resolve` снимали `settings`/`grants` до `await` энкодера
и после await проверяли только `settings.version` — не факт, что владелец не
попал под privacy fence и цель ещё принадлежит ему.

**После.** В контракт добавлены `answer_evidence: "matched" | "absent"` и
`matched_items` (опциональные для старых фикстур, активный store заполняет
всегда), а в `ContextMemoryEvidence` — `matched?`. `resolve()`/`fuseSemantic()`
/`pack()` считают реальные совпадения (лексический overlap или прошедший gate
0.72 + полную revalidation семантический хит) и выставляют сигнал по **фактически
попавшим в bundle** записям, а не по всем кандидатам. Обязательные ограничения
остаются в контексте, но помечаются как «не ответ». `fitContextMemory` и
`mergeContextMemory` пересчитывают сигнал после укладки/слияния и сохраняют
точную форму JSON для старых фикстур (поля добавляются только когда их передал
вызывающий) — байтовые packing-тесты не сломаны.

Async-путь: после `await ranker.rank(...)` и `await encoder.embed(...)` + индексного
сканирования добавлен re-check `active(owner)` и `owned(target, owner, true)`;
`fuseSemantic()` также перепроверяет их в начале. При privacy fence / смене
владельца / удалении цели запрос fail closed, а не отдаёт pre-await пул.

## Entrypoint (реальный пользовательский путь)

```
POST /api/v1/chats/:id/messages → GeneralChatStore.recallForRunAsync()
  → ContextMemoryStore.resolveAsync() → resolve() / SemanticHistoryIndex.resolve()
  → fuseSemantic() → pack() → ContextMemoryBundle (новые поля)
  → mergeContextMemory() / fitContextMemory() (сохраняют сигнал)
  → ChatService.buildRequest() → JSON bundle в user-сообщении модели
  → ContextMemorySettings / usage receipts (диагностика, срез B)
```

Прототипы `packages/core/src/apex/**`, bench-скрипты и measurement-only модели
**не подключались** — они не импортируются в продуктовую цепочку (проверено).

## Изменённые файлы

| Файл                                                                                                 | Изменение                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/context-memory.ts`                                                           | `answer_evidence?`, `matched_items?`, `ContextMemoryEvidence.matched?`                                     |
| `packages/core/src/context-memory.ts`                                                                | пересчёт сигнала в `fitContextMemory` / `mergeContextMemory`, аддитивно и без изменений для старых фикстур |
| `packages/core/src/context-evidence-selection.ts`                                                    | `absorb()` сохраняет `matched` при склейке повторов                                                        |
| `packages/db/src/context-memory-store.ts`                                                            | `RecallCandidate.matched`, расчёт в `resolve()`/`pack()`/`fuseSemantic()`, re-check владельца после await  |
| `apps/api/src/semantic-memory/index-service.ts`                                                      | re-check `semanticScope(target, owner)` после async embed+scan                                             |
| `packages/db/test/memory-answer-evidence.test.ts`                                                    | **новый**: фиксированная панель, 11 сценариев (9 срез A + 2 срез B)                                        |
| `apps/web/src/app/memory-selection-reason.ts`                                                        | **новый**: чистый хелпер причины выбора источника                                                          |
| `apps/web/src/app/memory-selection-reason.test.ts`                                                   | **новый**: 4 теста диагностики                                                                             |
| `apps/web/src/app/context-memory-settings.tsx`                                                       | статус `answer_evidence` и строка причины в существующем предпросмотре                                     |
| `scripts/measure-memory-panel.mjs`                                                                   | **новый**: панель измерений baseline/после                                                                 |
| `docs/team/operation-2026-11-10/deliveries/04_DEEPSEEK/{BACKLOG,CHECKPOINT,DELIVERY,INTEGRATION}.md` | отчётная документация                                                                                      |
| `docs/team/operation-2026-11-10/deliveries/04_DEEPSEEK/memory-panel.json`                            | фактические измерения панели                                                                               |

Общие файлы (`packages/contracts`, `packages/core`) изменены **минимально,
аддитивно**; см. `INTEGRATION.md`. `apps/web` изменён только в клиентском
компоненте настроек, без компоновки/дизайна.

## Команды и фактические результаты

```
packages/db  test/memory-answer-evidence.test.ts        9 passed (панель: matched,
             absent, disabled, contradiction, forget, revoke, cross-owner,
             async owner fence ×2)
packages/db  полный, --maxWorkers=2                    203 passed (37 файлов)
apps/api     полный, --maxWorkers=2                    985 passed (102 файла)
packages/core контекст/упаковка/сжатие/usage            50 passed (6 файлов)
typecheck contracts, core, db, api                      Done
lint      contracts, core, db, api                      Done
prettier --check .                                      passed
check:secrets                                           passed
build @cosmora/api...                                   Done
```

Важно: при первом прогоне core-набор дал 9 падений — новые поля увеличивали
сериализованный bundle на ~45 байт и удлиняли `CONTEXT_MEMORY_RULES`, что съедало
точный бюджет в `context-messages.ts`. Причина устранена **содержательно**:
поля добавляются только при наличии у вызывающего, правила оставлены прежней
длины (машинный сигнал виден модели прямо в JSON bundle). Повторный прогон —
50/50. Это не «перезапуск до зелёного».

## Миграции / зависимости

Миграций нет, схема БД не менялась. Новых зависимостей нет. Внешний провайдер и
E5-модель **не вызывались**: все тесты на in-memory SQLite и mock/фикстурном
энкодере. Live-статус семантического качества не проверялся.

## Полномочия и границы

- Не менялись тарифы, квоты, провайдер HY4, модель прав, keys, auth, gateway.
- Memory OFF не включается; `settings.enabled=false` по-прежнему даёт пустой
  bundle с `answer_evidence=absent`.
- Не расширялись права ПК/доменов/папок/аккаунтов; grants и privacy fence
  сохранены и усилены re-check.
- Chat/sidebar/logo/global CSS не трогались; VISUAL_WAITLIST не потребовался.
- Multi-Agent, Jarvis, облачный ПК, обучение весов, merge, VPS, production —
  не выполнялись.
- Реальные данные владельца, .env, токены, БД пользователей не читались.

## Несовместимости / ограничения

- Поля контракта опциональные: старые клиенты, не знающие о них, работают; но
  только активный store выставляет корректный сигнал. Сторонний код, собирающий
  `ContextMemoryBundle` вручную, получит `undefined` — это осознанно.
- `answer_evidence=matched` означает «есть совпавший источник», **не**
  «факт подтверждён владельцем». Подтверждение по-прежнему регулируется
  `source`, `version`, `source_status` и `CONTEXT_MEMORY_RULES`.
- Семантический gate 0.72 и revalidation оставлены без изменений; качество
  paraphrase-recall на живой модели не измерялось.
- Живая приёмка, восстановление VPS и Windows-клиент остаются отложенными
  согласно `AGENTS.md`.

## Срез B — диагностика причин выбора источника

**Пользовательский путь:** настройки памяти → предпросмотр «Подобранный
контекст» → владелец видит `answer_evidence`, число совпадений и под каждой
выдержкой строку «Почему в контексте» → кнопка «Открыть исходное сообщение»
уже существующего `sourceFor()` дочитывает оригинал по `reference`.

- `apps/web/src/app/memory-selection-reason.ts` — **новый** чистый хелпер:
  объясняет причину только реальными полями (`matched`, `priority`/`constraint`,
  `retrieval_rank`, `source.role`, `source.quote`, `excerpt_only`). Не выдумывает
  оценку, уверенность, разрешение или процент.
- `apps/web/src/app/context-memory-settings.tsx` — в существующем разделе
  предпросмотра добавлены статус `answer_evidence` (с честным текстом при
  `absent`: «показанные записи — обязательные ограничения, не ответ») и строка
  причины под каждым item. Нового экрана, панели, компоновки или CSS нет →
  `VISUAL_WAITLIST.md` не требуется.
- `apps/web/src/app/memory-selection-reason.test.ts` — **новый** 4 теста.
- `packages/db/test/memory-answer-evidence.test.ts` — +2 сценария:
  дочитывание оригинала по `reference` после recall; отзыв grant убирает
  причину (`sourceFor` → `MEMORY_SOURCE_NOT_FOUND`). Панель стала 11/11.

Прочитаны bundled Next docs (`apps/web/node_modules/next/dist/docs/.../05-server-and-client-components.md`),
как требует локальный `AGENTS.md`: компонент уже `"use client"`, изменения
только в клиентской разметке.

## Срез C — единая панель измерений baseline / после

- `scripts/measure-memory-panel.mjs` — **новый** воспроизводимый скрипт на
  фиксированном корпусе (5 кейсов: matched ×2, absent ×2 после revoke,
  forget с сохранением канонической истории). Реальный `ContextMemoryStore`
  на in-memory SQLite, лексический recall, без провайдера и E5.
- `memory-panel.json` — фактический результат. Ключевые числа:
  `baseline_correct 4/5 → current_correct 5/5`,
  `baseline_false_answers_on_absent 1 → current 0`,
  `expected_facts_present 3/3`, `forbidden_facts_leaked 0`,
  `forgotten_entries_resurrected 0`,
  `mean_bundle_bytes 1221.6`, `mean_retrieval_ms 0.922`.
- **Честное ограничение:** `baseline` — реконструкция поведения до среза A
  («любой непустой bundle считался ответом, т.к. сигнала не было»), **не**
  запуск старого бинарника. Сравнение измеряет эффект сигнала на риск ложного
  ответа, а не качество модели. Проценты экономии не заявляются.
- При первой сборке панели два assert упали: оказалось, что панель ошибочно
  требовала `absent` после forget (хотя каноническое сообщение с кодом осталось
  — это честный `matched`) и запрещала старую сумму в истории (которая
  намеренно сохраняется как отдельный атрибутированный источник). Формулировка
  кейсов исправлена по фактической семантике, а не «перезапуском до зелёного».

## Итоговые проверки срезов B/C

```
apps/web    полный vitest                294 passed (56 файлов)
packages/db полный, --maxWorkers=2      216 passed (37 файлов)
apps/api    полный, --maxWorkers=2      993 passed (102 файла)
typecheck contracts/core/db/api/web     Done
lint      contracts/core/db/api/web     Done
prettier --check . / check:secrets      passed
build @cosmora/web                       Done
scripts/measure-memory-panel.mjs         exit 0, JSON сохранён
```

## Что ещё не проверено живьём

- Реальный E5 энкодер и внешний провайдер; весь absent-fact путь проверен на
  лексическом recall и фикстурном энкодере.
- Задержка/размер контекста измерены на фикстурной панели, не на живой модели.
- Живая приёмка, восстановление VPS и Windows-клиент остаются отложенными
  согласно `AGENTS.md`.

## Следующий шаг

Все три среза сферы памяти выполнены. Дальнейшее — живая приёмка и выпуск,
которые подтверждает Codex; статус не выше «готово к интеграции».
`CHECKPOINT.md` содержит финальную точку.
