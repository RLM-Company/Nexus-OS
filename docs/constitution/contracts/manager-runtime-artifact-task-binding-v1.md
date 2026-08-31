# Manager Runtime Artifact Task Binding v1

> Статус: `SEMANTIC ARTIFACT BINDING / NO RUNTIME AUTHORITY`  
> Дата: `2026-08-31`  
> Verification target: `main@919e117092512d06bf685d4addf4dd4c939f7a95`

## Назначение

`RuntimeArtifactSchema` проверяет форму артефакта, а provenance validator — замкнутость связей между артефактами. Этого недостаточно, чтобы доказать, что результат действительно принадлежит объявленной задаче и роли.

`validateRuntimeArtifactTaskBinding` связывает один артефакт с его `RuntimeTaskGraph` до передачи результата следующему runtime-слою.

## Инварианты

Валидатор fail-closed требует:

- семантически корректный task graph;
- совпадение project boundary артефакта, graph и task;
- существование `artifact.task_id` внутри graph;
- совпадение `producer_role` с назначенной task role;
- присутствие artifact kind в `expected_output_kinds` задачи;
- право роли emit-ить этот artifact kind по каноническому role contract;
- объявление каждого `source_artifact_id` во входах задачи;
- создание артефакта не раньше graph и task, с хронологией по parsed UTC instant.

## Композиция валидаторов

Task binding не заменяет provenance graph validation, context materialization, artifact exchange validation или schema validation. Перед runtime-использованием применимые границы должны пройти независимо.

## Граница полномочий

Валидатор не загружает payload, не выполняет task, не запускает Manager/agents/models/tools, не выдаёт permission, не меняет A0–A6 и не создаёт внешние эффекты. Он возвращает только semantic issues.
