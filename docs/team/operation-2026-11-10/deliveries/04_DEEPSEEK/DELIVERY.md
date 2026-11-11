# DELIVERY — 04_DEEPSEEK, срез A: честный absent-fact + async re-check владельца

- **Статус:** готово к интеграции (дальнейшие статусы подтверждает Codex).
- **BASE_SHA:** `9d972e8ba447f681fbfb49253b73d9f02dd1d325` (совпадает с `main` на начало работ).
- **HEAD_SHA:** `5fbc40960e5b3aae2c28df3213443ced1c5c3198`.
- **Branch / PR:** `ops/deepseek-memory` → [PR #513](https://github.com/RLM-Company/Nexus-OS/pull/513) в `main`, `CLEAN / MERGEABLE / OPEN`, без merge/deploy.
- **ID отчётов:** `04_DEEPSEEK`.
- **Финальный CI** (run `42892932896`): `Verify monorepo` pass 5m5s,
  `Browser acceptance` pass 9m13s, `Code sandbox isolation` pass,
  `identity-tests` pass — все четыре проверки зелёные.
- **Завершение цели:** по указанию владельца петля остановлена после среза A.
  Срезы B (диагностика причин выбора источника) и C (панель измерений)
  **не реализованы** и не выдаются за готовые; точка продолжения сохранена в
  `CHECKPOINT.md`.

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

| Файл                                                                                                 | Изменение                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/context-memory.ts`                                                           | `answer_evidence?`, `matched_items?`, `ContextMemoryEvidence.matched?`                                    |
| `packages/core/src/context-memory.ts`                                                                | пересчёт сигнала в `fitContextMemory` / `mergeContextMemory`, аддитивно и без changes для старых фикстур  |
| `packages/core/src/context-evidence-selection.ts`                                                    | `absorb()` сохраняет `matched` при склейке повторов                                                       |
| `packages/db/src/context-memory-store.ts`                                                            | `RecallCandidate.matched`, расчёт в `resolve()`/`pack()`/`fuseSemantic()`, re-check владельца после await |
| `apps/api/src/semantic-memory/index-service.ts`                                                      | re-check `semanticScope(target, owner)` после async embed+scan                                            |
| `packages/db/test/memory-answer-evidence.test.ts`                                                    | **новый**: фиксированная панель, 9 сценариев                                                              |
| `docs/team/operation-2026-11-10/deliveries/04_DEEPSEEK/{BACKLOG,CHECKPOINT,DELIVERY,INTEGRATION}.md` | отчётная документация                                                                                     |

Общие файлы (`packages/contracts`, `packages/core`) изменены **минимально,
аддитивно**; см. `INTEGRATION.md`.

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

## Что ещё не проверено живьём

- Реальный E5 энкодер и внешний провайдер; весь absent-fact путь проверен на
  лексическом recall и фикстурном энкодере.
- Поведение UI при `answer_evidence=absent` (диагностика — срез B).
- Задержка/размер контекста на живой панели (срез C).

## Следующий шаг

Срез B: диагностика причин выбора источника в существующих настройках памяти
(grant + overlap + retrieval_rank + source_status + `matched`), дочитывание
оригинала по `reference`, без изменения компоновки. Затем срез C — единая панель
измерений baseline/после. Точка продолжения — `CHECKPOINT.md`.
