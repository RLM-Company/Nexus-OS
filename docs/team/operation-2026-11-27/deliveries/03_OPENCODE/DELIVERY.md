# DELIVERY — Developer API + измеримая скорость (03_OPENCODE)

Продукт: внешнее приложение подключается своим ключом к Kosmora и получает чат/потоки/результаты задач в пределах scopes; быстрый режим включается явно и измеряется.

## Исходники

- `packages/contracts/src/developer-api.ts` — DTO ключей, chat, tasks, webhooks, usage, ошибок.
- `packages/db/src/developer-api-store.ts`, `packages/db/migrations/0078_developer_api.sql` — key hash-at-rest, scopes/revocation, idempotent tasks, webhook subscriptions/deliveries.
- `apps/api/src/developer-api/` — resolver ключа, routes `/api/v1/developer/v1`, key/cancel/webhook auth.
- `apps/api/src/app.ts`, `apps/api/src/server.ts` — минимальная интеграция (redaction `x-api-key`, signed webhook bypass, resolver).
- `apps/web/public/developer/keys.html`, `experiments.html` — минимальные страницы без изменения sidebar/chat/logo.
- `examples/developer-client.mjs` — настоящий внешний клиент: issue → chat → stream/cancel → task replay → webhook → revoke.
- `packages/model-gateway/test/speed-profile.test.ts` — fixture-замеры TTFT/total, router baseline vs explicit latency.

## Результаты сценариев

Fixture: developer-api 4/4, developer-api-store 3/3, parallel-route 3/3, response-cache 2/2, speed-profile 1/1 (13/13); tsc/eslint clean; CI #694 4/4 green. Чужой/отозванный ключ → 401; повтор задачи не создаёт вторую; HMAC-подпись проверяется, дубликат дедуплицируется; `mode:fast` явно выбирает latency-route в router fixture, текст и usage совпадают с baseline; `mode:parallel` не делает fan-out для короткого входа и повторяет только помеченную часть; кеш изолирует owner/version и инвалидируется при смене instruction/tools/permissions.

Fixtures и live разделены: все числа — fixture; живой provider-эффект не подтверждён.

## Ограничения

- usage хранится в `developer_api_usage` с `request_id`/`run_id`, связанным с ключом и владельцем; запись в канонический `model_usage_ledger` и сверка с существующим ledger — следующий integration-срез (в этой ветке не выполнена).
- Живой provider/run и полный внешний CLI-прогон не выполнялись: environment нет ключей/сессии, числа только fixture; ускорение end-to-end живым замером не подтверждено.
- fast/strong/parallel реализован как opt-in pure orchestrator + fixture; кеш — owner/version-isolated механизм, но не включён в chat endpoint по умолчанию без live-проверки. Приёмка на живом入口 не выполнялась.
