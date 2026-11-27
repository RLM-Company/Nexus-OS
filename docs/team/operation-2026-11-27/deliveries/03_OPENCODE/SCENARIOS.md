# Сценарии приёмки Developer API Kosmora (v1)

База `3af92583ccc8ceb49f44c0b8633955f40feaf59f`, ветка `feature/oc3-developer-api-performance-20261127`.

## Fixture-прогон (выполнен)

```
# из apps/api
node node_modules/vitest/vitest.mjs run test/developer-api.test.ts --testTimeout=60000   # 3/3
# из packages/db
node node_modules/vitest/vitest.mjs run test/developer-api-store.test.ts --testTimeout=30000 # 3/3
# из packages/model-gateway
node node_modules/vitest/vitest.mjs run test/speed-profile.test.ts --testTimeout=30000    # 1/1
tsc -p ... --noEmit   # 0
eslint src test       # 0
```

Покрыто:

- выпуск ключа (секрет один раз, в БД только хеш), scopes, чужой и отозванный ключ → 401;
- chat completions не-stream: OpenAI-подмножество, usage, request_id; SSE stream: `message.delta`, `run.completed`; cancel активного потока (после завершения → 404);
- async задача: idempotency по `client_request_id`, повтор после «потери ответа» не создаёт вторую задачу, статус/отмена;
- webhook: подписка, секрет один раз, HMAC-SHA256, дедупликация повторной доставки, отзыв;
- скорость: явный `optimize_for:"latency"` выбирает быстрый маршрут, baseline — обычный; одинаковый semantic answer и usage; TTFT/total из gateway timing.

## Живая приёмка (НЕ выполнена)

Публичный endpoint с живым провайдером, полный цикл внешнего клиента и панель на живом провайдере не прогонялись: environment нет `MODEL_API_KEY`/BASE_URL/NAME и сессии владельца. Все числа времени — fixture/synthetic; ускорение end-to-end живым замером не подтверждено.

## Внешний пример (CLI)

См. `examples/developer-client.mjs`: issue key (через owner session), chat stream, cancel, task, webhook receive, revoke. Запуск против локального API с mock — fixture; против реального origin — только с явным разрешением и ключами.
