# INTEGRATION — developer API (03_OPENCODE)

Интеграционные правки в общих файлах сведены к минимуму:

1. `apps/api/src/app.ts`: добавлен канал `developerApiStore` в `AppDependencies`; вызов `registerDeveloperApiRoutes`; точный bypass только для `POST /api/v1/developer/v1/webhooks/receive/:id` (подпись проверяется внутри роута); в redaction логов добавлен `x-api-key`.
2. `apps/api/src/server.ts`: создаётся `DeveloperApiStore`, базовый identity resolver оборачивается `createDeveloperIdentityResolver`, store передаётся в `buildApp`.
3. `packages/contracts/src/index.ts`: один export для `developer-api.js`; `packages/db/src/index.ts`: один export для `developer-api-store.js`.
4. Миграция `0078_developer_api.sql` + запись в journal (idx 78) — черновая; интегратор согласует финальные номера и порядок после #688. Повторный прогон и upgrade с main до 0077 не выполнялись в этой ветке.

Общие контракты/DTO другого исполнителя не дублируются. Media adapters (Gemini), Stars (04_HARNESS), Koswork/West branches не трогались. Sidebar, chat, logo, визуальный стиль не менялись.

Проверка после интеграции: `tsc -p apps/api/tsconfig.json --noEmit`, `eslint src test`, `vitest run test/developer-api.test.ts` — зелёные.
