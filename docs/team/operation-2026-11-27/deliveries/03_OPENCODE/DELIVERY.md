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

Fixture: 3 store + 3 API + 1 speed test зелёные, tsc/eslint clean. Чужой/отозванный ключ → 401; повтор задачи не создаёт вторую; HMAC-подпись проверяется, дубликат дедуплицируется; `mode:fast` явно выбирает latency-route в router fixture, текст и usage совпадают с baseline.

Fixtures и live разделены: все числа — fixture; живой provider-эффект не подтверждён.

## Ограничения

Нет живого provider/session; в external API пока нет прямого вызова Stars/Koswork через интерфейсы владельцев (только tasks в собственном store), ledger correlation реализована на уровне `request_id/run_id` в ответе, но ещё не сверена с `usage-store` в full ledger; fast/strong/parallel fan-out и кеш не реализованы. Приёмка на живом入口 не выполнялась.
