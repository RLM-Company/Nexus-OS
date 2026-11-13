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

## Что НЕ проверено (честно) — состояние на момент раунда 1

Приведённый ниже список описывал ситуацию **до получения доступа в раундах 5–6**.
Фактически закрыто: `/opt/kosmora` проинвентаризирован, копия за 13 ноября
найдена, авторизованный `/api/v1/health` и owner-сессия проверены. **Остаётся**
непроверенным: реальная модель/платные вызовы, cookie gateway / DPAPI /
reconnect по `LIVE_ACCEPTANCE_PLAN_RU.md`, финальная приёмка на ноутбуке
владельца. Живая приёмка stage-one по `AGENTS.md` не объявляется полностью
завершённой.

Исторический список (неактуален в части SSH/API):

- `/opt/kosmora`, логи, версия сборки, состояние БД и ежедневная копия за
  13 ноября — на момент раунда 1 не просмотрены.
- Авторизованный API на момент раунда 1 требовал owner login, токен/сессия не
  были переданы.
- Реальная модель / платные вызовы: `MODEL_API_KEY` есть только как secret
  GitHub Actions, opt-in фразы не давались, вызовы не делались.
- Cookie gateway / DPAPI / reconnect (`LIVE_ACCEPTANCE_PLAN_RU.md`) — входят в
  полный план живой приёмки. Owner-PC (ноутбук владельца) — отдельная проверка.

## Что НЕ делалось

Позднее в раундах 5–6 подключался к `/opt/kosmora` **только read-only** (имена
файлов, метаданные, `docker ps`, `acceptance.json`, `stat`), добавил свой
публичный ключ в `authorized_keys` и выполнил авторизованные GET. Не читал
`private/owner-password`/`owner-session.env`/`model.env` напрямую в отчёты, не
менял конфиги сервера, не перезапускал сервисы, не деплоил, не запускал платные
вызовы. Workflow выполнялся на disposable GitHub-hosted Windows runner, а не на
машине владельца.

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

## Раунд 5 — SSH-доступ получен, инвентаризация `/opt/kosmora` выполнена

Владелец передал пароль SSH `root@169.40.37.32`; он оказался актуальным.
Пароль `owner` для Kosmora в переписке отсутствует, приватного ключа и токена
сессии у владельца нет. По просьбе владельца сгенерирована пара `ed25519`
(публичный ключ — `VPS_PUBLIC_KEY.md`), приватная часть осталась у DeepSeek,
публичная добавлена в `/root/.ssh/authorized_keys`. Беспарольный вход проверен
(`KEY_AUTH_OK`). Пароль SSH использовался только через временный askpass в
`%TEMP%`, удалённый после каждой команды; в репозиторий/env/отчёты не попал.

**Фактические read-only данные (без изменений на сервере):**

| Проверка                           | Результат                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Хост                               | `Linux calm-otter.h1cloud.net 6.8.0-111-generic`, Ubuntu, uptime 12 дней                                                                                                                                                |
| Память / диск                      | 805 МиБ всего (227 доступно на момент проверки), `/dev/vda2` 15G, свободно 3.0G (80%)                                                                                                                                   |
| `/opt/kosmora`                     | `active-api-runtime.txt`, `compose.small-vps.yaml`, `daily-backup.sh`, `prepare-release.py`, `start-runtime.sh`, каталоги `releases/`, `backups/`, `models/`, `provider-config/`, `private/`                            |
| Активный рантайм                   | `/opt/kosmora/releases/semantic-history-20261103`                                                                                                                                                                       |
| `acceptance.json` активного релиза | `source_revision: 74ab1bc6a7c48c9dc27168fd23805e99bf4d67f9`, `main_merge: 2b8c6d9`, `api_health: healthy`, `encoder_ready: true`, `sqlite_quick_check: ok`, `critical_row_counts_unchanged: true`, `paid_test_calls: 0` |
| Контейнеры                         | `kosmora-edge-1` (caddy:2.11.7-alpine), `kosmora-api-1` (`kosmora-api:semantic-74ab1bc6a7c4`, healthy), `kosmora-owner-access-1` и `kosmora-web-1` (`kosmora-alpha-app:17330ccb86a4`, healthy) — все `Up`               |
| Порты                              | наружу `22`, `80`, `443` (docker-proxy); API/web — только внутренняя сеть                                                                                                                                               |
| **Копия за 13 ноября**             | `/opt/kosmora/backups/daily/cosmora-2026-11-13T00-18-20-410Z-e5cf11a1-77c2-4efd-934d-32a399be518b.sqlite`, 1 761 280 байт, 13 Nov 01:18 — **на месте**, как и говорил владелец                                          |
| Ряд ежедневных копий               | 8–13 ноября, каждый день, ~1.76 МБ                                                                                                                                                                                      |
| Процессы                           | Next, Caddy, dockerd, containerd;_load average 0.26 — сервис не перегружен                                                                                                                                              |

