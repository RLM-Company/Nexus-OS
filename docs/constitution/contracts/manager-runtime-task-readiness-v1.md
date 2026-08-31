# Manager Runtime Task Readiness v1

> Статус: `DEPENDENCY DERIVATION / NO TASK EXECUTION`  
> Дата: `2026-08-31`

## Назначение

`deriveRuntimeTaskReadiness` вычисляет только dependency-состояние узлов `RuntimeTaskGraph`. Результат `ready` означает лишь, что зависимости завершены; он не является командой на запуск.

## Правила

- полный graph сначала проходит semantic validation;
- невалидный graph fail-closed помечает все derived states как `blocked`;
- pending/ready task без незавершённых зависимостей получает derived `ready`;
- незавершённая dependency оставляет task в `pending`;
- failed dependency блокирует зависимый task;
- cancelled dependency блокирует зависимый task;
- явный `blocked` никогда не снимается этим слоем;
- `running` и terminal states сохраняются без изменений.

Явный `blocked` может принадлежать critic, Policy Runtime, emergency stop или другому safety subsystem, поэтому dependency evaluator не имеет права его снимать.

## Граница полномочий

Readiness layer не запускает task/agent/model/tool, не изменяет persisted graph, не снимает critic/policy/stop blocks, не выдаёт permissions, не меняет A0–A6 и не создаёт внешние эффекты.
