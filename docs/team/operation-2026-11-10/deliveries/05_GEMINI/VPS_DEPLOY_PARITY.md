# Сверка задеплоенной версии VPS с `main` — 13 ноября 2026

**Исполнитель:** DeepSeek Harness. **Ветка:** `ops/vps-live-parity`.
**BASE_SHA (`main`):** `4477dd53e5767a4bb4990c3109c874683a892b63` (после #571/#572).
**VPS:** `169.40.37.32`, `/opt/kosmora`, Ubuntu 24.04, 1 vCPU / 805 МиБ RAM.

## Метод

Авторизованные read-only HTTP-пробы против живого `https://169.40.37.32`
(form-логин owner, cookie только в памяти процесса). Использованы **только**
инертные/не сохраняющие методы: GET и `POST /corrections/propose` (ничего не
пишет), `POST /evaluate-result` (stateless), `POST .../artifacts/preview`
(только чтение). **Не создавал** research-запуск: `POST /research` отправлен с
невалидным телом намеренно, чтобы проверить валидацию, а не запустить поиск.
Никаких модельных/платных вызовов, записей в БД, деплоя или перезапуска
сервисов. Пароль owner не сохранялся; временные probe-скрипты в `%TEMP%`
удалены.

## Фактические результаты

| Проба                                                      | Код                        | Что означает                                                    |
| ---------------------------------------------------------- | -------------------------- | --------------------------------------------------------------- |
| `GET /api/v1/owner-skills/scope`                           | `200`                      | старый skills runtime живой                                     |
| `POST /api/v1/owner-skills/corrections/propose`            | **`404 ROUTE_NOT_FOUND`**  | срез C (#538/#554) **не задеплоен**                             |
| `POST /api/v1/owner-skills/evaluate-result`                | **`404 ROUTE_NOT_FOUND`**  | срез D (#538/#554) **не задеплоен**                             |
| `GET /api/v1/projects`                                     | `200`                      | проекты доступны владельцу                                      |
| `GET /api/v1/projects/:id/materials/artifacts`             | `200 {"items":[]}`         | hook живой, research-кандидатов нет                             |
| `POST .../materials/artifacts/preview` с `kind:"research"` | **`400 VALIDATION_ERROR`** | срез D (#565) **не задеплоен**: схема ещё `canvas\|table\|work` |
| `GET /api/v1/research`                                     | `200 {"items":[]}`         | research store живой, но без новых отчётов                      |
| `GET /api/v1/research/status`                              | `200`                      | `available: false`, лимиты `RESEARCH_LIMITS` на месте           |
| `POST /api/v1/research` (невалидное тело)                  | `400 VALIDATION_ERROR`     | валидация работает; запуск **не создан**                        |

Внутри контейнера `kosmora-api-1`: `package.json` `cosmora-os@0.1.0`,
`pnpm@11.19.0`. Активный релиз на диске —
`/opt/kosmora/releases/semantic-history-20261103`, его `acceptance.json`
фиксирует `source_revision: 74ab1bc6a7c48c9dc27168fd23805e99bf4d67f9` и
`main_merge: 2b8c6d923b84ea54f8d2c9e779042a4f7bd73008` от **3 ноября**.

## Вывод

**Задеплоенная версия отстаёт от `main`.** Все мои срезы 05_GEMINI/06_CLAUDE,
смерженные 13 ноября (A–D: проверка доказательств, дубли/противоречия,
снимки/границы, передача отчёта в проект; и correction/evaluate), в коде `main`
есть и CI зелёный, но на VPS **ещё не работают** — роуты отсутствуют, схема
`source.kind` старая. Это не поломка: сервис здоров (`api_health: healthy`,
`sqlite_quick_check: ok`, 4 контейнера `Up`), просто рабочая копия собрана из
более раннего коммита.

Расхождение **не исправлялось**: деплой/пересборка/перезапуск сервисов не
выполнялись по `AGENTS.md` и без отдельного поручения владельца.

## Что нужно для устранения

1. Отдельное поручение владельца на деплой актуального `main` (`4477dd5`) на
   VPS — сборка образа, обновление активного релиза и перезапуск контейнеров.
2. После деплоя — повторить эти же пробы: ожидается `200` на `propose` и
   `evaluate-result`, и `200`/`404 NOT_FOUND` (а не `400`) на preview с
   `kind:"research"`.
3. Сверить `acceptance.json` нового релиза с новым `source_revision`.

## Границы

Read-only, без Secrets в отчёте, без модельных вызовов и без изменений сервера.
Stage-one живая приёмка по `AGENTS.md` по-прежнему не объявляется полностью
завершённой (остаются реальная модель, cookie gateway/DPAPI/reconnect и
ноутбук владельца).