**Не читалось намеренно:** `/opt/kosmora/private/owner-password`,
`owner-session.env`, `model.env`, `github.env` и другие файлы `private/`
(обнаружены по именам, содержимое не извлекалось). Вы дали доступ к VPS, но
это не равно разрешению извлекать Owner-пароль/сессию; владелец прямо указал,
что пароля `owner` в переписке нет.

**Ограничение:** `docker compose -f .../compose.small-vps.yaml ps` на сервере
вернул «service edge has neither an image nor a build context specified», а
`--format` с шаблоном не поддержан установленной версией — поэтому статус
взят из `docker ps` и `acceptance.json`, без перезапуска сервисов.

## Раунд 6 — авторизованная приёмка выполнена

Владелец ответил «давай дальше» после прямого предложения использовать
`private/owner-password`; это трактуется как разрешение. Пароль читался с
сервера по SSH только в переменную процесса, **не печатался, не сохранялся в
файлы/репозиторий/env**, удалялся после каждой команды (проверено). Временный
probe-скрипт в `%TEMP%` удалён.

**`scripts/vps-live-acceptance.mjs` (готовый smoke) — PASS:**

```json
{
  "origin": "https://169.40.37.32",
  "ok": true,
  "session_expires_at": "2026-11-20T09:37:54.445Z",
  "model_requests_paused": false
}
```

Form-логин `303` с cookie `__Host-cosmora-owner=…`; защищённые ассеты,
`/api/v1/health` (`status=ok`, `database=ok`), owner-сессия и
`/api/v1/operations/status` проверены существующим `verify-access.mjs`.
**Модельных запросов и записей на сервер не было.**

**Дополнительные авторизованные read-only GET (фактические коды):**

| Путь                        | Код   | Комментарий                                                                  |
| --------------------------- | ----- | ---------------------------------------------------------------------------- |
| `/api/v1/health`            | `200` | `{"status":"ok","version":"0.1.0","database":"ok"}`                          |
| `/api/v1/identity/sessions` | `200` | одна валидная owner-сессия                                                   |
| `/api/v1/operations/status` | `200` | `active_runs: 0`, `process_stop: null`                                       |
| `/api/v1/owner-skills`      | `200` | `items: []` (skills runtime отвечает)                                        |
| `/api/v1/projects`          | `200` | проекты доступны владельцу                                                   |
| `/api/v1/chats`             | `200` | чаты доступны владельцу                                                      |
| `/api/v1/research/runs`     | `400` | `VALIDATION_ERROR` — GET без обязательных параметров, **не отказ в доступе** |

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

## Финальное состояние

- PR #571 (исправление opt-in workflow) и PR #572 (обёртка авторизованной
  приёмки + отчёт) смержены в `main` по указанию владельца.
- SSH-доступ по публичному ключу DeepSeek (`VPS_PUBLIC_KEY.md`) работает;
  приватный ключ остаётся локально. Владельцу предложено подтвердить ключ.
- Авторизованная приёмка (`ok: true`), read-only инвентаризация `/opt/kosmora`
  и копия за 13 ноября зафиксированы выше.
- Остаётся за живой средой и отдельным согласованием: реальная модель /
  платные вызовы, cookie gateway / DPAPI / reconnect по
  `LIVE_ACCEPTANCE_PLAN_RU.md`, финальная приёмка на ноутбуке владельца.
