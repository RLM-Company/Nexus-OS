# Cosmora: локальная активация live-модели

Эта инструкция предназначена только для локального запуска. Никогда не вставляйте значение `MODEL_API_KEY` в чат, UI, issue, PR, commit, screenshot или лог. Cosmora должна показывать только факт наличия credential.

## 1. Добавьте ключ только локально

В корне репозитория используйте локальный `.env` (он не должен попадать в git). Добавьте или проверьте параметры текущего live-маршрута:

```dotenv
MODEL_PROVIDER=openai-compatible
MODEL_PROVIDER_ID=vibecode
MODEL_REGISTRY_PATH=config/model-registry.vibecode.v1.json
MODEL_BASE_URL=https://vibecode.moe/v1
MODEL_NAME=gpt-5.5
MODEL_API_KEY=<LOCAL_KEY>
MODEL_FALLBACK_TO_MOCK=false
```

Не меняйте Model Registry ради локального smoke. Если Emergency Stop активен, не отключайте его только для прохождения проверки: сначала разберите причину и используйте существующий owner-controlled flow.

## 2. Запустите API

Из корня репозитория:

```bash
pnpm --filter @cosmora/api demo
```

API должен слушать `http://127.0.0.1:3100`.

## 3. Выполните preflight без model request

В отдельном терминале из корня:

```bash
pnpm manager:preflight
```

Preflight проверяет локальную конфигурацию и runtime status, но не отправляет запрос модели. До исправления известного blocker он сам по себе недостаточен: дополнительно убедитесь, что `/api/v1/model-runtime` сообщает внешний режим, ожидаемый provider, `credential_configured: true` и `fallback_to_mock: false`.

## 4. Запустите web

В отдельном терминале:

```bash
pnpm --filter @cosmora/web demo
```

Откройте `http://127.0.0.1:3000/model-status`.

Для безопасной live-конфигурации страница должна показывать:

- `Live`;
- ожидаемый provider/model;
- `Credential configured: Да`;
- `Mock fallback разрешён: Нет`;
- `Fail-closed route: Да`.

Страница статуса не проверяет валидность ключа и не делает model request.

## 5. Минимальный live smoke — только вручную

Текущий guarded smoke делает ровно два платных model request: один обычный chat и один Manager project. Запускайте его только после успешного preflight, безопасного статуса и проверки Emergency Stop.

PowerShell:

```powershell
$env:COSMORA_ALLOW_PAID_SMOKE="SEND_TWO_PAID_REQUESTS"
pnpm manager:smoke
Remove-Item Env:COSMORA_ALLOW_PAID_SMOKE
```

Bash/zsh:

```bash
COSMORA_ALLOW_PAID_SMOKE=SEND_TWO_PAID_REQUESTS pnpm manager:smoke
```

Smoke обязан отказаться от запуска в mock-режиме, при включённом mock fallback, отсутствии credential или активном Emergency Stop. Не используйте эту команду в автоматических тестах.

## 6. Полностью остановите Cosmora

Нажмите `Ctrl+C` во всех терминалах, где запущены API, web или root `pnpm demo`. Убедитесь, что локальные процессы Cosmora больше не слушают порты `3000` и `3100`.

## 7. Удалите локальный ключ

Остановите приложение, удалите значение/строку `MODEL_API_KEY` из локального `.env` и очистите переменную процесса, если экспортировали её вручную. Не коммитьте `.env`.

После повторного запуска `/model-status` должен показывать `Credential configured: Нет` для live runtime.

## Важное ограничение текущего main

До отдельного backend/config исправления live нельзя считать полностью fail-closed только по результату `pnpm manager:preflight`: текущий preflight сообщает состояние mock fallback, но не завершает проверку ошибкой, когда fallback включён. Поэтому перед live smoke обязательно требуется `fallback_to_mock: false`; guarded `pnpm manager:smoke` это уже проверяет.
