# Cosmora — полный контекст переписки и handoff

**Дата среза:** 2026-09-08  
**Репозиторий:** `RLM-Company/Nexus-OS`  
**Проект:** Cosmora (ранее Nexus / Synmetis / Astration)  
**Назначение файла:** дать новому Work-чату максимально полный контекст предыдущей работы, включая решения, перенесённые пользователем из других чатов, текущую архитектуру, ограничения, историю PR/CI, Gemini-пакеты и незавершённые задачи.

> Это не дословный экспорт каждого сообщения. Это канонический конспект всей доступной переписки по проекту, включая сведения, которые пользователь ранее переносил из других чатов. Значения секретов, API-ключей и токенов намеренно не записываются. Если содержание этого файла конфликтует с актуальным кодом `main`, код и действующие контракты репозитория имеют приоритет; если конфликт касается продуктового правила, требуется решение владельца.

---

## 1. Как владелец хочет работать

Пользователь не программист и просит объяснять состояние проекта простым языком, когда это нужно. При этом режим работы проекта максимально автономный:

- «делай всё, что можешь сам; позовёшь, когда нужен микроменеджмент»;
- безопасные PR можно готовить и сливать автономно, если полный CI зелёный и изменения не нарушают утверждённые границы;
- не нужно постоянно спрашивать подтверждение на обычные изменения кода, тесты, документацию и безопасный рефакторинг;
- пользователь хочет как можно скорее получить **реально работающую Manager Console**, чтобы разговаривать со своим Manager и дальше развивать проект уже через него;
- финальные стратегические/опасные решения, production-provider, A6 activation, реальные финансовые/внешние эффекты и финальный system prompt Manager не принимать самовольно.

Основная рабочая установка: **двигаться до лимитов инструментов и останавливаться только когда реально нужен владелец или нельзя безопасно продолжать.**

---

## 2. Что такое Cosmora

Cosmora — AI-платформа / AI OS с мультиагентной архитектурой. Первые названия проекта: Nexus OS → Synmetis → Astration → Cosmora.

Целевая идея продукта:

- один владелец/пользователь работает с центральным **Manager**;
- Manager понимает проект, строит план, делегирует задачи агентам, отслеживает состояние, артефакты, решения и ошибки;
- система умеет работать с проектами долго: дни, недели, месяцы;
- действия контролируются уровнем автономности и серверным Policy Engine;
- пользователь должен видеть понятные результаты и Decision Trace, но не скрытую chain-of-thought;
- продукт должен уметь расти от обычного AI-чата до полноценного рабочего окружения с агентами, файлами, интеграциями, браузером/компьютером и внешними действиями;
- отдельные направления продукта, обсуждавшиеся ранее: deep research, images, animation, presentations, websites, project folders/shared project memory, обучение в чате, сбор данных из Telegram, сложные проекты и корпоративные интеграции.

Бизнес-цель владельца обсуждалась как создание продукта с потенциалом выйти примерно на 1 млн чистой прибыли в горизонте 1–1.5 года, стартуя с очень малого бюджета. Тарифы и монетизацию намеренно отложили до стабилизации функции продукта.

---

## 3. Архитектурная концепция

Каноническая архитектура включает минимум следующие блоки:

1. **UI / Control Center / Manager Console**
   - project sidebar;
   - Manager Chat;
   - статус текущего run;
   - Project Status;
   - approvals / owner decisions;
   - recovery;
   - artifacts;
   - Decision Trace;
   - переходы в Control Center и Agent Studio.

2. **Orchestrator / Runtime / State machine**
   - task graph;
   - run lifecycle;
   - checkpoints;
   - recovery;
   - delegation;
   - conflict handling;
   - Critic;
   - deterministic validation/release gates.

3. **Model Gateway / Registry**
   - единый шлюз к моделям;
   - provider routing;
   - fallback;
   - model registry;
   - usage/cost accounting;
   - текущий production provider не выбран.

4. **Policy Engine**
   - серверный источник истины по полномочиям;
   - A0–A6;
   - grants / overrides / step-up;
   - emergency stop;
   - operation-level enforcement;
   - fail-closed.

