# Живая приёмка на VPS 169.40.37.32 — результаты

**Дата:** 13 ноября 2026. **Исполнитель:** DeepSeek Harness.
**Разрешение владельца:** «даю все разрешения начинай работу» + VPS `169.40.37.32`,
`root@169.40.37.32`, `/opt/kosmora`, Ubuntu 24.04, 1 vCPU / ~805 МиБ RAM / 3 ГБ.

## Что сделано

### 1. Read-only доступность (локально)

| Проверка                 | Результат                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| TCP `:22`, `:443`        | открыты                                                                                               |
| `GET /`                  | `303` → `Location: /login`                                                                            |
| `GET /login`             | `200`, `text/html`, жёсткий CSP (`default-src 'none'`, `frame-ancestors 'none'`)                      |
| `GET /api/v1/health`     | `401 {"error":{"code":"UNAUTHORIZED","message":"Owner login required"}}`                              |
| `GET /api/v1/auth/login` | `401`                                                                                                 |
| TLS                      | issuer `Let's Encrypt`, истекает 16.11.2026 (проверялось с `-k`, подлинность хоста не подтверждалась) |
| SSH BatchMode            | `Permission denied (publickey,password)`                                                              |

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

## Раунд 2 (13 ноября, повторная проверка доступа)

- SSH по-прежнему `Permission denied (publickey,password)`; `~/.ssh` — только
  `known_hosts`/`known_hosts.old`, приватных `id_ed25519`/`id_rsa`/`id_ecdsa`
  нет (проверено `ssh -G` и явным перебором), `ssh-agent` не запущен, WSL не
  установлен, org/environment secrets GitHub отсутствуют.
- Найден read-write deploy key репозитория `nexus-os-codex-deploy`
  (ed25519, 20.08.2026), но через API виден **только публичный** ключ;
  приватная часть в этой среде не хранится.
- `known_hosts` содержит host keys `169.40.37.32` (ssh-ed25519 и ssh-rsa) —
  соединение с этим хостом когда-то устанавливалось, но ключа для входа здесь нет.
- Страница `/login` (37 768 байт) содержит ожидаемую форму
  `POST /__owner/login`: `username=owner` (readonly), `password`, `remember`.
  Пароль владельца не передан.
- `deploy/alpha/private/` в рабочей копии отсутствует (ожидаемо: `private/` в
  `.gitignore`); локальных `.env`/`model.env` с ключами нет.
- `LIVE_ACCEPTANCE_2026-11-12_RU.md` (сфера 02_DEVELOPER) независимо
  подтверждает: «полная живая приёмка и готовность к выпуску не подтверждены»,
  модельный этап отсутствует, `MODEL_API_KEY/BASE_URL/NAME` в среде нет.
- Обнаружены браузерные профили с файлами `Cookies` (Chrome/Edge). **Сессии
  владельца не извлекались**: чтение сохранённых cookie чужого браузера
  выходит за рамки разрешения на работу с VPS и требует явного указания.

**Вывод раунда:** доступных учётных данных для `/opt/kosmora` и
авторизованного API по-прежнему нет. `Live server acceptance smoke` остаётся
единственной фактически пройденной живой проверкой.

## Раунд 3 (подготовка инструмента, доступ по-прежнему отсутствует)

Повторная инвентаризация: env без SSH/пароля/токенов, repo secrets — только
`KOSMORA_LIVE_ORIGIN` и `MODEL_API_KEY`, environments `total_count: 0`, SSH
`Permission denied`, `/api/v1/health` → `401`, приватных identity-файлов нет.

Подготовлен **готовый к запуску** read-only инструмент, чтобы не импровизировать
на живой машине с 805 МиБ RAM сразу после получения пароля:

- `scripts/vps-live-acceptance.mjs` — обёртка над уже существующим
  `deploy/alpha/verify-access.mjs` (`verifyAccess({ origin, password, authMode:
"form" })`). Проверяет 303→/login, неавторизованный 401, form-логин, защищённые
  ассеты интерфейса, `/api/v1/health` (`status=ok`, `database=ok`), owner-сессию
  и `/api/v1/operations/status`. **Без модельных запросов и записей на сервер.**
  Пароль берётся только из `KOSMORA_OWNER_PASSWORD`, не печатается и не пишется
  на диск; без него скрипт завершается кодом 2 с явной просьбой пароля.
