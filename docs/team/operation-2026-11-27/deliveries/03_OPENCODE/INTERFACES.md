# Developer API Kosmora — интерфейсы первого полезного среза

База `3af92583ccc8ceb49f44c0b8633955f40feaf59f`, ветка `feature/oc3-developer-api-performance-20261127`.

## Внешняя граница (версия v1)

Публичный префикс: `/api/v1/developer/v1`. Внутренние owner endpoints не открываются напрямую; ключ не даёт административных полномочий.

### Вход: ключ разработчика

- Заголовок `Authorization: Bearer cdev_<base64url>` (префикс `cdev_`, 32 случайных байта).
- Вход store `resolve(token) → {owner_id, key_id, scopes[]}`; в БД только `sha256("cosmora.developer-api.v1\0"+token)`, never plaintext. Секрет показывается **один раз** при выпуске.
- scopes: `chat.read`, `chat.write`, `tasks.read`, `tasks.write`, `files.read`, `files.write`, `webhooks.write`. Каждый endpoint проверяет scope явно.
- Отзыв: `revoked_at`, истёкший `expires_at`,Owner fence `OWNER_DATA_FENCED` → отказ.

### Выход/события

- Chat: OpenAI-подмножество — `POST /chat/completions` с `{model?,messages,stream?,mode?,client_request_id?}`, stream = SSE `message.delta` / `run.completed` / `error`; `usage` с `request_id`, `run_id`, input/output, `first_token_ms`, `total_ms` (когда провайдер вернул timing).
- Async: `POST /tasks`, `GET /tasks/:id`, `GET /tasks`, `POST /tasks/:id/cancel`, `GET /tasks/:id/results`; idempotency по `(owner_id, client_request_id)` с проверкой hash запроса, повтор после потери ответа не создаёт вторую задачу.
- Webhooks: `POST /webhooks` → `{subscription, secret}` (secret только при выпуске), `GET /webhooks`, `DELETE /webhooks/:id`; подпись HMAC-SHA256 над каноническим телом, ключ — сохранённый digest (32 байта), дедупликация по `(webhook_id,event,payload_sha256)`, ретраи с attempt, отзыв останавливает выдачу.
- Ошибки: `{error:{type,code,message,request_id}}`; `request_id` для корреляции, без внутренних путей, токенов и содержимого чатов в message.

### Принадлежность данных

- `developer_api_keys`, `developer_api_tasks`, `developer_api_webhooks`, `developer_api_deliveries` — новая миграция `0078_developer_api.sql` (номера/время финально согласует интегратор).
- Все таблицы ключеваются `owner_id` (аккаунт владельца ключа); `key_id` — только корреляция, не второй бюджет/счёт.
- Usage списывается в существующий ledger через `owner_id`+`run_id` ключа; новые пользовательские бюджеты/тарифы не вводятся.
- Stars/Koswork вызываются через интерфейсы их владельцев (managerWorkCoordinator / starsMissionStore), не напрямую через внутренние БД.

## Чего НЕ обещаем

- Полную совместимость с OpenAI — только реально поддержанные поля подмножества chat completions (будут conformance-тесты).
- Автоматический перевод relay: по умолчанию выключен, включается только явной настройкой владельца (и turbo его отключает).
- Ускорение декодирования чужой модели: измеряем только end-to-end TTFT/полное время на наших задачах и фикстурах; живой провайдер отдельной пометкой.
- Результат внешнего действия как разрешение на повтор: кеш не используется для подтверждения внешнего эффекта.
