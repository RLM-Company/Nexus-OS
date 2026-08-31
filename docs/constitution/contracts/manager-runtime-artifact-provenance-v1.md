# Manager Runtime Artifact Provenance v1

> Статус: `SEMANTIC PROVENANCE VALIDATION / NO RUNTIME AUTHORITY`  
> Дата: `2026-08-31`  
> Verification target: `main@163683438536fab9d19d260020cc681dec8e78cd`

## Назначение

`RuntimeArtifact` уже хранит `source_artifact_ids`, но структурной схемы недостаточно для доказательства корректного происхождения. `validateRuntimeArtifactProvenance` проверяет замкнутый набор артефактов проекта как provenance graph.

## Инварианты

Валидатор требует:

- уникальный `artifact_id`;
- принадлежность каждого артефакта ожидаемому проекту;
- каждый `source_artifact_id` должен существовать в переданном наборе;
- артефакт не может ссылаться на себя;
- provenance не может пересекать project boundary;
- источник не может быть создан позже производного артефакта;
- граф происхождения должен быть ацикличным.

## Граница полномочий

Валидатор не загружает payload, не создаёт и не меняет артефакты, не запускает Manager/agents/models/tools, не выдаёт permissions, не изменяет A0–A6 и не создаёт внешние эффекты. Он возвращает только список semantic issues.