- `scripts/test/vps-live-acceptance.test.mjs` — `node:test` guard на fail-closed
  поведение; зарегистрирован как `test:vps-acceptance-guard` в `package.json` и
  включён в `check:core`.

Запуск после получения пароля:

```
KOSMORA_OWNER_PASSWORD=... node scripts/vps-live-acceptance.mjs
```

Локально проверено: `node --check` OK, guard `pass 1`, `prettier --check .`,
`check-secrets`, typecheck/lint contracts/core/api/web — зелёные. Два падения
по ходу исправлены содержательно (`execFileSync` → `spawnSync`; неверный
`new URL("..", import.meta.url)` из `scripts/test/` → `"../.."`).

**Доступ к `/opt/kosmora` по-прежнему не получен**; после SSH-ключа/пароля
инвентаризация каталога (версия, логи, БД, копия за 13 ноября) отдельным шагом.

## Раунд 4 (расширенная read-only проверка живой HTTPS-поверхности)

Учётные данные по-прежнему отсутствуют (SSH `Permission denied`, env пуст,
`/api/v1/health` → `401`). В рабочем каталоге замечен `.gh-token` — это
GitHub-токен, к VPS отношения не имеет; содержимое не читалось.

Новые **фактические** проверки живого `https://169.40.37.32` (только GET/HEAD и
по одному безопасному POST, без перебора паролей):

| Проверка                                                                                         | Результат                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http://169.40.37.32/`                                                                           | `308` → `Location: https://169.40.37.32/` (принудительный HTTPS)                                                                                                    |
| Заголовки `/login`                                                                               | `Cache-Control: private, no-store` (дважды), `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`, CSP `default-src 'none'` + `frame-ancestors 'none'` |
| `/api/v1/{health,identity/sessions,operations/status,projects,chats,owner-skills,research/runs}` | **все `401`** — защита единообразна на всех проверенных API                                                                                                         |
| `POST /__owner/login` с пустым паролем                                                           | `422 Unprocessable Entity`, cookie не выдан                                                                                                                         |
| `POST /__owner/login` с чужим `Origin: https://evil.example`                                     | `403` (CSRF-граница работает)                                                                                                                                       |
| `/login`: `GET`/`HEAD`                                                                           | `200` / `200`                                                                                                                                                       |
| `/login`: `OPTIONS`/`PUT`                                                                        | `404` / `404`                                                                                                                                                       |
| `/api/v1/nonexistent`                                                                            | `401` (не отдаёт данные)                                                                                                                                            |
| `/__owner/nope`, `/private`                                                                      | `303` → логин (неизвестные пути не отдают интерфейс)                                                                                                                |

**Вывод:** неавторизованная поверхность ведёт себя ожидаемо и безопасно:
принудительный HTTPS, жёсткие заголовки, единообразный `401` на API, отказ
пустого пароля и чужого Origin, никакой утечки приватных маршрутов. Это
дополняет (но не заменяет) авторизованную приёмку.

## Итоговый CI (PR #571)

PR с исправлением workflow и этим отчётом — `CLEAN / MERGEABLE`, **5/5 pass**
(run `43412028568` / `43412028665`):

```
Verify monorepo                        pass 4m13s
Browser acceptance                     pass 10m49s
Code sandbox isolation                 pass 36s
Test, build and lifecycle NSIS          pass 3m51s
Live server acceptance smoke           pass 47s
```

## Следующий шаг

1. Слить PR #571 с исправлением workflow.
2. Для проверки `/opt/kosmora`, авторизованного API и живых research/skills
   сценариев дать приватный SSH-ключ/пароль или owner-сессию.
3. Отдельно согласовать полный live-план (cookie gateway / DPAPI / reconnect)
   и финальную приёмку на ноутбуке владельца.
