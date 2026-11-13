# DELIVERY — 05_GEMINI, срез B: дубли и противоречия в отчёте

- **Статус:** готово к интеграции.
- **BASE_SHA:** `33f43b8825756d60c67db306783fed9e3de717ee` (main после #557).
- **Ветка:** `ops/gemini-evidence-dedup` (новая; чужой #548 не тронут).
- **PR:** открывается в `main`, без merge/deploy. HEAD_SHA — `git log -1` ветки.
- **Переназначение:** задание именует Gemini; взято по прямому указанию владельца.

## Сценарий до / после

**До.** `research-coordinator.ts` помечал источники с одинаковым SHA-256
полного текста как `duplicate`, но в отчёте `researchMarkdown()` эта информация
никак не раскрывалась: дубликаты выглядели как независимые подтверждения.
`disagreements[]` существовал в ответе модели, но отчёт не фиксировал, что
победитель по большинству дублирующих сайтов не выбран, а противоречие не стёрто.

**После.** В существующем `researchMarkdown()` добавлена секция
«Дубли и противоречия»:

- Группирует `read`-источники по `content_digest`, называет дословно совпавшие
  группы и явно говорит: **это один и тот же текст, а не независимые
  подтверждения**.
- Считает источники со статусом `duplicate` и сообщает, что они не добавляют
  голосов за значение.
- При наличии `answer.disagreements` сообщает число расхождений, что разные
  значения сохранены, **победитель по большинству не выбран** и противоречие не
  стёрто.
- Прямо называет сопоставление значений структурной эвристикой по числу,
  единице и доверенному снимку, **а не семантическим доказательством истинности**.
- При отсутствии дублей честно говорит, что это не доказывает независимость.

Второго store, нового runtime, платных вызовов и изменений чужих файлов нет.

## Entrypoint

```
ResearchCoordinator (уже помечает duplicate по SHA-256)
  → ResearchRun.sources[].content_digest / status
  → researchMarkdown(run) → сохранённый отчёт / export
```

Не helper-only: блок входит в реальный Markdown-отчёт, который сохраняется и
экспортируется существующими research-роутами.

## Изменённые файлы

| Файл                                                                                                      | Изменение                                          |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `packages/core/src/research/index.ts`                                                                     | секция «Дубли и противоречия» в `researchMarkdown` |
| `packages/core/test/research-dedup-report.test.ts`                                                        | **новый** 5 тестов                                 |
| `docs/team/.../deliveries/05_GEMINI/{BACKLOG_DEDUP,CHECKPOINT_DEDUP,DELIVERY_DEDUP,INTEGRATION_DEDUP}.md` | отчёты                                             |

## Команды и фактические результаты

```
packages/core новый файл 5/5 · полный 419 passed (39 файлов)
apps/api research-workflow + report-export 10 passed (в т.ч. restart)
typecheck/lint core/api · prettier --check . · check:secrets — green
```

## Миграции / зависимости

Нет. Live Chromium/CDP и провайдер не вызывались.

## Полномочия и границы

Не менялись chat/sidebar/global CSS, gateway/credits, provider keys, тарифы,
OS-права, Work runtime, чужие ветки. Restart/cancel/owner-project isolation и
privacy lifecycle сохранены (проверено research-workflow.test.ts).
Multi-Agent/VPS/production/merge — не выполнялись.

## Ограничения

- Противоречия пока отражены счётчиком и формулировкой, без перечисления самих
  разных значений с единицами — срез C.
- Эвристика структурная; `claim_assessment=verified` из среза A означает
  согласованность с доверенной выдержкой, не истину.
- Живая приёмка на реальном Chromium/VPS отложена по `AGENTS.md`.

## Следующий шаг

Срез C: snapshots (дайджест + `checked_at`/версия), bounded research по
`RESEARCH_LIMITS`, contradictions с явным перечислением разных значений и единиц.
Через те же store/coordinator/synthesis, без второго store. Точка — CHECKPOINT_DEDUP.md.