5. **Agent Studio / Agent Runtime**
   - роли/паттерны/blueprints;
   - конфигурация агентов;
   - delegated grants;
   - агенты не должны расширять права сами.

6. **Persistence / Project memory / Artifacts / Provenance**
   - проекты;
   - main chat;
   - messages;
   - runs;
   - artifacts;
   - provenance;
   - checkpoints;
   - usage ledger;
   - policy state.

---

## 4. Утверждённые принципы автономности A0–A6

В проекте есть уровни автономности **A0–A6**. Важно: уровни регулируют **полномочия и реальные эффекты**, а не интеллект модели. A0 всё ещё может хорошо анализировать, писать, планировать и объяснять; ограничения касаются доступа и действий.

### A0

Базовый уровень. Минимум внешних возможностей. Без свободного доступа к вебу/интеграциям/записи и внешним эффектам, если capability не разрешена отдельно.

### A1

Локальный/project context + web read в разрешённых рамках. История чата/файлы проекта. Не считать автоматически, что A1 даёт persistent `workspace.write` — это отдельная capability.

### A2

Интеграции. Ключевая идея: **одно подтверждение/подключение интеграции** может разрешить дальнейшую scoped-работу в границах grant. Нельзя превращать A2 в «каждый безопасный commit требует подтверждения».

### A3

Внешние кампании / коммуникации.

Утверждённая логика:

- одно разрешение на кампанию/задачу;
- Manager может адаптировать сообщения внутри утверждённого scope;
- новые обещания/условия — согласовываются;
- аудитория утверждается;
- новые адресаты вне scope требуют отдельного решения;
- встречи/демо может назначать в пределах разрешения, изменения условий — согласовывать;
- новые аккаунты — отдельное подтверждение (в A3);
- файлы кампании можно обрабатывать автоматически, конфиденциальные данные — отдельно;
- коммерческие условия — только в утверждённом диапазоне;
- итоговые договорённости утверждает владелец;
- отчёт после действий.

### A4

Финансы.

Утверждённые идеи:

- работа внутри бюджета;
- лимиты и уведомления (раньше обсуждались 50/20/10% остатка как продуктовая идея, но конкретные пороги должны подтверждаться контрактами/кодом);
- кредиты/заём — нет без отдельного решения;
- возвраты — подтверждение;
- новая подписка — подтверждение;
- продление уже утверждённой подписки может быть автоматическим;
- отмена/понижение подписки — можно с отчётом;
- налоги/зарплаты — по графику, если заранее утверждено;
- подозрение на мошенничество → блок операции;
- перераспределение внутри утверждённого бюджета возможно;
- инвестиции — только по подтверждению;
- конвертация валюты может быть разрешена в рамках бюджета;
- выручку система фиксирует, но не «присваивает» себе право распоряжаться ей.

### A5

Project mandate.

Это уровень высокой автономности в рамках утверждённого паспорта проекта и бюджета.

Ключевые правила:

- **тактика — свободно внутри mandate; стратегия — owner decision**;
- A5 не должен нигде быть менее свободным, чем A4;
- при strategy change не нужно автоматически переходить на A6: корректная модель `A5 -> WAITING_OWNER_DECISION -> A5`;
- команда агентов — свободно в разрешённых рамках;
- подрядчики — из утверждённого списка;
- эксперименты — внутри цели/бюджета;
- первый релиз может требовать подтверждения, последующие — автоматом в утверждённой политике;
- критический откат разрешён/ожидаем;
- новые аккаунты на A5 могут создаваться в рамках mandate, если policy допускает;
- стандартные условия сервисов могут приниматься автоматически, особые/платные — подтверждение;
- финальные договорённости утверждает владелец;
- stop events: исчерпание бюджета/срока, риск закона/платформ, утечка, критическое отклонение KPI.

**Ключевой invariant:** `more autonomy != larger financial ceiling`. Project mandate не отменяет финансовый ceiling.

### A6

Максимальная автономность.

- A6 не означает «нет безопасности»;
- A6 не может обходить hard security boundaries;
- A6 activation всегда требует обязательный server-side step-up;
- никакого режима `A6 step-up bypass` не существует и не должно появиться;
- emergency stop и revocation продолжают работать;
- ограничения можно точечно снимать только через утверждённый механизм владельца, а не client-side bypass.

