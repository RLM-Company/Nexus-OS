# Сценарии OpenCode 6 — повторяемые процедуры

Все сценарии ниже выполняются в тестовом контуреHappy-path без реальных внешних сервисов; живые коннекторы — Harness 3.

## A. Отчёт из разрешённых файлов (обязательный)

1. Создать проект и сценарий `WORKFLOW_TEMPLATES.document-report` через `/workflows`.
2. Добавить условие `source_allowlist` с file_id уже доступного файла проекта.
3. Сохранить триггер `manual` через `/api/v1/automation/triggers`.
4. Запустить `/api/v1/automation/tick` → run `queued` → `claimed` → `running`, создан Work DAG с зафиксированным снимком версии.
5. Выполнить шаг реальным `ManagerWorkCoordinator.execute` с mock gateway.
6. Проверить `report.md` как опубликованный артефакт с SHA-256/байтовой проверкой.

Файл: `apps/api/test/automation-real-path.test.ts` (реальный coordinator + mock provider).

## B. Задача по изменению разрешённого источника (обязательный)

1. Отправить событие коннектора `POST /api/v1/automation/events` с `source=harness3`, `event_type=file.updated`, стабильным `event_id` и bindings, соответствующими параметрам сценария.
2. Повторить то же событие → один trigger и один run (dedupe по `(source,event_id)`).
3. Отдельное событие с другим `event_id` создаёт независимый run.

Файл: `apps/api/test/automation.test.ts`.

## C. Процедура с человеческим подтверждением перед внешним действием (обязательный)

1. Сохранить версию с `confirmations[].external_action` и привязкой к node_id.
2. Запустить run → состояние `awaiting_confirmation`, план не создаётся.
3. Owner вызывает `/runs/:id/control` `action=confirm` → создаётся `automation_external_actions` с постоянным operation_key, run возвращается в `queued`.

Файл: `apps/api/test/automation.test.ts`.

## Отказы и права

| Проверка                   | Место                                            | Результат                                                                                    |
| -------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Повтор события             | automation.test.ts                               | 1 квитанция, 1 trigger, 1 run; повтор возвращает ту же квитанцию, 200                        |
| Рестарт/lease              | automation.test.ts                               | истёкший lease → queued, attempt сохраняется, второй process не захватывает                  |
| Смена версии               | automation.test.ts, automation-real-path.test.ts | pinned CAS, старый run хранит v1, follow_latest resolves перед enqueue                       |
| Отзыв доступа              | automation.test.ts                               | `OWNER_DATA_FENCED`, новых записей нет                                                       |
| Отмена во время исполнения | automation.test.ts                               | CAS-переход в cancelled, повтор resume запрещён                                              |
| Потеря ответа              | automation.test.ts                               | `unknown` + `unknown_external`; повторное действие переиспользует operation_key; verify явно |
| Часовой пояс               | core/test/automation.test.ts                     | 09:30 local сохранено, неверная зона отклонена, weekday → Monday                             |
| Миграция                   | db/test/automation.test.ts                       | данные сохраняются, повторный запуск миграции безопасен                                      |
