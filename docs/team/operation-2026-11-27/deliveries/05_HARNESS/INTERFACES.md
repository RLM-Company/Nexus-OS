# INTERFACES — Harness 2 (память, Skills, бизнес-процедуры)

База: main `3af92583ccc8ceb49f44c0b8633955f40feaf59f`. Ветка:
`feature/ds2-memory-skills-business-20261127`. Документ фиксирует реальные
интерфейсы первого полезного среза, до изменения кода.

## Входные сущности

- `ContextMemoryBundle` (`packages/contracts/src/context-memory.ts`): `target`
  (`kind: chat|project`, `id`), `items: ContextMemoryEvidence[]`, `omitted`,
  `priority_omitted`, `bytes`, `budget_bytes`, `retrieval: lexical|hybrid`,
  `answer_evidence`, `matched_items`, optional `semantic_retrieval`.
- `ContextMemoryEvidence` (`packages/contracts/src/context-memory.ts`):
  `reference`, `kind: memory|history`, `text`, `title`, `source`,
  `memory_kind`, `version`, `excerpt_only`, `priority`, `sequence`,
  `retrieval_rank`, `matched`. Источник (`ContextMemorySource`) содержит
  `kind`, `message_id`, `chat_id`, `project_id`, `role`, `quote`, `sha256`;
  это канал provenance, не команда для модели.
- `CreateManagerWork` / `ChatSkillReference` (`packages/contracts/src/chat-skills.ts`):
  выбор навыка — `{skill_id, version}`; до 3 навыков, приоритет
  `task > chat > project > owner`.
- `SkillResultEvaluationSchema` (`packages/contracts/src/chat-skills.ts`):
  вход `{source, answer, required_facts, forbidden, format}`; выход
  `SkillResultReport` с критериями `format`, `facts_preserved`,
  `constraints_followed` и явным `not_checked: [truth, intelligence, benchmark_gain]`.

## Выходы и события

- `fitContextMemory(bundle, availableBytes, query?)` (`packages/core/src/context-memory.ts`)
  возвращает уложенный bundle или `undefined`; при нехватке места для
  обязательной записи бросает `MemoryContextIncompleteError`.
- `mergeContextMemory(...bundles)` (`packages/core/src/context-memory.ts`)
  соединяет bundle одного target, сохраняя hybrid retrieval, matched_items и
  budget.
- `compactContextEvidence(items)` и `rankContextEvidence(items, query?)`
  (`packages/core/src/context-evidence-selection.ts`) — дедупликация и ранг;
  `selectContextScope(items, {owner, query?, isDeleted?})` добавляет owner-scope,
  удаление и приоритет актуальной ревизии, но **пока не подключён**
  к production-пути (только core-тесты).
- `ContextMemoryStore.resolve/resolveAsync` (`packages/db/src/context-memory-store.ts`)
  — реальный серверный recall; uid источника, scope, expiration и приоритеты
  уже проверяются на сервере.
- `GET/POST /api/v1/.../memory/...` (`apps/api/src/context-memory-routes.ts`)
  и `apps/web/src/app/context-memory-settings.tsx` — существующий UI
  управления памятью.
- `chat-skill-routes.ts`, `owner-skill-routes.ts`, `work-skill-routes.ts`
  (`apps/api/src`) — выбор навыка, владельческий пакет и применение к Work.

## Принадлежность данных

- Личная память: `scope=personal`, `owner_id` в store; проектная:
  `scope=project` + `project_id`; чатная: `scope=chat` + `chat_id`;
  team/agent scopes не создаются в этой зоне — их доступ идёт через
  Harness 3 (shared) и Harness 1 (agent scopes) через согласованные адаптеры.
- Чужой проект и другой аккаунт не получают личный контекст: owner filtering
  и `owned(target, owner)` уже является серверным контрактом.
- Исключённые/удалённые источники не должны возвращаться через summary/cache;
  это свойство нужно проверить после подключения отбора.

## Внешние зависимости (на момент инвентаризации)

- Три черновика Skills: `owner_correction` draft (`accepted:false`),
  `project correction rules` и owner skill package — превратить в запускаемые
  версии, не создавая новый store.
- BIZ-013 (`supplier-offer-comparison.ts`) и BIZ-040 (`biz040-field-register.ts`)
  уже реализованы и **не являются новой разработкой**; в 12 сценариях mereka
  засчитываются как проверенные повторно.
- Настоящего live-провайдера и внешних сервисов в этом срезе не вызываем;
  все новые сценарии идут через существующий production API/UI с фикстурными
  входами, а где требуется — через заменяемый интерфейс среды.

## Какие интерфейсы будут добавлены

1. Scope-aware `selectContextScope` в реальном recall path, с квитанцией
   использованных источников (`reference`, `version`, `matched`).
2. specialization setup API/UI и versioned skill activation/rollback на
   существующих `OwnerSkillStore`/`ChatSkillStore`/`ProjectCorrectionRuleStore`.
   3.packed сценарный runner для 12 BIZ-задач с artifacts и проверкой
   `SkillResultReport`; не новый параллельный стенд — вызов существующих core functions
   и API.
