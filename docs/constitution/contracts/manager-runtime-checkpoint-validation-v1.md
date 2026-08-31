# Manager Runtime Checkpoint Validation v1

> Статус: `RECOVERY SEMANTIC VALIDATION / NO RESTORE EXECUTION`  
> Дата: `2026-08-31`

## Назначение

`RuntimeCheckpointSchema` уже запрещает восстанавливать permissions, sessions и autonomy escalation. Этот слой дополнительно доказывает, что checkpoint действительно относится к тому проекту и task graph, которые планируется восстанавливать.

## Инварианты

`validateRuntimeCheckpointAgainstGraph` требует:

- одинаковый `project_id` checkpoint и graph;
- одинаковый `graph_id`;
- checkpoint не может быть создан раньше graph;
- каждый task из graph присутствует в `task_states` ровно один раз;
- checkpoint не содержит task IDs, которых нет в graph.

Валидатор возвращает список semantic issues и ничего не восстанавливает сам.

## Граница полномочий

Этот слой не:

- меняет task status;
- запускает Manager или агента;
- восстанавливает model/tool sessions;
- восстанавливает permission grants;
- восстанавливает A6/FULL escalation;
- создаёт artifacts;
- выполняет внешние операции.

Фактическое recovery позже обязано отдельно проверить Policy Runtime, emergency stop, актуальные permissions и внешние operation reconciliation до продолжения исполнения.
