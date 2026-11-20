# Интеграция: вертикаль чата и проектов (команда `team/chat-projects-delivery`)

Передача Codex по зоне, названной владельцем 20 ноября 2026: обычный веб-чат,
композер, проекты, профиль, диктовка и пользовательское поведение Turbo.
Локальное хранилище Windows ведёт Claude, исполнение DAG — DeepSeek; эти зоны
не менялись. Полная карта — `docs/handoff/TEAM_CHAT_PROJECTS_DELIVERY_2026-11-20_RU.md`.

**Ветка:** `team/chat-projects-delivery`, база `main` `815b8f95`. Коммиты:
`51ce52a9` (проход 1), `8dd5e16e` (2), `40657321` (3), `07069556` (4, timing в gateway).
PR будет открыт отдельно; merge за Codex/владельцем.

## Что сделано

- Проход 1 (цикл сообщения) — подтверждён сценарий, код не менялся. Карта покрытия:
  потерянный ответ и повтор с вложением (`chat-reliability.spec.ts:372-436`), два
  независимых retry (`:438-501`), один POST при reload/потере сети (`:613-644`),
  late stream и смена чата (`:646-677`), стоп/возврат в редактор (`:711-734`),
  база черновиков #599. Три гипотетических разрыва опровергнуты чтением кода.
- Проход 2 (проекты) — карта покрытия. Двухсторонний перенос чата
  (`chat-item-menu.tsx:151-170` → `PATCH /chats/:id`), история/вложения, изоляция
  черновиков двух проектов (#599), источники и границы общей памяти
  (`project-chat-context.test.ts:31-111`, `project-folder-scenario.test.ts:140-174`).
- Проход 3 (профиль и диктовка) — карта покрытия. Имя/род/приветствие
  (`account-store.ts`, `owner-identity.ts`, `profile-chat-path.test.ts:76-215`),
  диктовка с явным разрешением, dedup, onerror/onend, стоп (`voice-composer.tsx`),
  Studio-входы в меню «+» (`chat-attachments.tsx:179-197`). Гонка с уходящим
  черновиком опровернута guards в onresult/onerror/onend + remount cleanup.
- Проход 4 (Turbo) — **изменение кода**: gateway теперь заполняет
  `timing.first_token_ms` / `total_ms` в `response.completed`
  (`packages/model-gateway/src/gateway.ts`, `types.ts`), с детерминированным
  юнит-тестом (`test/gateway.test.ts`). Timing опциональный в типе — старые
  создатели событий остаются валидными.

## Чего НЕ трогали

Сайдбар, стартовый экран чата, логотип, стили (UI_RULES/AGENTS), зоны Claude
(Windows draft-store) и DeepSeek (DAG). Новых прав, OAuth, MCP, платных вызовов
и выкладки нет. `status.json` не менялся; живая приёмка этапа 1 не выполнялась
и не объявлена завершённой.

## Подтверждённые проверки (fixture, без ключей)

| Проверка                                                                              | Результат                          |
| ------------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/model-gateway`: vitest (11 файлов)                                          | 153 passed                         |
| `packages/model-gateway`: eslint / tsc / prettier                                     | exit 0                             |
| `apps/api`: consumer-тесты (relay/accounting/research)                                | 21 passed                          |
| `apps/api`: typecheck                                                                 | exit 0                             |
| Веб-юниты зоны (`chat-send-retry`, `composer-draft-storage`, `recoverable-run-draft`) | 32 passed                          |
| API `general-chat-api` + background coordinator                                       | 25 passed                          |
| Post-merge CI базы `815b8f95`                                                         | success                            |
| PR #599 (база черновиков)                                                             | Browser acceptance + smoke зелёные |

E2E локально не запускались: `playwright.config.ts` использует `pnpm` в `webServer`,
которого нет в PATH этой Windows-среды; пробел закрыт зелёным CI.

## Проверка для Codex

```bash
# CI/среда с pnpm:
pnpm --filter @cosmora/model-gateway test
pnpm --filter @cosmora/model-gateway lint
pnpm --filter @cosmora/model-gateway typecheck
pnpm --filter @cosmora/api exec vitest run test/relay-execution.test.ts test/relay-main-accounting.test.ts test/research-synthesis.test.ts
pnpm --dir apps/web exec vitest run src/app/chat-send-retry.test.ts src/app/composer-draft-storage.test.ts src/app/recoverable-run-draft.test.ts
pnpm --dir apps/api exec vitest run test/general-chat-api.test.ts test/general-chat-background-run-coordinator.test.ts
# Browser acceptance (e2e чата/проектов/профиля/диктовки) — CI job; локально нет pnpm.
```

Ожидаемо: timing в completion-событии gateway (`first_token_ms <= total_ms`),
никаких новых обязательных полей в контракте, старые event-билдеры компилируются.

## Риски и открытые вопросы для Codex/владельца

1. **Проход 5 не выполнен**: повтор вертикали на релизном кандидате требует
   доступа к выкладке — отдельное поручение. VPS/деплой отложены по AGENTS.md.
2. **Grok**: провайдер и «набор Grok» в репозитории отсутствуют; живые замеры
   TTFT/полной задержки и качества на одинаковом входе требует ключей/платного
   разрешения и определения набора. Timing теперь подключён, но живые числа не сняты.
3. **Непокрытые сценарии (покрытие, не дефекты)**: нет web e2e на двухсторонний
   перенос через меню и на «logout → login → черновики/профиль»; нет unit/e2e на
   отказ микрофона и диктовку в project-черновик; Studio «изображения/видео» в меню
   не покрыты e2e.
4. **Инструментарий**: локальный e2e блокирован отсутствием pnpm; все браузерные
   выводы — из CI.

## Следующий шаг

По команде владельца: повтор прохода 5 на релизном кандидате (нужны доступ/версия),
либо живые замеры Turbo/Grok (нужны ключ, провайдер, набор, разрешение на платные
вызовы), либо название следующего раздела этапа 3.
