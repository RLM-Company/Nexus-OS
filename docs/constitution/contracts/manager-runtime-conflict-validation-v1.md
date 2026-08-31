# Manager Runtime Conflict Validation v1

> Статус: `SEMANTIC VALIDATION / NO ARBITRATION EXECUTION`  
> Дата: `2026-08-31`

## Назначение

`AgentConflictSchema` проверяет форму данных, но одной формы недостаточно для безопасного жизненного цикла конфликта. Этот слой добавляет семантические инварианты до появления реального Manager runtime.

## Инварианты

- Конфликт обязан ссылаться минимум на два разных position artifact. Повтор одного artifact не считается независимой конфликтующей позицией.
- `open` и `escalated` не могут содержать `resolution_artifact_id` или `resolved_at`.
- `resolved` обязан содержать и resolution artifact, и timestamp разрешения.
- `resolved_at` не может быть раньше `created_at`.
- Право арбитража берётся из `RuntimeRoleContract.can_arbitrate_conflict`. В текущем contract v1 оно есть только у `manager`.

## Граница полномочий

Валидатор не выбирает победившую позицию, не создаёт decision artifact, не меняет status и не запускает агента. Он только сообщает semantic issues.

Фактический арбитраж позже обязан создать отдельный Manager decision artifact и пройти применимые Policy/runtime gates.