---

## 5. Capability / approval / delegation invariants

Эти правила считаются особенно важными:

- `approval != autonomy level upgrade`;
- разрешение оценивается как `capability + scope + current grant + operation`;
- client UI не может сам повысить права;
- server Policy Engine authoritative;
- delegated grant проверяется server-side;
- `child_grant ⊆ parent_delegated_grant`;
- sub-agent запрашивает **capability**, а не «дай A4»;
- fallback model меняет модель, но не полномочия;
- текущие permissions/grants всегда важнее checkpoint;
- revoked grant нельзя «воскресить» через resume/rollback;
- generating content ≠ executing effect;
- например, сгенерировать destructive SQL — не то же самое, что выполнить его в production DB;
- Critic не является security perimeter: schema validation / provenance / policy / executor boundary должны оставаться безопасными даже при ошибке Critic;
- обязательные Critic/release gates нельзя отключить обычным client-side override;
- Policy Engine должен быть fail-closed.

---

## 6. Checkpoint / rollback / recovery semantics

Утверждённый принцип:

`Current Authority > Historical Runtime State`

Checkpoint может восстанавливать project/runtime data, но **не должен восстанавливать старые полномочия**.

При Resume действуют текущие:

- autonomy profile;
- grants;
- revocations;
- OAuth/integration authorization state;
- budgets;
- emergency-stop state;
- server policy.

Rollback не должен стирать audit/history.

Emergency Stop нельзя моделировать как обещание полного rollback внешнего мира. Правильная семантика:

1. `STOP NEW EFFECTS` — немедленно;
2. `CANCEL IN-FLIGHT EFFECTS IF POSSIBLE`;
3. `COMPENSATE IF SUPPORTED AND AUTHORIZED`;
4. `REPORT RESIDUAL EFFECTS` — обязательно показать необратимые эффекты.

Отправленное письмо, завершённая транзакция или иной внешний effect могут быть необратимы.

---

## 7. Decision Trace / UX transparency

Пользователь должен видеть наблюдаемое состояние, но не скрытую chain-of-thought.

Подходящие статусы/UX-сигналы:

- Анализ задачи;
- Планирование;
- Работа агентов;
- Сборка результата;
- Waiting Approval / Waiting Owner Decision;
- Policy Block;
- Recovery;
- Completed / Failed / Cancelled.

Decision Trace показывает:

- факты;
- действия;
- артефакты;
- причины policy decisions;
- provenance;
- модели/agents/attempts, если это полезно;
- но не внутреннюю скрытую reasoning chain.

UI не должен придумывать `Completed`: server остаётся источником истины.

ETA нельзя выдумывать. Для долгих задач лучше показывать elapsed time, этапы, активных агентов, завершённые шаги и observable progress.

---

## 8. Agent Studio и ADR

ADR-004 закрепляет модульный Agent Studio/control plane.

Ранее были реализованы/обсуждались:

- proposal-only controls;
- versioned catalog editor;
- behavior pattern archive;
- blueprint composer;
- manager runtime contracts/scenarios/state;
- deterministic scenario runner;
- context materialization validation;
- checkpoint semantic validation;
- task readiness;
- runtime release gates;
- Control Center.

Blueprint/proposal остаётся inert до отдельной активации/runtime increment. Нельзя считать, что создание blueprint автоматически создаёт живого агента с реальными правами.

---

## 9. Step 6 / Step 7 roadmap

Исходный roadmap: `docs/roadmap/2026-08-24-from-policy-runtime-to-monetizable-release.md`.

### Step 6

Формальные runtime contracts + scenario gates до полного реального Manager.

Минимальные роли:

- manager;
- architect;
- researcher;
- analyst;
- critic.

Проверяются:

- task graph;
- artifact exchange;
- context limits;
- conflicts;
- critic;
- checkpoints;
- recovery;
- autonomy A0–A6;
- emergency stop;
- model switching/fallback;
- replay;
- prompt injection;
- memory poisoning;
- cross-project leak;
- false critic;
- timeouts.

### Step 7

Финальный system prompt Manager.

