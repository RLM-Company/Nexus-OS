# INTEGRATION — 04_DEEPSEEK, срез A

Канонический контракт согласует Codex. Ниже — все изменения общих файлов,
сделанные в этой ветке. Они аддитивные и минимальные; перечислены для явной
интеграции.

## packages/contracts/src/context-memory.ts (общий контракт)

- `ContextMemoryBundle`: добавлены **опциональные** `answer_evidence?: "matched" | "absent"`
  и `matched_items?: number`.
- `ContextMemoryEvidence`: добавлено **опциональное** `matched?: boolean`.

Опциональность выбрана намеренно: существующие фикстуры и сторонние сборщики
bundle не ломаются, точный байтовый учёт `fitContextMemory` для них сохраняется.
Активный `ContextMemoryStore` заполняет поля всегда.

## packages/core/src/context-memory.ts (общий packing)

- `fitContextMemory`: пересчитывает `matched_items`/`answer_evidence` по фактически
  отобранным items; добавляет их в результат **только если** они были во входном
  bundle. `CONTEXT_MEMORY_RULES` не изменялся по длине (правило absent-fact уже
  было влито PR #482), чтобы не съедать точный бюджет `context-messages.ts`.
- `mergeContextMemory`: суммирует `matched_items` и выставляет сигнал, только
  если его передал хотя бы один из сливаемых bundle.

## packages/core/src/context-evidence-selection.ts (общий evidence)

- `absorb()` сохраняет `matched: true` при склейке повторов/поглощении, чтобы
  честный сигнал не терялся при дедупликации.

## apps/api/src/semantic-memory/index-service.ts (общий runtime индекса)

- После async `embed` + сканирования индекса добавлен `a.semanticScope(target, owner)`
  (внутри — `owned()`), fail closed при смене владельца/fence.

## apps/web (срез B, клиентская часть)

- `apps/web/src/app/memory-selection-reason.ts` — новый чистый модуль.
- `apps/web/src/app/context-memory-settings.tsx` — только функциональные строки
  в существующем `<section aria-label="Подобранный контекст">`: статус
  `answer_evidence` и причина выбора. Компоновка, палитра, типографика, CSS,
  сайдбар и чат **не менялись**; `VISUAL_WAITLIST.md` не требуется.
- `apps/web/src/app/memory-selection-reason.test.ts` — тест хелпера.

## Внесферная техническая правка (отдельный commit)

- `docs/research/experience-llm-distill-2026-11-10.json` — **только** форматирование
  Prettier. Файл пришёл из `main` (`d047ce1`) и сам `main` падал на
  `Verify monorepo` (run `42978824424`) из-за `format:check`. Проверено: JSON
  до и после семантически идентичен, содержимое не менялось. Это минимальный
  адаптер для зелёного gate, не правка чужого исследования. При желании Codex
  может заменить эту правку своей.

## scripts (срез C, measurement-only)

- `scripts/measure-memory-panel.mjs` — не подключён в runtime, запускается
  вручную; требует собранного `@cosmora/db` (`dist`). Внешний провайдер не
  вызывается. Это измеритель, а не новый memory store.

## Чего НЕ трогали

`app.ts`, `server.ts`, DB registration/migrations, gateway, auth, work-cycle,
computer-session, общая навигация, UI-компоновка, Drive importer, Skills/стиль,
runtime задач. Миграций и новых зависимостей нет.

## Проверка для Codex

```
pnpm --filter @cosmora/contracts --filter @cosmora/core --filter @cosmora/db --filter @cosmora/api typecheck
pnpm --filter @cosmora/contracts --filter @cosmora/core --filter @cosmora/db --filter @cosmora/api lint
cd packages/db && pnpm exec vitest run test/memory-answer-evidence.test.ts
cd apps/api && pnpm exec vitest run --maxWorkers=2
```

Все зелёное на HEAD среза A (см. DELIVERY.md).
