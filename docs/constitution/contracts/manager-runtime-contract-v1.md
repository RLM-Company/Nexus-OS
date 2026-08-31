# Manager Runtime Contract v1

> Статус: `IMPLEMENTATION CONTRACT / NO FINAL PROMPT / NO AGENT RUNTIME`  
> Дата: `2026-08-31`  
> Contract version: `1`

## Назначение

Этот контракт закрывает первый проверяемый слой шага 6 дорожной карты до подключения Менеджера к рабочему чату. Он фиксирует интерфейсы ролей, task graph, обмен артефактами, пределы контекста, конфликт решений, critic verdict, checkpoint/recovery boundary и обязательный каталог системных сценариев.

Контракт **не содержит** финальных системных промптов и не активирует ни одного агента. Шаг 7 остаётся отдельной совместной работой с владельцем.

Основания:

- [дорожная карта, шаг 6](../../roadmap/2026-08-24-from-policy-runtime-to-monetizable-release.md);
- [Model Routing and Critic Policy v1](../specifications/model-routing-critic-v1.md);
- [Data Governance Cosmora AI v1](../specifications/data-governance-v1.md);
- [Execution Safety Cosmora AI v1](../specifications/execution-safety-v1.md);
- существующие Agent Studio contracts и Policy Runtime.

## 1. Роли

Runtime знает ровно пять базовых ролей:

- `manager` — планирование, делегирование, checkpoint и арбитраж конфликтов;
- `architect` — архитектурный результат;
- `researcher` — evidence result;
- `analyst` — аналитический результат;
- `critic` — независимая проверка и структурированный critic verdict.

Role contract не является permission contract. Ни одна роль сама по себе не получает права на внешнее действие, выдачу разрешений или обход Policy Engine.

Для всех ролей канонически зафиксировано:

- `project_bound = true`;
- `external_action_authority = false`;
- `permission_authority = false`;
- `policy_bypass = false`.

Финальный текст инструкций роли в этот контракт не входит.

## 2. Task graph

`RuntimeTaskGraph` связывает задачи внутри одного проекта.

Каждый node содержит:

- `task_id` и `project_id`;
- назначенную роль;
- статус;
- зависимости;
- входные artifact IDs;
- ожидаемые типы результата;
- memory scope;
- максимальное число итераций;
- timeout.

Встроенная проверка `validateRuntimeTaskGraph` запрещает:

- дублирующиеся `task_id`;
- node другого проекта;
- отсутствующую root task;
- отсутствующие зависимости;
- self-dependency;
- циклы.

Таким образом, будущий runtime не должен интерпретировать произвольный набор задач как корректный task graph без структурной проверки.

## 3. Артефакты и instruction boundary

Роли обмениваются только типизированными runtime artifacts:

`plan`, `architecture`, `evidence`, `analysis`, `decision`, `critic_verdict`, `handoff`, `checkpoint`.

Артефакт содержит provenance и data class `D0`–`D4`. Его содержимое всегда помечается `instruction_treatment = data_only`.

Это означает: инструкции, найденные внутри web-страницы, файла, evidence bundle, handoff или другого результата, являются данными и не становятся новым уровнем instruction authority. Канонический instruction precedence остаётся отдельным механизмом Agent Studio.

Перед передачей артефакта `validateRuntimeArtifactExchange` сверяет target project и допустимый тип входа принимающей роли. Межпроектная передача не становится допустимой только потому, что один агент уже видел исходный материал.

## 4. Пределы контекста

`RuntimeContextEnvelope` делает контекст явным входом runtime, а не скрытым побочным доступом. Он фиксирует:

- проект, задачу и роль;
- memory scope и разрешённые source/artifact IDs;
- допустимые классы данных;
- лимит входных токенов;
- предел числа артефактов и memory segments;
- отдельные global-memory и cross-project scope IDs;
- `untrusted_instruction_treatment = data_only`;
- `private_chat_persistence = forbidden`.

