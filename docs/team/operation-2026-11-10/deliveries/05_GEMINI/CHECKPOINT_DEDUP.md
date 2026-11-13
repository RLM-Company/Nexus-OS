# CHECKPOINT — 05_GEMINI, срез B

- **Обновлено:** срез A смержен (#557, `33f43b8`), срез B готов к интеграции.
- **BASE_SHA:** `33f43b8825756d60c67db306783fed9e3de717ee`.
- **Ветка:** `ops/gemini-evidence-dedup`.
- **PR:** открывается в `main`, без merge/deploy. HEAD_SHA — `git log -1` ветки.
- **Фонового процесса нет.**

## Выполнено

- **Срез A (PR #557, MERGED):** `verifyResearchClaim()` — привязка к доверенному
  снимку/версии/digest, числа с границами и единицей, разделение
  `source_quote_verified` и `claim_assessment`, 8 регрессий на false-positive.
- **Срез B (этот PR):** секция «Дубли и противоречия» в `researchMarkdown()` —
  дубли контента не считаются независимыми подтверждениями, победитель по
  большинству не выбирается, противоречия не стираются, эвристика не называется
  семантическим доказательством. 5 тестов.

## Проверки

```
core полный 419 passed (39 файлов) · новый 5/5
api research 10 passed (в т.ч. restart)
typecheck/lint core/api · prettier --check . · check:secrets — green
```

## Точка продолжения (срез C)

- Snapshots: сохраняемый дайджест + `checked_at` / версия страницы, чтобы отчёт
  ссылался на конкретный снимок, а не только на URL.
- Bounded research: явно показывать достигнутые `RESEARCH_LIMITS`
  (maxSources/maxCandidates/maxAttempts/maxRunMilliseconds) и честный обрыв.
- Contradictions: перечислять разные значения с единицами, а не только счётчик.
- Всё через те же `research-store`/`coordinator`/`synthesis`, без второго store.
- Обязательно: не трогать chat/sidebar/global CSS, gateway/credits, provider
  keys, OS-права, чужие ветки (#548); общие hooks — отдельный маленький commit.
- Известно: `\b` не работает с кириллицей; проверку неоднозначности ставить ДО
  сравнения с выдержкой.

## Правила

Статус не выше «готово к интеграции». Отчёты только в своём каталоге. Внешние
зависимости — фикстуры. Не читать .env/токены/БД пользователей; не слать
сообщения, не публиковать, не merger без указания, не VPS, не обучать веса, не
включать Multi-Agent/Jarvis.
