# DELIVERY — 05_GEMINI (переназначено владельцем), срез A

- **Статус:** готово к интеграции (дальнейшие статусы подтверждает Codex).
- **BASE_SHA:** `1c07f8dc291b38d0faf92088c53e704e348d0256` (актуальный `main`).
- **Ветка:** `ops/gemini-evidence-rework` (новая; активный чужой PR #548 не тронут, пересечения файлов нет).
- **PR:** открывается в `main`, без merge/deploy.
- **HEAD_SHA:** см. `git log -1` ветки / CHECKPOINT.md.
- **Переназначение:** `05_GEMINI.md` именует Gemini; взято по прямому указанию владельца.

## Сценарий до / после

**До.** `parseResearchAnswer()` проверял только, что ссылка `[S1:E1]` существует
в `researchEvidence(run)`. Не было проверки, что цитата из **доверенного снимка**
подтверждает конкретное утверждение: REWORK_TASK воспроизвёл три false-positive
— «50» из «5000 рублей», цитата про Beta для Alpha, расхождение версии страницы.
Неприменимый patch `reference/gemini-operation-20261110` (`b992e639`) объявлял
существующие файлы `new file` и не интегрирован; второго store не создавалось.

**После.** В существующем `packages/core/src/research/index.ts` добавлен
`verifyResearchClaim()`:

- Привязка к доверенным `source_id`/`excerpt_id`, версии страницы и digest
  снимка; данные клиента/модели не могут объявить себя доверенным снимком.
- Числа сравниваются **с границами и единицей**: «50» не считается совпадением
  с «5000 рублей», «50 рублей» ≠ «50 долларов». Умножения на 1000/1024/12 без
  известной размерности нет.
- Явное разделение `source_quote_verified` (цитата есть) и `claim_assessment`
  (`verified | unconfirmed | refuted`). При отрицании, неоднозначном субъекте,
  единице или версии — `unconfirmed`, никогда `verified`.
- `researchMarkdown()` — существующий entrypoint отчёта — теперь явно сообщает,
  что ссылки означают только существование цитаты, а не истинность утверждения.

## Entrypoint

```
POST /api/v1/research/runs → ResearchCoordinator → researchEvidence(run)
  → parseResearchAnswer (ссылки) + verifyResearchClaim (доверенный снимок)
  → researchMarkdown / researchHtml → отчёт с честным статусом
```

Не helper-only: проверка доступна из продуктового модуля отчёта и его экспорта.
Провайдер не вызывался; все проверки на scoped fixtures и in-memory данных.

## Изменённые файлы

| Файл                                                                              | Изменение                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/core/src/research/index.ts`                                             | `verifyResearchClaim`, типы, строка честности в `researchMarkdown` |
| `packages/core/test/research-claim-evidence.test.ts`                              | **новый** 8 тестов                                                 |
| `docs/team/.../deliveries/05_GEMINI/{BACKLOG,CHECKPOINT,DELIVERY,INTEGRATION}.md` | отчёты                                                             |

## Команды и фактические результаты

```
packages/core новый файл                  8 passed
packages/core полный vitest             414 passed (38 файлов)
apps/api research-workflow + export     10 passed
typecheck/lint core/api/web · prettier --check . · check:secrets — green
```

Отрицательные регрессии покрывают три случая из REWORK_TASK плюс подмену digest,
неверную единицу и отрицание. Два падения по ходу исправлены содержательно:
проверка отрицания стояла **после** `excerpt.includes(claim_text)` (перенесена
до), и `\b` не работает с кириллицей (заменено на `(?<!\p{L})…(?!\p{L})`).
Продуктовый код в этих местах менялся по существу, а не «перезапуском».

## Миграции / зависимости

Нет миграций, новых зависимостей и изменений схемы. Live Chromium/CDP и платные
вызовы не выполнялись.

## Полномочия и границы

Не менялись chat/sidebar/logo/global CSS, gateway/credits, provider keys,
тарифы/квоты, OS-права, grants, Work runtime и чужие ветки (#548). Restart,
cancel, owner/project isolation и privacy lifecycle существующего Research
runtime сохранены (проверено `research-workflow.test.ts`, в т.ч. restart).
Multi-Agent/Jarvis/VPS/production/merge — не выполнялись.

## Несовместимости / ограничения

- `verifyResearchClaim` — явная проверка одного утверждения; массовая
  верификация всех claims отчёта и contradictions — следующий срез.
- Эвристика проверяет **структуру доказательства** (число/единица/субъект/
  версия), а не семантическую истину. `claim_assessment=verified` означает
  «утверждение согласовано с доверенной выдержкой», а не «факт истинен».
- Живая приёмка на реальном Chromium, VPS и Windows-клиенте остаётся отложенной
  по `AGENTS.md`.

## Что ещё не проверено живьём

Реальный Chromium/CDP, живой провайдер, contradictory sources на живых сайтах,
замеры latency.

## Следующий шаг

Срез B: snapshots/dedup/bounded research/contradictions через те же
`research-store`/`coordinator`/`synthesis` — не выбирать победившее значение по
большинству дублирующих сайтов, не стирать противоречия, не называть эвристику
семантическим доказательством. Точка продолжения — CHECKPOINT.md.
