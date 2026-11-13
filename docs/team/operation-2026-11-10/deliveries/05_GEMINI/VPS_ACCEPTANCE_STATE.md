# Живая приёмка на VPS 169.40.37.32 — результаты

**Дата:** 13 ноября 2026. **Исполнитель:** DeepSeek Harness.
**Разрешение владельца:** «даю все разрешения начинай работу» + VPS `169.40.37.32`,
`root@169.40.37.32`, `/opt/kosmora`, Ubuntu 24.04, 1 vCPU / ~805 МиБ RAM / 3 ГБ.

## Что сделано

### 1. Read-only доступность (локально)

| Проверка | Результат |
| --- | --- |
| TCP `:22`, `:443` | открыты |
| `GET /` | `303` → `Location: /login` |
| `GET /login` | `200`, `text/html`, жёсткий CSP (`default-src 'none'`, `frame-ancestors 'none'`) |
| `GET /api/v1/health` | `401 {"error":{"code":"UNAUTHORIZED","message":"Owner login required"}}` |
| `GET /api/v1/auth/login` | `401` |
| TLS | issuer `Let's Encrypt`, истекает 16.11.2026 (проверялось с `-k`, подлинность хоста не подтверждалась) |
| SSH BatchMode | `Permission denied (publickey,password)` |

### 2. Найден и включён штатный opt-in CI-механизм

В `.github/workflows/windows-desktop.yml` есть job `live-smoke`
(**Live server acceptance smoke**) за секретом `KOSMORA_LIVE_ORIGIN`, который
запускает `desktop/windows/ci/gui-acceptance-live.cjs` — freshly installed
packaged Kosmora client против реального HTTPS origin, **без учётных данных**,
проверяя честное неавторизованное состояние.

- Секрет `KOSMORA_LIVE_ORIGIN=https://169.40.37.32` создан (`gh secret set`).
- Workflow запущен вручную (`workflow_dispatch`) на `main`: run `43407481767`.
- `build` success, `live-smoke` **failure** — но не из-за VPS: `actions/setup-node@v5`
  в этом job по умолчанию включает `package-manager-cache` и ищет `pnpm`, которого
  в job нет (`Unable to locate executable file: pnpm`). `always()`-шаг uninstall
  затем маскировал первопричину, падая на отсутствующем каталоге.

### 3. Исправление workflow (ветка `fix/live-smoke-node-cache`, `ddfc5e2`)

- `package-manager-cache: false` — тот же флаг, что уже используется в `build`;
- uninstall-шаг сделан идемпотентным (no-op, если установка не состоялась).

### 4. Повторный живой прогон — SUCCESS

Run `43408916338` (ветка фикса): `build` success, **Live server acceptance smoke
success**.

Лог job `131831322947`:
```
Live acceptance smoke OK: landed on login of ***
Artifact kosmora-windows-gui-acceptance-live.zip finalized
```

Содержимое артефакта `cosmora-gui-acceptance-live-report.json`:
```json
{
  "schemaVersion": 1,
  "phase": "live-smoke",
  "ok": true,
  "landedOnLogin": true,
  "savedOrigin": "https://169.40.37.32"
}
```

**Фактически подтверждено:** packaged Windows-клиент с живого GitHub-hosted
runner подключился к `https://169.40.37.32`, получил честный редирект/страницу
входа, сохранил origin и не упал. Это реальный живой сервер, не фикстура.

## Что НЕ проверено (честно)

- `/opt/kosmora`, логи, версия сборки, состояние БД и ежедневная копия за
  13 ноября — **не просмотрены**: SSH-ключа/пароля нет, `~/.ssh` содержит только
  `known_hosts`, WSL не установлен, записей для VPS в Credential Manager нет.
- Авторизованный API: `/api/v1/health` требует owner login, токен/сессия не
  переданы. Сценарные прогоны research/skills/research-artifact на живом API
  **не выполнялись**.
- Реальная модель / платные вызовы: `MODEL_API_KEY` есть только как secret
  GitHub Actions, opt-in фразы не давались, вызовы не делались.
- Cookie gateway / DPAPI / reconnect (`LIVE_ACCEPTANCE_PLAN_RU.md`) — входят в
  полный план живой приёмки, этот smoke покрывает только неавторизованное
  состояние. Owner-PC (ноутбук владельца) по-прежнему отдельная проверка.
- Живая приёмка stage-one по `AGENTS.md` **не объявляется завершённой**.

## Что НЕ делалось

Не подключался к `/opt/kosmora`, не читал БД/бэкапы/`.env`, не запускал и не
перезапускал сервисы на VPS, не деплоил, не менял конфиги сервера, не запускал
платные вызовы, не сливал PR #565. Workflow выполнялся на disposable
GitHub-hosted Windows runner, а не на машине владельца.

## Следующий шаг

1. Слить PR с исправлением workflow (`fix/live-smoke-node-cache`).
2. Для проверки `/opt/kosmora`, авторизованного API и живых research/skills
   сценариев дать приватный SSH-ключ/пароль или owner-сессию.
3. Отдельно согласовать полный live-план (cookie gateway / DPAPI / reconnect)
   и финальную приёмку на ноутбуке владельца.
