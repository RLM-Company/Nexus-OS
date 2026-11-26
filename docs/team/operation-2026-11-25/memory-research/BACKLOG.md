# BACKLOG — память и проверяемость исследования (новая петля)

База: main `e6736e0`. Ветка `ops/deepseek-memory-research-loop`, изолированный worktree
`memory-research-loop`. Исходная зона: `docs/team/operation-2026-11-10/04_DEEPSEEK.md`
(память, контекст, качество извлечения); research-часть пересекается с
`05_GEMINI.md`, общие контракты/Квитанции — с OpenCode №1 (интегратор).

## Что уже работает (не дублировать)

- `resolve()/fuseSemantic()/semanticSource()`: expiry, owner/project scope, `answer_evidence`.
- `memory-answer-evidence.test.ts`: matched / absent / disabled / contradiction / forget /
  revoke / cross-owner / async fence (9 сценариев).
- `memory-restart-expiry.test.ts`: expired и forgotten не возвращаются после реального
  reopen SQLite.
- `ContextMemoryEntry.expired`, UI-метка, срез D (#533).
- `verifyResearchClaim()` отделяет `source_quote_verified` от `claim_assessment`.
- `parseResearchAnswer()` проверяет citation только по реальным `S:E` из trusted read.
- research report показывает снимки с digest и checked_at.

## Незавершённое по новому поручению

1. **[P0] Квитанция источника на уровне утверждения.** Citation `{source_id, excerpt_id}`
   не несёт дату проверки, URL, digest снимка, SHA выдержки и позицию. Потребитель
   обязан делать join и может потерять связь. Нужен формат, согласованный с OpenCode №1.
2. **[P0] Длинный сценарий: обновление материалов + продолжение после перезагрузки.**
   Нужна одна воспроизводимая цепочка: исследование с расхождением → проверенная
   квитанция → факт в памяти → обновление/recipes → reopen SQLite → следующая задача
   видит актуальную версию, а не старый summary.
3. **[P1] Новый факт меняет направление исследования.** После подтверждённого
   противоречия следующий запрос должен быть уточнён, без скрытого повтора старого.

## Приоритет и порядок срезов

- Срез 1 (сделано): `researchSourceReceipts()` — формат `kosmora.source-receipt.v1`,
  привязка утверждения к точной выдержке, дате, URL, digest и SHA; неподтверждённые
  citation не дают квитанцию.
- Срез 2: длинный сценарий памяти с обновлением материалов и reopen; затем срез 3 —
  смена направления исследования по новому факту.

## Границы

Не трогать тарифы/квоты/права, gateway, Multi-Agent, VPS, общий UI. Общие схемы
контрактов и пересечения файлов перечислять в INTEGRATION.md для Codex/OpenCode №1.
Фикстурные проверки отделять от живых; живые не заявлять без стенда.