**Важно:** финальный Manager prompt намеренно отложен до совместного решения с владельцем. В `packages/core/src/manager.ts` допустим временный/default prompt, но его нельзя объявлять финальным без владельца.

---

## 10. Model provider / API status

Ранее пользователь настроил API и секреты самостоятельно. Значения секретов не хранить и не переносить в этот файл.

Были разрешены два минимальных платных API-теста:

- structured output;
- tool calling.

Оба можно считать разрешёнными в рамках исторического тестирования, но **production provider пока не выбран**.

Использовался/обсуждался VibeCode/Vibecode model gateway. Список моделей/цены меняются, поэтому нельзя делать бизнес-логику, основанную на старом фиксированном наборе моделей.

Никакие production credentials не добавлять в код/документацию.

---

## 11. CI / GitHub дисциплина

Репозиторий: `RLM-Company/Nexus-OS`.

Основной quality gate:

`pnpm check`

Он включает:

1. Prettier;
2. secret scan;
3. ESLint;
4. strict TypeScript;
5. tests;
6. build;
7. Playwright E2E.

Правила:

- не merge, пока полный CI не зелёный;
- окончательно доверять CI только если он проверяет merge-ref PR с текущим `main`;
- если PR устарел/сильно diverged, лучше clean rebuild от current main, чем шумный rebase;
- маленькие безопасные PR предпочтительнее больших;
- после merge одного блока следующий PR проверять уже против нового main.

Старые PR #10–#13 были закрыты как superseded by #14. PR #8 оставался idea archive с устаревшим Synmetis-branding и не должен слепо merge’иться без миграции/ребрендинга.

---

## 12. Значимые уже слитые PR / блоки

Исторически были слиты, среди прочего:

- #14 — ранний milestone, после которого продолжили B0.1;
- #48 — Agent Studio proposal-only controls;
- #49 — versioned catalog editor;
- #50 — behavior pattern archive;
- #51 — blueprint composer;
- #53 — Manager runtime contracts/scenarios/state;
- #54 — deterministic scenario runner;
- #61 — context materialization validation;
- #65 — checkpoint semantic validation;
- #66 — task readiness;
- #68 — read-only Autonomy Control Center;
- #69 — aggregate Manager Runtime release gates;
- #71 — checkpoint ISO chronology fix;
- более поздние блоки расширили Control Center до write-enabled profile handling, hard limits и emergency-stop recovery;
- #90 — Manager Console run-status UX;
- #91 — восстановление последнего run-status после reopen/reload;
- #92 — текущий A-level + profile version в Manager Console, переход в Control Center для активного проекта;
- #93 — pending owner decisions / recovery-required signals + polling после SSE loss;
- #94 — SSE disconnect больше не равен owner cancellation; начавшийся run переживает закрытие наблюдателя.

На момент создания этого handoff актуальный `main`:

`849401c5243e52a17ec27ae5caeb8baaafb98009`

Последний merge на main:

`fix(api): preserve Manager runs after SSE disconnect (#94)`

---

## 13. Текущая Manager Console

Приоритет владельца — не ждать завершения всех внутренних идеальных блоков, а получить usable Manager Console как можно раньше.

Рекомендуемая последовательность была пересобрана так:

### P0.0

Project → Manager Chat → real model response → streaming/status → project context → server Policy Engine fail-closed.

### P0.1

Stop / Retry / Error / model fallback / checkpoints / resume.

### P0.2

Approvals / Policy Block / Control Center integration.

### P1

Real multi-agent delegation / Critic UI / Conflict UI / Agent Studio runtime controls.

К 2026-09-08 уже есть:

- список/создание/открытие проектов;
- Manager chat flow;
- run status (`queued/running/completed/failed/cancelled`);
- Stop для текущего активного run;
- базовая project info;
- восстановление run-phase из persisted messages;
- A-level/profile version;
- Control Center link для проекта;
- pending confirmations / recovery-required indicators;
- reconnect/polling при потере SSE;
- SSE disconnect больше не отменяет уже начавшийся run.

---

## 14. Текущая критическая работа — PR #95

Открыт PR:

**#95 — `feat(api): execute Manager runs in background`**

