# CHECKPOINT — 06_HARNESS (2026-11-27)

Ветка `feature/ds3-collaboration-connectors-20261127`, база `3af92583`.
PR #691. Точный code head `a54547f72ba8a18624f657b6a43b6969c64cac38`.

## Выполнено

1. `42379e4d` — accepted shared projects в списке участника (invite не раскрывает данные).
2. `fe60cc4d` — авторство материалов, version conflict, viewer mutation guard, миграция 0078.
3. `83834e08` — http-api в каталоге, инъекция transport, status без секретов.
4. `ca7e8514` — event stream общего run доступен принятому участнику по id;
   invited/third/revoked получают 404, старый id после отзыва не работает.
5. `1f3f08f1` — capabilities→instrument selection: /integrations/tools
   показывает только wired-операции с выданными capabilities.

## Проверено в последнем запуске

- DB: membership 4 + intake upgrade 4 passed.
- API: membership 4, connector-status 2, drive lifecycle, shared-run-events 1;
  chat regression (branches/workspace/general/membership/events) 31 passed.
- tool-runtime: 95 passed / 5 skipped.
- typecheck contracts/db/api 0; format/lint/check-secrets green.
- CI run `46029685801`: Browser/Verify/Sandbox/identity — all pass.

## Осталось / блокеры

- Calendar/mail/Docs/Telegram/Slack: готовых production-адаптеров в базе нет;
  фикстуры не выдаются за подключённые сервисы. Нужны отдельные срезы с реальными
  OAuth/transport и тестовыми аккаунтами.
- Живые OAuth/отправки и VPS — отдельно по разрешённым действиям пользователя.
- Web-e2e для отзыва во время открытого экрана и fenced downloads — отдельный срез.
- Полный A/B/C сценарий с персональными агентами — зависит от Harness 1.

## Следующий шаг

Capabilities→instrument selection и адаптеры Calendar/Mail по реальным transport;
затем web-e2e отзыва. Не трогать чужие зоны, не делать merge без команды.
