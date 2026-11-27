# Developer API Kosmora v1

## Граница

`/api/v1/developer/v1` — отдельный публичный профиль. Внутренние owner endpoints не проксируются. Ключ `cdev_…` привязан к `owner_id`, scopes и отзыву; в БД только `sha256("cosmora.developer-api.v1\0"+token)`. Секрет возвращается только при выпуске.

## Операции

| Метод      | Путь                                  | Scope            | Комментарий                                                   |
| ---------- | ------------------------------------- | ---------------- | ------------------------------------------------------------- |
| POST       | `/keys`                               | owner session    | Выпуск ключа, `scopes`, `ttl_ms`; в ответе `token` (один раз) |
| GET        | `/keys`                               | owner session    | Список ключей без секретов                                    |
| DELETE     | `/keys/:keyId`                        | owner session    | Отзыв                                                         |
| POST       | `/chat/completions`                   | `chat.write`     | OpenAI-подмножество, `stream?`, `mode:standard                | fast`, `client_request_id` |
| POST       | `/chat/completions/:requestId/cancel` | `chat.write`     | Отмена активного потока; после завершения 404                 |
| POST       | `/tasks`                              | `tasks.write`    | Async задача, idempotency по `client_request_id`              |
| GET        | `/tasks`, `/tasks/:id`                | `tasks.read`     | Статус/опрос                                                  |
| POST       | `/tasks/:id/cancel`                   | `tasks.write`    | Отмена                                                        |
| POST       | `/webhooks`                           | `webhooks.write` | Подписка, secret один раз, URL только HTTPS                   |
| GET/DELETE | `/webhooks`, `/webhooks/:id`          | `webhooks.write` | Список/отзыв                                                  |
| POST       | `/webhooks/receive/:id`               | HMAC             | Входящая доставка, `x-kosmora-signature`, дедупликация        |

## Совместимость с OpenAI

Реально поддержаны только поля `model?`, `messages[{role,content}]`, `stream?`; ответ `id/object/model/choices[{index,message,finish_reason}]/usage`. Дополнительные поля Kosmora: `mode`, `client_request_id`. Conformance-проверки в `apps/api/test/developer-api.test.ts`. Неподдержанные OpenAI-поля отклоняются TypeBox (`additionalProperties:false`).

## Ошибки

`{error:{type,code,message,request_id}}`; коды `KEY_NOT_FOUND/KEY_REVOKED/KEY_EXPIRED` → 401, `SCOPE_DENIED` → 403, `INVALID_REQUEST` → 400, `TASK_CONFLICT` → 409, `TASK_NOT_FOUND/WEBHOOK_NOT_FOUND` → 404, `OWNER_DATA_FENCED` → 409. В сообщениях нет путей, токенов и содержимого личных чатов. Заголовок `x-api-key` и `authorization` выведены из логов.

## Версионирование и ограничения

- Префикс `v1` в URL и `{format:"...v1"}` в контрактах; миграция `0078_developer_api.sql` — черновая, финальные номера/время согласует интегратор.
- Usage пишется через существующий owner ledger correlation (`request_id/run_id`), без новых бюджетов, тарифов и счетов.
- Relay/перевод не включается молча; быстрый режим только задаёт `optimize_for:"latency"` и не обещает ускорение декодирования чужой модели.
- Кеш внешних действий не используется как разрешение повторить действие; живые замеры отделяются от fixture.
- Media adapters принадлежат Gemini; Stars/Koswork вызываются через интерфейсы владельцев, не напрямую.