Цель: сделать run настоящим server-owned background execution, чтобы SSE был только observer, а не владельцем выполнения.

Ветка:

`feat/manager-background-run-coordinator`

Замысел:

`POST task -> server launches run`  
`SSE -> observer/reconnect channel only`  
`tab closed -> run continues`  
`reconnect -> persisted state`  
`multiple observers -> no duplicate executor`  
`Stop / Emergency Stop -> explicit server-authoritative cancellation`

В PR добавлены:

- `ManagerBackgroundRunCoordinator`;
- runtime specialization `ManagerRuntimeProjectStore`;
- atomic claim queued-run в SQLite;
- single-executor protection;
- server lifecycle integration;
- shared RuntimeMetrics;
- owner-scoped background active-run telemetry;
- тесты:
  - queued run completes without SSE;
  - explicit owner cancellation остаётся `CANCELLED_BY_OWNER`;
  - project Emergency Stop → `EMERGENCY_STOP`;
  - API/coordinator shutdown → `INTERRUPTED`;
  - второй executor не может забрать уже running-run.

Последний известный head #95 в этой переписке:

`998317314d2c84069c084022246763c52134f612`

Однако после этого были дополнительные правки в ветке, включая owner-scoped active gauge и форматирование; **перед продолжением обязательно fetch актуальный PR/head**.

### Текущий blocker #95

CI два раза дошёл только до `format:check` и остановился на Prettier для:

- `apps/api/src/manager-background-run-coordinator.ts`;
- `apps/api/test/manager-background-run-coordinator.test.ts`.

То есть на момент последней проверки lint/typecheck/tests ещё не запускались. Нельзя считать бизнес-логику проверенной.

Была создана временная debug-ветка:

`debug/prettier-pr95`

Идея: использовать GitHub runner/Prettier 3.9.6, чтобы получить точный formatting diff. Debug-ветку нельзя сливать; после получения результата её можно закрыть/удалить.

### Что делать с #95

1. Получить актуальный head PR #95.
2. Исправить **точно** Prettier 3.9.6 в двух файлах.
3. Дождаться полного `pnpm check`.
4. Если появятся lint/typecheck/unit/e2e ошибки — чинить по логам, не обходить.
5. Проверить merge-ref против current main.
6. Merge #95 только при полном green CI.

---

## 15. Следующий блок после #95

После background-run coordinator следующий приоритет:

**восстановить control over active background run после reload/reopen Manager Console.**

Проблема, обнаруженная в текущем UI:

- `restoredRunPhase(messages)` восстанавливает `queued/running`;
- но `activeRunId` остаётся `null` после reopen;
- из-за этого UI может показать «идёт run», но кнопка Stop не знает, какой `run_id` отменять.

Нужно:

- детерминированно восстановить latest active `run_id` из persisted messages/server state;
- Stop должен работать после reload/reopen;
- сервер остаётся authoritative;
- не привязывать Stop к SSE connection;
- добавить E2E: открыть проект с running background run → reload/reopen → Stop → server run становится cancelled.

После этого полезны:

- reconnect observer к уже running run;
- persisted run status endpoint / observer semantics, если существующей project history недостаточно;
- Retry/recovery UX без дублирования внешних эффектов;
- approvals непосредственно в Manager Console как отображение/переход, не client-side authority;
- долгие/background задачи с понятным progress без fake ETA.

---

## 16. Gemini как отдельная QA / research / red-team линия

Пользователь имеет доступ к Gemini, но Gemini **не имеет доступа к репозиторию**. Поэтому его роль:

- UX specification;
- acceptance/system scenarios;
- Manager behaviour critique;
- red-team/threat model;
- benchmark tasks;
- competitor research.

Gemini не должен:

- придумывать существующие API/files/classes/endpoints;
- писать repo-specific код как будто знает актуальный implementation;
- объявлять новые A0–A6 правила каноническими;
- финализировать Manager system prompt.

Gemini proposals должны маркироваться как proposal/assumption/unknown и фильтроваться перед попаданием в код.

Был создан отдельный DOCX handoff-пакет для Gemini с UX, 100 сценариями, red-team, benchmark и competitor tasks. Затем Gemini вернул расширенный пакет.

