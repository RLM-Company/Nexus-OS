# Manager Runtime Context Materialization v1

> Статус: `DETERMINISTIC CONTEXT BOUNDARY / NO RUNTIME EXECUTION`  
> Дата: `2026-08-31`

## Назначение

`RuntimeContextEnvelope` задаёт допустимый контекст задачи. Материализация — отдельная проверка того, что фактически переданные задаче артефакты и memory-ссылки не расширяют этот контракт.

## Инварианты

`validateRuntimeContextMaterialization` требует:

- совпадение `project_id`, `task_id` и роли envelope с задачей;
- совпадение `read_mode` и `write_back` с task contract;
- memory source IDs envelope могут только сужать список, объявленный задачей;
- набор фактически материализованных artifact IDs точно соответствует `artifact_ids` envelope;
- каждый artifact остаётся в проекте envelope;
- data class каждого artifact присутствует в `allowed_data_classes`;
- artifact source IDs не выходят за `source_ids` envelope;
- artifact не может ссылаться на себя как на provenance;
- базовые лимиты envelope и запрет D4 write-back сохраняются.

## Что валидатор не делает

Он не загружает память или artifacts, не запускает Manager/агентов, не вызывает модель или tool, не выдаёт permissions и не меняет Policy Runtime. Его вход — уже подготовленные typed objects; результат — только массив semantic issues.

## Fail-closed применение

Будущий runtime обязан считать любую issue причиной отказа от materialization. Исправление envelope или task contract должно происходить отдельным контролируемым действием, а не автоматическим расширением доступа.
