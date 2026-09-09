# Многоуровневая project memory

**Исходная дата идеи:** 2026-08-23  
**Текущий статус:** `DISCOVERY`

## Исходная идея

Хранить project context не одним бесконечным transcript, а несколькими слоями с разной долговечностью и возможностью сегментного восстановления.

## Цель

Система должна удерживать долгосрочный проектный контекст при тысячах сообщений и artifacts, не позволяя старому, poisoned или deprecated контенту незаметно становиться новой authority.

## Возможное направление

Будущая спецификация может разделять, например:

- immutable project facts / owner decisions;
- active working memory;
- task/run-local context;
- artifact-derived knowledge;
- archived/deprecated facts;
- quarantined/untrusted retrieved content.

Это не утверждённая схема хранения и не описание текущей БД.

## Обязательные вопросы discovery

- provenance каждого memory fact;
- conflict/staleness resolution;
- owner-visible correction/deprecation;
- data classification и project isolation;
- prompt-injection / memory-poisoning quarantine;
- context selection при token limits;
- какие facts считаются safety-critical/pinned;
- checkpoint semantics без восстановления старой authority;
- экспорт/удаление/retention.

## Safety boundary

Retrieved instructions из web/files/tools не должны автоматически становиться executable instructions или Policy rules. Memory ingestion обязана сохранять distinction между data, owner decisions и authority-bearing contracts.
