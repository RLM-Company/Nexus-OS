# Fixture-API прогон пользовательского сценария (этап 3)

Выполнено по команде владельца «у нас есть подключённый API, прогоняй через него»
с уточнением: поднять **локальный fixture-API** (без платных вызовов и ключей).
Ветка `team/fixture-api-acceptance`, база `main` `24e553b3`.

## Что объективно проверено

- Переменные живой приёмки (`MODEL_API_KEY`, `MODEL_BASE_URL`, `MODEL_NAME`,
  `COSMORA_OWNER_SESSION_TOKEN`, `COSMORA_API_ORIGIN`, `COSMORA_ACCEPTANCE_DIR`)
  и `.env` — ABSENT; `GET /api/v1/health` на 3100/3000/8080 — недоступен.
- Прямой запуск `apps/api/test/fixtures/e2e-server.ts` через `node --import tsx`
  заблокирован ESM-resolve workspace `.js`→`.ts` (та же причина, что и локальный
  Chromium). Поэтому «подключённый API» поднят **внутри vitest** — так же, как
  в CI: `buildApp()` + реальные роуты + `MockProviderAdapter` + SQLite `:memory:`.
  Это тот же API-код, без сети и платных вызовов.

## Результаты прогона

| Команда                                                                                                                | Результат                  |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `vitest run test/studio-fixture-deep-analysis.test.ts test/document-answer-http.test.ts test/general-chat-api.test.ts` | 3 файла / **15 тестов** ✅ |
| `vitest run test/document-answer-http.test.ts`                                                                         | **3 теста** ✅             |
| `apps/api` eslint / tsc / Prettier                                                                                     | exit 0                     |

Добавлен сквозной fixture-тест (в `document-answer-http.test.ts`), который
проходит через **реальный HTTP-слой API** (`app.inject`):

`INCOMPLETE_COVERAGE` → run `failed` (coverage 0/1 сохранён) →
`POST /answers/:id/retry` → 202, новый run → `done` с coverage
`phase:complete`, `analyzed_chunks:1` → отчёт содержит цитату
`contract.txt, строки 1–1` → исходный run сохраняет `error_code=INCOMPLETE_COVERAGE`.

Плюс покрыто: реальный deep-анализатор на synthetic Studio package
(`studio-fixture-deep-analysis.test.ts`) и полный цикл general-chat
(`general-chat-api.test.ts`).

## Что НЕ сделано (честно)

- Это **fixture-прогон, не живая приёмка**. `status.json` не менялся:
  `live_model_accepted:false`, `live_release_accepted:false`,
  `owner_windows_accepted:false`, `deployment:update_pending`.
- Живые/plated вызовы, VPS и релизный кандидат — вне задачи.
- Post-merge/CI прогон нового теста — отдельным PR (если владелец решит публиковать).

## Следующий шаг

Для живой приёмки нужны: `COSMORA_API_ORIGIN`, ключ/базу/модель провайдера,
сессия владельца и `COSMORA_LIVE_ACCEPTANCE`; для п.4 — ваше решение по
fail-closed `INCOMPLETE_COVERAGE`.
