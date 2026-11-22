# Dry-run живых пунктов: провайдеры и VPS — 20 ноября 2026

Задание: подготовить безопасную часть последних пунктов третьего этапа без
платных вызовов и без изменений на сервере. **Живые вызовы, ключи, пароль
владельца и деплой не использовались.**

**Ветка:** `stage3/scheduling-clean`, база `dcb18e8f`. **PR/deploy нет.**

## Что проверено локально

| Guard-скрипт                                      | Результат | Что guarantees                                                                                                                                                                 |
| ------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/test/provider-connection-check.test.mjs` | 14 passed | discovery при остановке/нулевом балансе без генерации; invalid endpoint/refused before credentials; failed/empty/oversized stream не проходит; fixture fetch, внешней сети нет |
| `scripts/test/vps-live-acceptance.test.mjs`       | 1 passed  | обёртка завершается `exit 2` без `KOSMORA_OWNER_PASSWORD`, не печатает `Owner access PASS`; сервер не трогается                                                                |
| `scripts/test/live-ai-work-acceptance.test.mjs`   | 7 passed  | без paid opt-in нет receipt/сети; mismatch run identity/mock completion отвергается; предыдущий receipt блокирует redispatch                                                   |
| `scripts/test/live-coscode-acceptance.test.mjs`   | 8 passed  | opt-in обязателен; durable receipt блокирует повтор; publication требует независимо проверенных hash                                                                           |
| `scripts/test/media-live-acceptance.test.mjs`     | 5 passed  | incomplete confirmation не dispatch; hash/size/MIME сверяются; unknown POST outcome без повтора                                                                                |

Итого **35 guard-тестов**, exit 0. Это локальная подготовка, не живая приёмка.

## Что остаётся за разрешением владельца

1. **Живое подключение провайдера.** Требуется `COSMORA_ALLOW_PAID_CONNECTION_TEST=SEND_ONE_BOUNDED_REQUEST`
   и действительные ключи. Без opt-in guard'ы честно блокируют вызов. Даже после
   разрешения — только один ограниченный запрос с проверкой модели/баланса и
   redacted receipt.
2. **VPS live acceptance.** Требуется `KOSMORA_OWNER_PASSWORD`, доступ к хосту и
   явное разрешение на подключение. По [VPS_STATE.md](team/operation-2026-11-14/chat-profile/VPS_STATE.md)
   на сервере развёрнута другая ветка, если не было более свежей synchronize.
3. **Деплой.** Перед ним: сверить SHA `main` с запущенным, backup, rehearsal
   миграций на копии БД, rollback-план. Ничего из этого в dry-run не выполнялось.

## Почему не делаю сам

Правила этапа и [STAGE_TWO_WORKFLOW_RU.md](product/STAGE_TWO_WORKFLOW_RU.md)
относят платные вызовы, внешние публикации и серверные работы к решениям
владельца. «Продолжай» не отменяет это ограничение; guard-тесты специально
показывают, что система **fail-closed** без явного opt-in.

## Следующий шаг

Если владелец даёт точечное разрешение: сначала connection-check в discovery
режиме (без генерации), затем один bounded paid request; для VPS — сначала
read-only health/версия, затем backup/rehearsal и только потом deployment.
До разрешения всё готово и локально проверено.

## Границы

Никаких секретов в репозиторий не добавлялось; `.env` не читался; real endpoints
не вызывались; файлы параллельных сессий (`scheduled-dispatch*`, `pnpm-lock.yaml`
в подпапках, `docs/team/operation-2026-11-15/`) не трогались.
