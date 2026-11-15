# VPS-сверка после PR #600 — 15 ноября 2026

**Исполнитель:** DeepSeek Harness. **Доступ:** SSH-ключ `id_ed25519_kosmora_vps`
(`KEY_AUTH_OK`), без пароля. Все действия read-only; сервисы не перезапускались,
#код не деплоился, `.env`/секреты/`owner-password` не читались.

## Состояние VPS

| Проверка                      | Результат                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Хост                          | `169.40.37.32`, uptime 14 дней, 805 МиБ RAM (147 доступно), диск 2.6G свободно                                                                   |
| Контейнеры                    | `kosmora-api-1`, `kosmora-web-1`, `kosmora-edge-1`, `kosmora-owner-access-1` — все `Up`, API/web `healthy`. Перезапущены ~20 ч назад **не мной** |
| Задеплоенный образ            | `kosmora-release:84ad2283be03-api`, создан 14.11.2026; overlay `releases/stage3-document-analysis`                                               |
| Живая БД                      | `/var/lib/docker/volumes/kosmora_cosmora_data/_data/cosmora.db` (2 281 472 байт)                                                                 |
| `kosmora_account_preferences` | колонки **без** `display_name`/`user_gender`/`assistant_gender`; строк **0**                                                                     |
| Ежедневные копии              | ряд 1–15 ноября; свежая `cosmora-2026-11-15T00-22-47-942Z-….sqlite` (2 277 376 байт)                                                             |

**Вывод:** на VPS развёрнута **другая ветка/релиз** (`stage3-document-analysis`,
`84ad2283be03`), а не `main` после #591/#600. Код профиля (#600) на VPS
**не задеплоен**; задеплоенный journal содержит свою `0068_document_package_analysis.sql`.

## Dry-run миграции профиля (на копии бэкапа, не на живой БД)

Скопировал бэкап 15 ноября в `/tmp` контейнера и применил три `ALTER TABLE`
из #600:

```
before: [owner_id, version, relay_enabled, response_language, optimize_for,
         preferred_provider, preferred_model, chat_style, max_total_tokens, updated_at]
after :  + display_name, user_gender, assistant_gender
integrity_check: ok
rows: []
```

Миграция аддитивна, существующие строки (их нет) не затрагиваются, defaults
`'' / masculine / neutral`, целостность БД сохранена. Временные файлы
`/tmp/vps-backup.sqlite`, `/tmp/vps-migration-probe.cjs`, `/tmp/mig.cjs` удалены.

## Почему живую БД НЕ менял

1. Код #600 на VPS отсутствует — колонки пока некому читать/писать.
2. У задеплоенного релиза свой набор миграций (в т.ч. своя `0068`); применять
   чуждую схему поверх чужого кода без согласования с интегратором рискованно.
3. Поручение «делаем» покрывало слияние PR и продолжение, но не деплой кода и не
   изменение продовой БД. Перезапуск сервисов и деплой не выполнялись.

## Что нужно для завершения

1. Отдельное поручение на деплой актуального `main` (`7c53af8`) на VPS:
   сборка образа, обновление overlay/volumes, перезапуск контейнеров.
2. После деплоя код сам применит обновлённую `0027` / guarded `ALTER` при
   старте `AccountStore.migrate()`; либо выполнить три `ALTER` вручную (dry-run
   выше подтверждает безопасность).
3. Затем авторизованный smoke: `PUT /api/v1/personal-settings` с именем/родами
   → перезагрузка → GET → проверка system prompt обычного чата и Koswork.

## Проверки в репозитории

- PR #600 слит: `7c53af846b44e4b1b4b254c0d85fda979fa60b67`.
- CI `main` `43702565993` — **success**.
- До merge: CI #600 4/4 pass, api 1100, core 425, db 236, web typecheck/build 0.
