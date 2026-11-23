# Матрица переходов планов и таймеров Koswork (кандидат #624)

База: `origin/pr-624-head` @ `8fd653ea89bb0f78c9847d965319cb85b2072d1e`.
Ветка: `codex/koswork-plan-timers-624`.
Зона: поведение планов и таймеров в связке #619 (проектор событий) → #623 (карточка) → #624 (общий кандидат, чатная панель `chat-task-plan`).

## Сквозная задача

Цель: «Подготовить отчёт по проекту». Три зависимых шага:
`a` «Собрать данные» → `b` «Написать отчёт» (depends_on a) → `c` «Проверить» (depends_on b).
Одно уточнение с выбором варианта на шаге `a`, одно уточнение со свободным ответом/пропуском на шаге `b`.

## Матрица

| #   | Событие / действие                  | Ожидаемый progress                | Активный шаг  | Таймер                            | Источник события                      | Факт в #624                                                        | Вердикт                        |
| --- | ----------------------------------- | --------------------------------- | ------------- | --------------------------------- | ------------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| 1   | `announceChatTaskPlan`              | `queued`                          | `null`        | все «—»                           | CustomEvent, не модель                | панель создаётся, активного нет                                    | OK                             |
| 2   | `run.started`                       | `running`                         | `a`           | model открыт                      | SSE `run.started`                     | подхват первого pending-шага                                       | OK                             |
| 3   | уточнение с вариантом (думаем/ждём) | `await_owner`                     | `a`           | await_owner                       | `kosmora:clarification` → answer/skip | событие `await_owner` описано, но **не испускается** из `page.tsx` | GAP-1                          |
| 4   | уточнение свободным ответом         | `await_owner`                     | `a`           | await_owner закрывается по ответу | тот же канал                          | ответ карточки не закрывает интервал                               | GAP-1                          |
| 5   | optional skip                       | `running`                         | `a`           | нет await_owner                   | `skipClarification`                   | ackers status `skipped`, но план не знает                          | GAP-1                          |
| 6   | `message.delta`                     | `running`                         | `a`           | model                             | SSE `message.delta`                   | OK                                                                 | OK                             |
| 7   | `tool`                              | `running`                         | `a`           | tool                              | Model Gateway `tool.call`             | событие есть в типе, нет emit в `page.tsx`                         | GAP-2                          |
| 8   | `pause`                             | `await_owner`                     | `a` (paused)  | pause                             | управление Koswork                    | `pauseActiveStep` ставит `blocked`                                 | **REG-1**                      |
| 9   | `resume`                            | `running`                         | `a`           | pause закрыт                      | управление Koswork                    | `resumeActiveStep` снимает `blocked`, включая ошибку               | **REG-1**                      |
| 10  | блокировка разрешений               | `await_owner`                     | `a` (blocked) | await_owner                       | `WAITING_CONFIRMATION`/`step-up`      | `blocked` не различает причину                                     | **REG-2**                      |
| 11  | `run.failed`                        | `closed`                          | `null`        | интервал закрыт                   | SSE `run.failed`                      | шаг `blocked`, актив снят                                          | OK (но причина не сохраняется) |
| 12  | `run.completed`                     | `running`                         | `b`           | model                             | SSE `run.completed`                   | `next.status = "running"` без `started_at`                         | **REG-3**                      |
| 13  | повторный `run.started`             | без изменений                     | `b`           | без изменений                     | SSE                                   | `startStep` refuse при active                                      | OK                             |
| 14  | `run.cancelled`                     | `closed`                          | `null`        | —                                 | SSE                                   | OK                                                                 | OK                             |
| 15  | перезагрузка на любом шаге          | совпадает с сервером/LocalStorage | см. above     | сохранённые интервалы             | `readChatTaskPlan`                    | цель/актив/статус восстанавливаются                                | OK (кроме REG-3)               |

## Найденные регрессии

- **REG-1** Пауза и ошибка/`blocked`使用一个 статус. Восстановление после перезагрузки не различает «на паузе» и «заблокирован разрешением», а `resumeActiveStep` может снять блокировку ошибки.
- **REG-2** Нет отдельной причины блокировки/ожидания разрешения; интервал `await_owner` не привязан к шагу.
- **REG-3** Автопродвинутый шаг получает `status: running`, но `started_at: null`; в панели время шага показывает «—» вместо «идёт», а интервалы нельзя сверить с `run.completed`.
- **GAP-1** Уточнение (`kosmora:clarification`) не испускает событие плана; после answer/skip активный шаг не продолжается.
- **GAP-2** Нет emit события `tool`, хотя `TimingKind` включает инструменты; данные честно остаются «—». Проверено по контракту: `packages/contracts/src/events.ts` (`StreamEventSchema`) содержит только `run.started`, `message.started`, `message.delta`, `message.completed`, `run.completed`, `run.failed`, `run.cancelled`, `heartbeat`. Ни `tool.call`, ни `queued` в чатный SSE не приходят, поэтому подключить их нельзя без расширения серверного контракта — вне зоны этого прохода. Панель теперь явно показывает «нет события: tool.call / queued» рядом с прочерком.

## Результаты локальной проверки (точный базовый SHA)

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --experimental-strip-types scripts/test/koswork-plan-timers-624.local.mjs
  → ALL 8 checks passed, exit 0

apps/web: node ../../node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json
  → exit 0

apps/web: node ../../node_modules/prettier/bin/prettier.cjs --check <изменённые файлы>
  → All matched files use Prettier code style!, exit 0
```

Vitest/e2e локально не запускаются: sandbox блокирует дочерний `spawn` (EPERM)
в `vite`/`rolldown`, а пост-install скрипты нативных пакетов (`esbuild`) создают
тот же EPERM. Те же проверки продублированы в unit-тестах
(`apps/web/src/app/chat-task-plan.test.ts`) и e2e
(`apps/web/e2e/chat-task-plan.spec.ts`); локально использован прямой
прогон чистого автомата через Node 24.

### CI PR #627

После точечных правок (форматирование новых файлов, lint-ошибки в тесте,
честная подпись отсутствующих событий `tool.call`/`queued`) все проверки CI на
`c4490c3090f8ee6b541660a41dd7b85a5f9505df` зелёные:

| Check                  | Результат |
| ---------------------- | --------- |
| Verify monorepo        | SUCCESS   |
| Browser acceptance     | SUCCESS   |
| Code sandbox isolation | SUCCESS   |

Локально дополнительно: `eslint` на всех изменённых файлах — 0,
`prettier --check .` — 0, `tsc --noEmit` — 0.

## Принципы правки

1. Не добавлять второй планировщик и фоновый таймер: все переходы через существующие CustomEvent/SSE.
2. Не запускать модель скрытно: следующий шаг подхватывается только на `run.started`.
3. Не выдумывать метрики: если события `queue`/`tool` нет, счётчик остаётся «—».
4. Сохранить UI_RULES: панель уже согласована, правки только в её state/логике и тестах.