### Что из Gemini приняли как полезные принципы

- runtime states: Idle / Running / Streaming / Waiting Approval / Blocked / Recovery / Completed;
- observable status вместо chain-of-thought;
- request/operation idempotency;
- permissions не восстанавливаются checkpoint’ом;
- fallback не расширяет authority;
- UI отображает server-confirmed state;
- security tests: prompt injection, memory poisoning, forged step-up, replay/double effect, privilege resurrection, cross-project leakage, fake status, malicious agent/tool output;
- long-term UX идея «где мы остановились?»;
- project home/timeline/artifacts/decisions/tasks/search как будущая архитектура.

### Что в Gemini было отклонено/исправлено

- A5 strategy change не должен автоматически требовать A6;
- A3 не должен спрашивать confirmation на каждую правку внутри approved campaign scope;
- A2 не должен требовать confirmation на каждый безопасный commit;
- mandatory Critic gates нельзя просто отключить;
- `A6 step-up bypass` категорически запрещён;
- Critic не security perimeter;
- нельзя обещать rollback необратимых внешних действий;
- генерация destructive code и реальное execution — разные capabilities;
- A-level не определяет интеллект Manager;
- не надо фиксировать invented constants вроде timeout=60s / retry=3 / конкретных fallback models без repo evidence.

### Benchmark Gemini

Gemini сначала дал только BM-01–BM-10 вместо 200. Его затем заставили продолжить строго количественно.

Пользователь прислал **BM-011–BM-075** — ровно 65 сценариев по категориям planning/research/coding/memory/delegation/critic/recovery/policy/security.

Эти сценарии полезны как raw QA material, но перед кодированием требуют нормализации против канонических policy contracts. Особенно проверять:

- `workspace.write` на A1;
- approval vs A-level;
- invented provider/retry/timeout constants;
- Critic dependency;
- rollback semantics;
- capability mapping;
- project credential assumptions.

Следующая заготовленная задача Gemini: BM-076–BM-140, потом BM-141–BM-200, затем 100 red-team attacks. Это можно продолжать параллельно, но **Manager Console остаётся главным приоритетом**.

---

## 17. Security / isolation points, которые нельзя потерять

Проверять как release/regression gates:

- prompt injection;
- indirect prompt injection через web/tool/file;
- memory poisoning;
- malicious artifact;
- malicious tool output;
- cross-project artifact access;
- cross-project token/capability misuse;
- approval replay;
- stale approval/payload mismatch;
- duplicated retry/double effect;
- TOCTOU;
- privilege resurrection via checkpoint;
- fallback after permission revocation;
- nested delegation privilege escalation;
- context truncation losing safety-critical project constraints;
- server/client state disagreement;
- Critic false positive/false negative/unavailable;
- emergency stop while external effect already in progress;
- provider failure/recovery/fallback race;
- stale UI after resource changed;
- idempotency for financial/mutating actions;
- audit trace integrity.

Не использовать реальные личные данные пользователя в test fixtures. Использовать synthetic fixtures (`Project Alpha`, `User A`, `demo@example.com`, `$100`).

---

## 18. UX направления после базовой консоли

Будущая Manager Console не должна превращаться в перегруженную админ-панель. Предпочтение:

- главный центр — хороший Manager chat;
- project sidebar слева;
- run/status/Decision Trace справа, желательно collapsible;
- Control Center и Agent Studio доступны отдельно;
- approvals показывать как понятные action cards;
- для долгих задач — background execution;
- для 5 сек / 30 сек / 5 мин / часа использовать разные уровни status detail;
- не показывать fake ETA;
- использовать server-backed state;
- пользователь может закрыть вкладку, а задача продолжает работать;
- «где мы остановились?» — summary с момента последней активной сессии/значимого checkpoint, а не жёстко «последние 72 часа».

Long-term project UX должен выдерживать тысячи сообщений, сотни artifacts, десятки agents/checkpoints/decisions. Потенциальные верхнеуровневые разделы:

- Overview;
- Tasks / Runs;
- Artifacts;
- Decisions;
- Conversation;
- Timeline;
- Search;
- Memory;
- Checkpoints;
- Branches;
- Archive;
- unresolved items.

