# DELIVERY — Harness 2 memory/skills acceptance harness

Ветка: `feature/ds2-memory-skills-business-20261127`.
HEAD на момент запуска: `185e26482ab8f3e3f5c5e2c962cc1b144aaf17a1`.
Ша поставки фиксируется в истории ветки; этот документ обновлён после коммита.
Коммит сделан в рабочей ветке; PR не сливается в main по правилам волны.

## Команда запуска (точно как в задании)

```powershell
cd C:\Users\Александр\Documents\deepseek-harness\default-workspace\ds2-memory-skills
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --import ./scripts/ds2-resolve-hook.mjs scripts/memory-acceptance.mjs
```

Журнал по умолчанию пишется в
`docs/team/operation-2026-11-27/deliveries/05_HARNESS/memory-acceptance.journal.json`.
Можно переопределить: `--output=<path>`.

## Фактический результат последнего прогона

```
[01] 1. Deterministic two-project, multi-chat fixture corpus
  ASSERT 17 owner messages in chat A and 5 in chat B: PASS
  ASSERT two projects and one foreign owner chat exist: PASS
  ASSERT fixture carries decisions, contradictions and a source to exclude: PASS
  OK

[02] 2. Decision accepted, changed, compacted, serialized, continued
  ASSERT compaction applied and report is honest: PASS
  ASSERT both decision versions survive compaction with provenance: PASS
  ASSERT snapshot JSON round-trip preserves versions and source hashes: PASS
  ASSERT new decision wins; old decision is not silently overriding: PASS
  ASSERT continuation via another allowed chat keeps exact facts: PASS
  OK

[03] 3. Excluded source and cross-owner/cross-project isolation
  ASSERT excluded source is present before exclusion: PASS
  ASSERT excluded source is absent after exclusion: PASS
  ASSERT foreign owner and foreign project evidence do not leak: PASS
  ASSERT selectContextScope drops foreign owner, deleted source and stale revision: PASS
  ASSERT fit/merge/selectContextBundle keep the current bundle shape: PASS
  OK

[04] 4. Skill cycle: compile, accept, evaluate, correct, disable
  ASSERT compiled draft is inert and cites non-granted rights: PASS
  ASSERT explicit accept creates a versioned skill idempotently: PASS
  ASSERT old artifact fails, corrected artifact passes explicit checks: PASS
  ASSERT correction appends version 2; version 1 remains accessible: PASS
  ASSERT disable leaves a different but correct result and old artifact readable: PASS
  OK

[05] 5. Honest boundaries
  ASSERT no provider/model/network was called: PASS
  NOT CHECKED: truth, model quality, live provider, production HTTP wiring,
    semantic retrieval quality, extra secret rules, tool permissions,
    perfect/lossless memory
  OK

ACCEPTANCE PASS — 19 assertions
```

## Что именно проверено

1. **Фикстура.** 17 сообщений чата A, 5 сообщений чата B, 2 проекта, чужой
   owner с похожим решением; есть версии решения, противоречия и источник
   для исключения.
2. **Решение.** v1 принято (`17 350 ₽`), затем обновлено до v2 (`19 700 ₽`);
   реальная компакция сохранила обе версии с source references; снимок
   `localSnapshot` прошёл JSON round-trip в свежую in-memory БД вместе со
   строками версий; продолжение в чате B вернуло v2 с нужным `message_id` и
   sha256, старое решение не вернулось как активная memory-запись.
3. **Исключение и изоляция.** Источник `99 999 ₽` присутствует до исключения и
   отсутствует после `excludeMessageIds`; чужой owner (`77 777 ₽`) и другой
   проект (`«Альфа»`) не попали в bundle; реальные core-функции отбросили
   чужого owner, удалённый источник и устаревшую ревизию.
4. **Skill.** `compileSpecialization` дал инертный draft (`accepted:false`);
   `OwnerSkillStore.create` принял его идемпотентно; `evaluateSkillResult`
   провалил старый ответ и пропустил исправленный; correction добавил версию 2,
   версия 1 осталась доступна; `ChatSkillStore` включил и отключил skill,
   результат после отключения другой, но корректный.
5. **Границы.** Ни одного вызова модели, провайдера или сети.

## Реальные зависимости

- Реальные модули: `packages/core/dist/{index,history-compaction,context-evidence-selection}.js`,
  `packages/db/dist/index.js` (собраны из исходников этой ветки), real SQLite
  миграции и `scripts/ds2-resolve-hook.mjs`.
- Реальные store: in-memory `openDatabase(":memory:")`, `ContextMemoryStore`,
  `OwnerSkillStore`, `ChatSkillStore`. Нового store нет.
- Фикстуры: только детерминированные сообщения/project-записи и draft'ы,
  созданные внутри скрипта.

## Изменённые файлы

- `scripts/memory-acceptance.mjs` (новый)
- `docs/team/operation-2026-11-27/deliveries/05_HARNESS/CHECKPOINT.md` (новый)
- `docs/team/operation-2026-11-27/deliveries/05_HARNESS/DELIVERY.md` (новый)
- `docs/team/operation-2026-11-27/deliveries/05_HARNESS/INTEGRATION.md` (новый)
- `docs/team/operation-2026-11-27/deliveries/05_HARNESS/memory-acceptance.journal.json` (артефакт, новый)

Остальные файлы не тронуты.
