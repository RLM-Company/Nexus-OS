# DELIVERY — chat task/timer state projection

- **Статус:** готово к интеграции.
- **BASE_SHA:** `6fa5b0bc20e3103bd78204e7d5b74f35e704ef2a` (main после #611).
- **Ветка:** `stage3/chat-task-events`. **PR:** без merge.

## Что и зачем

После слияния #611 в main живой пользовательский сценарий с реальной моделью
выполнен на VPS `169.40.37.32` (form-логин owner, провайдер
`cheapvibecode/hy4`, `credential_configured=true`). Нужно передать состояние и
события этих прогонов в будущие карточки плана/таймеров чата.

В main **нет** готового UI `chat-task-plan` (проверено: в `apps/web/src/app`
есть только `office-plan*`), поэтому вместоaires прямого изменения чата
добавлен чистый UI-агностический проектор:

- `packages/core/src/work-timeline.ts` — `projectWorkTimeline(work)` превращает
  публичные поля `ManagerWork` (status/stage/events/error_code/model_requests/plan)
  в компактную модель для карточек:
  - `progress`: `queued | planning | awaiting_owner | delivering | closed`;
  - `title` из `plan.summary` (или первого события);
  - `steps` с `kind`: `control | model | diagnostic`;
  - `error_code` и `model_requests` как есть.
    Чистая функция: без БД, модели, записи и таймеров. Никаких изменений composer,
    поля ввода/диктовки OpenCode или sidebar — границы `AGENTS.md` соблюдены.

## Живые факты, легшие в тесты

- `edcc0468-9458-496d-adcc-1921a889862d`: реальный запрос модели,
  `awaiting_approval`, `План подготовлен`, summary «Создам короткий файл … о
  погоде», 1 model request. Это **положительный** живой прогон: модель вернула
  валидный план, работа ждёт явного одобрения владельца.
- `b5f2297f-ba98-457c-8daa-84104d263a87`: `PROVIDER_ERROR`, диагностика
  `INCOMPLETE_TEXT_RESPONSE`, events «Диагностика модели…» и «Работа
  остановлена…».

## Проверки

```
packages/core test/work-timeline.test.ts   2 passed
packages/core tsc --noEmit                  0
core lint · prettier --check . · check-secrets — green
```

## Границы

Не обходил auth, не извлекал секреты; на VPS только read-only GET через
форменную owner-сессию иcreation двух задач с явным бюджетом. Токены/пароли не
печатались. Merge не делаю без указания.

## Следующий шаг

Интегратору: подключить `projectWorkTimeline()` к карточке плана/таймеров чата,
когда тот срез будет согласован (в текущем main его нет).
