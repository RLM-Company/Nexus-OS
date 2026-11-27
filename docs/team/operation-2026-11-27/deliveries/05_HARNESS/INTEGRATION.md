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

## Подключение к обычному запросу (факт)

`selectContextBundle()` из `@cosmora/core` вызывается в
`apps/api/src/general-chat-routes.ts` и
`apps/api/src/general-chat-background-run-coordinator.ts` перед `buildRequest()`.
Она применяет `selectContextScope()` (владелец, удаление, актуальная ревизия,
несовпадающие элементы) и сохраняет честные `answer_evidence`/`matched_items`.
Это не отдельный benchmark helper.

## Узкий мост к user-owned Drive (Harness 3)

Добавлены endpoint'ы в `apps/api/src/context-memory-routes.ts`:

- `GET /api/v1/memory/drive-manifest?scope=all|personal|chat|project` — из
  `localSnapshot(owner)` собирается инертный манифест `kosmora.memory-drive-manifest.v1`
  с явным scope, версиями записей и выбором пользователя; ключи и секреты не включаются.
- `POST /api/v1/memory/drive-manifest/verify` — проверяет SHA-256 манифеста
  при возврате из Storage; изменение содержимого отклоняется кодом 409.

Это подготовка совместимого с Drive файла-переноса, а не загрузка в облако:
сама передача/restore остаётся в зоне Harness 3. Формулировка продукта честная:
наличие файла в личном Drive не означает, что данные не обрабатывает провайдер модели.

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

`selectContextBundle` подключён к production recall path, но сам `ContextMemoryStore`
остаётся владельцем owner/exclude-фильтрации; core-слой — дополнительная защита,
а не замена серверных проверок. HTTP-слой проверен отдельными API-тестами
(`business-scenario-routes.test.ts`, `memory-drive-manifest.test.ts`);
живой HTTP-прогон с реальным провайдером в этой поставке не проводился.
