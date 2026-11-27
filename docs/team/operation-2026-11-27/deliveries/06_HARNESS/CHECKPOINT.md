# CHECKPOINT — 06_HARNESS (2026-11-27)

Ветка `feature/ds3-collaboration-connectors-20261127`, база `3af92583`.
PR #691 (OPEN, draft по умолчанию; head обновляется по мере срезов).

## Выполнено

1. `42379e4d` — accepted shared projects в списке участника (invite не раскрывает данные).
2. `fe60cc4d` — авторство материалов, version conflict, viewer mutation guard, миграция 0078.
3. `83834e08` — http-api в каталоге, инъекция transport, status без секретов.

## Проверено в dernier запуске

- DB: `project-membership-store` 4 passed, `project-intake-upgrade` 4 passed.
- API: `project-membership` 4 passed, `connector-status` 2 passed, `drive-connector-lifecycle` passed.
- tool-runtime: `http-connector` 4 passed.
- typecheck: contracts/db/api 0; prettier/check-secrets green.

## Осталось / блокеры

- Calendar/mail/Docs/Telegram/Slack: готовых production-адаптеров в базе нет;
  фикстуры не выдаются за подключённые сервисы. Нужны отдельные срезы с реальными
  OAuth/transport и тестовыми аккаунтами.
- Живые OAuth/отправки — отдельно по разрешённым действиям пользователя.
- Событийный поток и повторное использование старого ID для shared-project —
  частично покрыто existing membership/sources тестами; требуется отдельный e2e.
- Один общий сценарий A/B/C с персональными агентами — depends on Harness 1.

## Следующий шаг

Прогнать CI точного head, затем добавить event-stream/stale-ID и cal/mail адаптеры
по реальным transport.