Валидация запрещает превышать declared context counts. Для `D4_PRIVATE_CHAT` persistent write-back запрещён. `read_mode = none` не может одновременно содержать memory source IDs.

Контракт не выдаёт доступ сам по себе: фактическая авторизация источников остаётся задачей Policy/Data Governance runtime.

## 5. Critic

`CriticVerdict` фиксирует поля из утверждённой critic policy:

- severity `INFO | WARNING | SERIOUS | CRITICAL`;
- scope;
- risk statement;
- evidence;
- uncertainty;
- recommended check;
- rollback;
- pause scope.

`SERIOUS` и `CRITICAL` обязаны остановить затронутую область. `INFO` и `WARNING` сами по себе не имеют права ставить runtime на паузу.

Базовая функция `criticPauseScopeFor` выбирает минимальную область `task`; расширение до `subgraph` или `project` должно быть обосновано фактическим масштабом угрозы и существующими safety rules.

Критик не получает внешних полномочий.

## 6. Конфликт решений

`AgentConflict` хранит минимум две конфликтующие позиции с artifact provenance, текущий статус, результат арбитража и оставшуюся неопределённость.

Конфликт не разрешается скрытой перезаписью одного результата другим. До resolution затронутая задача может быть `blocked`; решение Менеджера должно существовать как отдельный decision artifact.

## 7. Checkpoint и recovery boundary

`RuntimeCheckpoint` может восстанавливать только состояние task graph, ссылки на уже сохранённые артефакты и открытые конфликты выбранного проекта.

Три поля закреплены литералами `false`:

- `restores_permissions`;
- `restores_sessions`;
- `restores_autonomy_escalation`.

Схема закрыта через `additionalProperties = false`, поэтому permission IDs, session tokens или другой скрытый authority state нельзя незаметно вложить в checkpoint. Восстановление проекта не является восстановлением разрешений, интеграционных сессий или A6.

## 8. Обязательные системные сценарии

`MANAGER_RUNTIME_SCENARIOS` покрывает 13 обязательных категорий release gate:

1. `agent_conflict`;
2. `critic`;
3. `memory`;
4. `autonomy`;
5. `emergency_stop`;
6. `model_switch`;
7. `timeout_fallback`;
8. `operation_replay`;
9. `project_recovery`;
10. `prompt_injection`;
11. `memory_poisoning`;
12. `cross_project_leak`;
13. `false_critic`.

Категория `autonomy` представлена семью отдельными gate-векторами — по одному для `A0`, `A1`, `A2`, `A3`, `A4`, `A5` и `A6`. Поэтому наличие одной проверки среднего уровня нельзя ошибочно выдать за покрытие всей шкалы.

Каждый scenario record имеет:

- стабильный `scenario_id`;
- категорию;
- fixture refs;
- конкретный autonomy level;
- структурированные assertions;
- invariant IDs;
- список runtime-инкрементов, для которых он обязателен.

`validateManagerRuntimeScenarioCatalog` fail-closed проверяет обязательные категории, уникальность scenario IDs и полный набор `A0–A6` в autonomy-сценариях.

## 9. Что намеренно не решено этим контрактом

Этот PR не определяет:

- финальный system prompt Менеджера или других ролей;
- activation lifecycle Agent Studio;
- фактическое выполнение task graph;
- новый tool permission model;
- production model/provider;
- автоматическое расширение A0–A6;
- способ UI-представления конфликтов и сценариев.

Все эти пункты должны подключаться позже к этому контракту, а не обходить его.

## 10. Release gate

До runtime-инкремента, использующего Manager/architect/researcher/analyst/critic, соответствующие scenario categories должны быть связаны с автоматическими fixture runners.

Критический сценарий не считается закрытым только потому, что правило записано в Markdown. Источник истины для набора обязательных категорий — типизированный contract + `MANAGER_RUNTIME_SCENARIOS` + fail-closed validators + tests.
