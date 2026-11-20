# DELIVERY — stage3/scheduling-admission (срез B)

- **Статус:** готово к интеграции.
- **BASE_SHA:** `43b2a6da1ed865046b72a39eae242a0023941f5b` (main после #605).
- **Ветка:** `stage3/scheduling-admission`. **PR:** открывается в `main`, без merge/deploy.

## Проблема

В #605 при `dispatch` записей `kind=work_task | koscode_task | team_task`
происходила только пометка `dispatched` в таблице расписания — **реальная задача
не создавалась**. Для `message` отправка в чат уже работала.

## Решение (без второго runtime)

Переиспользован существующий **admission `ManagerWorkStore.create()`**:

- при dispatch задачи вызывается
  `works.create(project_id, owner_id, actor_id, request, dormant = true)`;
- `dormant=true` даёт `status: "paused"` — задача реально поставлена в Work,
  но координатор **не запускает модель и не тратит бюджет** до явного resume
  владельцем (см. `manager-work-store.ts:288`);
- `client_request_id = scheduled:<dispatch id>` — идемпотентность через уже
  существующий CAS `ManagerWorkStore.createAccepted()`; повторный dispatch
  записи невозможен (`409`), вторая задача не создаётся;
- `goal` ограничен 8000 символов по `CreateManagerWorkSchema`, `worker_role:
"analyst"`;
- `team_task` **не запускает Multi-Agent runtime** (по `AGENTS.md` он остаётся
  последним): цель помечается `[team]`, но используется тот же безопасный
  dormant Work-admission. Это честно зафиксированное ограничение, а не
  заявленная готовая интеграция с командой.
- `ManagerWorkStore` передаётся в роуты опционально (`works?`); без него
  поведение остаётся как в #605 (только фиксация готовности) — обратная
  совместимость с фикстурами.

## Что НЕ менялось

- Путь `kind=message` (отложенная отправка в обычный чат) не тронут.
- Composer, поле ввода, диктовка OpenCode, sidebar/global CSS, тарифы/квоты,
  VPS/production, схема БД (миграций в этом срезе нет).

## Сценарии проверки (фактические)

```
apps/api scheduled-dispatch-api.test.ts        5 passed
  (3 из #605 + 2 новых)
  4) task dispatch: до dispatch задач нет -> dispatch -> ровно одна Work-задача
     со status "paused", client_request_id=scheduled:<id>, goal содержит текст;
     повторный dispatch 409, второй задачи нет.
  5) team_task: goal содержит "[team]", статус "paused", задача одна.

packages/core полный набор       433 passed (42 файла)
packages/db  полный набор       245 passed (43 файла)
typecheck/lint 5 пакетов · prettier --check . · check-secrets — green
```

## Границы

- Задача создаётся в **paused/dormant**; явный запуск (resume) остаётся за
  владельцем. Фонового таймера и второго scheduler по-прежнему нет.
- `koscode_task` и `team_task` используют один и тот же Work-admission с
  пометкой в goal; отдельные Koscode/team рантаймы не запускаются — следующий
  срез после согласования их admission.
- Живой провайдер, VPS и ноутбук владельца не проверялись; прогоны на
  in-memory SQLite.

## Следующий шаг

Интегратору: слить PR. Затем, при отдельном поручении, подключить `resume`
созданной paused-задачи к существующему циклу координаторов и/или добавить
фоновый тик — без второго scheduler.

## Интеграционная проверка 20 ноября

Явный тик оставляет повторяющуюся запись в `ready`. Срок переносится после
успешной отправки сообщения или постановки Work-задачи. Ключ повтора включает
срок текущего срабатывания, поэтому следующий день создаёт свою задачу, а
повтор одного срабатывания сохраняет единственный результат. При недоступном
Work запись остаётся готовой и API отвечает `WORK_UNAVAILABLE`. Название
командной записи не заменяет её текст в цели Work.