---

## 19. Что НЕ делать без владельца

Не делать автоматически:

- финальный Manager system prompt;
- выбор production model/provider;
- реальное включение A6;
- bypass step-up;
- ослабление hard security boundaries;
- реальные финансовые транзакции;
- реальные production deploys;
- реальные внешние кампании/письма/публикации;
- принятие необычных/платных договорных условий;
- создание юридически значимых обязательств;
- удаление audit trail;
- хранение API secrets в git;
- изменение продуктовой стратегии, если это owner-level decision.

---

## 20. Что можно делать автономно

Без нового микроменеджмента владельца можно:

- исправлять тесты/CI;
- безопасно рефакторить runtime;
- усиливать fail-closed validation;
- писать unit/contract/integration/e2e tests;
- улучшать Manager Console без расширения полномочий;
- улучшать recovery/reconnect/background execution;
- улучшать project isolation;
- добавлять read-only observability;
- добавлять safe server-side state handling;
- обновлять документацию;
- готовить/сливать green PR, если нет product/safety decision;
- закрывать superseded debug/stale branches/PR, если очевидно.

---

## 21. Рекомендуемый порядок продолжения после чтения этого файла

1. Fetch `main`, PR #95 и его **актуальный** head/merge-ref.
2. Закончить formatting/debug work по #95.
3. Прогнать полный CI и починить реальные lint/typecheck/test/e2e проблемы.
4. Merge #95 только при green merge-ref CI.
5. Создать fresh branch от нового main.
6. Исправить restore `activeRunId` + Stop after reload/reopen.
7. Добавить E2E на background run → reload → Stop.
8. Проверить reconnect observer semantics.
9. После этого брать retry/recovery UX и approvals integration.
10. Не трогать финальный Manager prompt и production/A6 без владельца.

---

## 22. Bootstrap prompt для нового Work-чата

Скопировать в новый Work-чат:

> Продолжаем разработку Cosmora в репозитории `RLM-Company/Nexus-OS`.
>
> Сначала прочитай файл `docs/handoff/COSMORA_CONVERSATION_CONTEXT_2026-09-08.md` целиком и считай его handoff-контекстом предыдущих чатов. Он содержит перенесённые решения из старых диалогов, архитектуру, A0–A6, policy/security invariants, историю Manager Console, Gemini QA и текущий незавершённый PR #95.
>
> После чтения обязательно сверяй все implementation-факты с актуальным `main` и текущими PR — handoff может отставать от репозитория. Код и действующие contracts имеют приоритет над старыми implementation-сведениями; продуктовые конфликты эскалируй владельцу.
>
> Главный приоритет: как можно скорее довести до реально usable Manager Console, сохраняя fail-closed Policy Engine и серверную authority.
>
> Начни с текущего PR #95 `feat(api): execute Manager runs in background`: получи его актуальный head, добей Prettier/полный `pnpm check`, исправь реальные CI-проблемы и merge только при полностью зелёном merge-ref CI. Не обходи quality gates.
>
> После #95 исправь Manager Console так, чтобы активный background run после reload/reopen восстанавливал не только phase, но и `run_id`, и кнопка Stop продолжала работать. Добавь E2E на `running -> reload/reopen -> Stop -> server cancelled`.
>
> Работай автономно до момента, когда действительно понадобится owner decision. Не останавливайся ради микроподтверждений на обычные безопасные изменения.
>
> Не финализируй Manager system prompt без владельца. Не выбирай production provider. Не активируй A6. Не делай реальные finance/production/external effects. Не ослабляй step-up, emergency stop, project isolation, audit и server-side Policy Engine.
>
> Если находишь архитектурную дыру, сначала зафиксируй invariant/test, затем делай минимальный безопасный PR. После каждого merge пересобирай следующий блок от свежего main.

---

## 23. Правило обновления handoff

После крупных milestone желательно обновлять этот файл или создавать новый dated handoff, где фиксировать:

- новый `main` SHA;
- merged PR;
- открытые PR;
- CI blockers;
- изменённые product/security decisions;
- следующую конкретную точку входа.

Так новые Work-чаты смогут продолжать проект без ручного переноса длинной истории.
