# Project checkpoints и Decision Trace

**Исходная дата идеи:** 2026-08-23  
**Текущий статус:** `PARTIALLY_IMPLEMENTED`

## Исходная идея

Проекты должны иметь автоматические/ручные checkpoints, восстановление/ветвление состояния и прозрачное объяснение того, что делала система, без публикации скрытых внутренних рассуждений модели.

## Что уже стало архитектурным направлением

В текущем Cosmora существуют отдельные contracts/сценарии для runtime checkpoints, recovery и Decision Trace/policy trace. Поэтому эта запись больше не является источником истины для их семантики.

Ключевой уже утверждённый принцип восстановления:

`Current Authority > Historical Runtime State`

Checkpoint не должен возвращать revoked permissions, expired grants, старые approvals, OAuth state или более высокий autonomy level.

Decision Trace должен показывать наблюдаемые факты, actions, artifacts, policy reasons и provenance, но не скрытую chain-of-thought.

## Что ещё шире текущей реализации

Изначальная продуктовая идея также предполагает:

- manual checkpoint UX;
- понятную timeline/history;
- branching проекта;
- сравнение веток;
- восстановление artifacts/tasks/memory state;
- «где мы остановились?» после долгого перерыва;
- non-destructive restore с сохранением истории;
- различие rollback внутреннего состояния и compensation реальных external effects.

Эти элементы должны входить в roadmap отдельно и не считаться полностью реализованными только из-за наличия runtime checkpoint contracts.

## Safety invariant

Rollback project state никогда не означает автоматический rollback внешнего мира. Уже совершённые external effects должны проходить модель `cancel if possible / compensate if supported / report residual effects`.
