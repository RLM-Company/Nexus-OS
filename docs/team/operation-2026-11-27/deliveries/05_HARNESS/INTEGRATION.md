# INTEGRATION — Harness 2 локальный acceptance harness

Ветка: `feature/ds2-memory-skills-business-20261127`.
HEAD на момент проверки: `185e26482ab8f3e3f5c5e2c962cc1b144aaf17a1`.

## Уже добавленные строки в `apps/api/src/app.ts` (НЕ трогались в этой задаче)

Фактическое состояние файла на ветке — ровно две строки wiring для бизнес-сценариев:

```ts
import { registerBusinessScenarioRoutes } from "./business-scenario-routes.js"; // Harness 2 wiring (2 lines)
```

```ts
registerBusinessScenarioRoutes({ app, identityFor }); // Harness 2 wiring (line 2 of 2)
```

Они уже присутствуют в ветке

## Endpoint'ы `owner-skill-routes.ts` (уже существуют, НЕ трогались)

`registerOwnerSkillRoutes` в `apps/api/src/owner-skill-routes.ts` уже содержит
нужные для цикла Skill endpoint'ы:

- `POST /api/v1/owner-skills/specializations/compile` — инертная компиляция
  specialization в SkillDraft, ничего не сохраняет.
- `POST /api/v1/owner-skills/corrections/propose` — инертный draft из текста
  правки владельца.
- `POST /api/v1/owner-skills/corrections/accept` — единственный путь сохранения,
  использует `OwnerSkillStore.create` и идемпотентный `client_request_id`.
- `POST /api/v1/owner-skills/evaluate-result` — `evaluateSkillResult`, проверяет
  только явные критерии, честно объявляет `not_checked`.
- `GET /api/v1/owner-skills/:id`, `PUT /api/v1/owner-skills/:id`,
  `POST /api/v1/owner-skills/:id/restore`, `DELETE /api/v1/owner-skills/:id` —
  версионирование, откат и удаление на существующем store.
- `GET /api/v1/owner-skills/:id/package`, `POST /api/v1/owner-skills/import` —
  перенос инертного пакета без прав на выполнение.

Локальный harness вызывает те же реальные функции напрямую
(`compileSpecialization`, `evaluateSkillResult`, `OwnerSkillStore`,
`ChatSkillStore`), но не поднимает HTTP-сервер.

## Реальные vs фикстурные зависимости

| Компонент                                                                             | Статус            | Комментарий                              |
| ------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------- |
| `ContextMemoryStore` / in-memory SQLite                                               | real              | настоящие миграции и INSERT-фикстуры     |
| `compactChatHistory`                                                                  | real              | точные выдержки, не LLM-саммари          |
| `selectContextScope`, `fitContextMemory`, `mergeContextMemory`, `selectContextBundle` | real              | продакшн-код `packages/core`             |
| `compileSpecialization`, `evaluateSkillResult`                                        | real              | детерминированные, model-free            |
| `OwnerSkillStore`, `ChatSkillStore`                                                   | real              | версии и выбор навыка, без второго store |
| `@cosmora/contracts`                                                                  | real source       | через `scripts/ds2-resolve-hook.mjs`     |
| Провайдер /Live LLM / сеть                                                            | absent            | не вызывались, по заданию                |
| HTTP-слой (`apps/api`)                                                                | не проверен здесь | wiring уже есть, smoke-тесты отдельно    |
| Семантический ranker / embeddings                                                     | absent            | не использовался                         |
| Сообщения, решения, draft'ы                                                           | fixture           | детерминированные, создаются скриптом    |

## Ограничение интеграции

`selectContextScope` остаётся core-функцией; этот harness проверяет её поведение
нативно, но не изменяет production recall path (`INTERFACES.md` и `SCENARIOS.md`
не трогались). Любая будущая подстановка её в `ContextMemoryStore.resolve`
должна сохранить текущие проверки exclude/owner/version и честные счётчики
`answer_evidence`/`matched_items`.
