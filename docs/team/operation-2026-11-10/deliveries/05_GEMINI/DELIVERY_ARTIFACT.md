# DELIVERY — 05_GEMINI, срез D: отчёт как источник материалов проекта

- **Статус:** готово к интеграции.
- **BASE_SHA:** `f7864e286c96905883cea1c9fce930a82cec5217`.
- **Ветка:** `ops/gemini-research-artifact` (новая; чужой #548 не тронут).
- **PR:** открывается в `main`, без merge/deploy. HEAD_SHA — `git log -1` ветки.
- **Переназначение:** задание именует Gemini; взято по прямому указанию владельца.

## Сценарий до / после

**До.** П.6 `05_GEMINI.md` требует «передачу результата в проект через текущий
hook». `/api/v1/research/:id/artifacts` отдавал только метаданные и
`download_url`, а текущий hook `/api/v1/projects/:id/materials/artifacts`
принимал `source.kind` лишь `canvas|table|work`. Завершённый отчёт Deep Research
**не мог стать источником материалов проекта**.

**После.** Отчёт доступен через существующий hook как `source.kind='research'`:

- `ArtifactContextKind` расширен до `canvas|table|work|research`.
- `ArtifactContext` принимает **опциональный** `ResearchStore`; без него hook
  работает как раньше (проверено тестом обратной совместимости).
- `list()` добавляет завершённые отчёты **этого проекта и владельца** как
  кандидатов: `version: 1`, `sha256` от `researchMarkdown(run)`, `bytes`,
  `title = вопрос исследования`.
- `preview()` для research берёт `store.get(id, owner)`, проверяет project/owner
  и `status === "completed"`, сверяет sha256 и версию, затем отдаёт тот же
  ограниченный текстовый снимок, что и прочие источники (полный или по строкам).
- `apps/api/src/artifact-context-routes.ts` — схема `source.kind` и передача
  store; `apps/web/src/app/project-artifact-picker.tsx` — только недостающая
  метка `research: "Исследование"`, без redesign/компоновки.
- **Отдельный маленький integration commit** (`app.ts`): передача
  `dependencies.researchStore` в `registerArtifactContextRoutes`, по требованию
  `05_GEMINI.md` про общие hooks.

## Безопасность / изоляция

`ResearchStore.get(id, owner)` уже фильтрует по владельцу; дополнительно
проверяются `project_id` и статус. Чужой владелец и другой проект получают
404/пустой список; устаревшие sha256/версия — 409; незавершённый run — 404.
Отчёт остаётся **недоверенными данными** (заголовок снимка это сохраняет),
никаких прав, инструментов или grants не расширяется.

## Entrypoint

```
POST/GET /api/v1/research/... → ResearchRun (completed)
  → GET /api/v1/projects/:id/materials/artifacts → candidate kind='research'
  → POST .../artifacts/preview → bounded ChatTextAttachment
  → существующий сценарий прикрепления к чату/проекту
```

## Изменённые файлы

| Файл                                                                                                                  | Изменение                                  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `packages/contracts/src/artifact-context.ts`                                                                          | `ArtifactContextKind` + `research`         |
| `apps/api/src/artifact-context.ts`                                                                                    | опциональный `ResearchStore`, list/preview |
| `apps/api/src/artifact-context-routes.ts`                                                                             | схема kind + передача store                |
| `apps/api/test/artifact-context-research.test.ts`                                                                     | **новый** 5 тестов                         |
| `apps/web/src/app/project-artifact-picker.tsx`                                                                        | одна метка, без дизайна                    |
| `apps/api/src/app.ts`                                                                                                 | **отдельный integration commit**           |
| `docs/team/.../deliveries/05_GEMINI/{BACKLOG_ARTIFACT,CHECKPOINT_ARTIFACT,DELIVERY_ARTIFACT,INTEGRATION_ARTIFACT}.md` | отчёты                                     |

## Команды и фактические результаты

```
apps/api 4 файла                       27 passed
  artifact-context.test.ts (существующий, обратная совместимость)
  artifact-context-research.test.ts   5 passed
  research-workflow / report-export   10 passed (в т.ч. restart)
typecheck/lint contracts/core/api/web · prettier --check . · check:secrets — green
```

Одно падение по ходу исправлено содержательно: `ResearchStore` импортировался
из `@cosmora/db`, хотя он живёт в `apps/api/src/research/`; `afterEach` сделан
устойчивым к неудачному `beforeEach`. Продуктовый код не менялся. Расширение
контракта сломало `kinds[item.kind]` в UI — добавлена только метка, не дизайн.

## Миграции / зависимости

Нет миграций, новых зависимостей и изменений схемы. Провайдер, live Chromium/CDP
и платные вызовы не выполнялись.

## Полномочия и границы

Не менялись chat/sidebar/logo/global CSS, gateway/credits, provider keys,
тарифы, OS-права, grants, Work runtime, чужие ветки (#548). Restart/cancel/
owner-project isolation/privacy lifecycle сохранены. Multi-Agent/VPS/production/
merge — не выполнялись.

## Ограничения

- Версия содержимого фиксирована как `1`, а идентичность обеспечивается sha256
  текста отчёта: изменение `updated_at`/состава источников даёт новый sha256 и
  отклоняет старую ссылку (409), а не «обновляет» её молча.
- Снимок ограничен теми же 8000 символов / 24000 байт, что и прочие источники;
  большой отчёт отдаётся по строкам, `complete=false`.
- Живая приёмка на реальном Chromium/VPS/Windows-клиенте отложена по `AGENTS.md`.

## Следующий шаг

По `05_GEMINI.md` остаётся отмена/продолжение и полноценный live/CDP цикл
(поиск → переходы → формы → чтение → отмена), а также передача через текущий
hook в живом сценарии. Требуют живой среды; без неё новый продукт не изобретаем.
