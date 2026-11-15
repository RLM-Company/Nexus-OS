# DELIVERY — stage3/chat-profile

- **Статус:** готово к интеграции.
- **BASE_SHA:** `f187fc0c8b83d633174675775c70695a2fefb57c` — **head PR #589**, взят как основа по указанию владельца «использовать уже сделанные правки». `main` = `500f1beec12e282828eb96a611c307bb4a93ed95`; стартовая база `9d972e8b…` — предок main.
- **Ветка:** `stage3/chat-profile`. **PR:** открывается в `main`, без merge/deploy. HEAD_SHA — `git log -1` ветки.
- **Соседние ветки:** PR #589 (OpenCode) OPEN/UNSTABLE; PR #591 (DeepSeek, проекты) OPEN/CLEAN.

## Использованные правки PR #589 (не дублировались)

| Файл                                                                                                                                                     | Что взято                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/account-settings/relay-execution.ts`                                                                                                       | product identity «Kosmora», отказ угадывать модель/вендора, masculine default, neutral self-address; `Your product profile is …` |
| `packages/config/src/index.ts`, `packages/core/src/model-service-options.ts`, `packages/contracts/src/model.ts`, `packages/model-gateway/src/gateway.ts` | `timeoutMs === 0` — отключение таймера gateway (ускорение)                                                                       |
| `apps/web/src/app/voice/voice-composer.tsx`                                                                                                              | запрос `getUserMedia({audio:true})`, дедупликация `onresult`, вставка в черновик, обработчики ошибок                             |
| `apps/web/src/app/page.tsx`, `workspace-*`                                                                                                               | Koscode/Интеграции, Deep Research/Presentations в основном воркспейсе, composer + menu                                           |
| `apps/web/e2e/composer-controls.spec.ts`                                                                                                                 | speech fixture + 6 Chromium-сценариев                                                                                            |

## Что сделано сверх #589

### A. Схема и API профиля

- `kosmora_account_preferences`: аддитивные `display_name TEXT DEFAULT ''`,
  `user_gender TEXT DEFAULT 'masculine' CHECK (masculine|feminine|neutral)`,
  `assistant_gender TEXT DEFAULT 'neutral' CHECK (…)`. Обновлены CREATE TABLE в
  `0027_personal_settings.sql` (journal db), `apps/api/src/account-settings/migration.sql`
  и его mirror `migration.ts`; в `AccountStore.migrate()` — guarded `PRAGMA
table_info` + `ALTER TABLE` для БД, созданных до этого изменения.
- `AccountPreferences`/`prefs`/GET/PUT `/api/v1/personal-settings` расширены.
  Новые поля **опциональны** в `PreferenceUpdate` и PUT-схеме — обратная
  совместимость со старыми клиентами и тестами; store подставляет текущие/default
  значения. Валидация: имя ≤80 без управляющих символов, род из трёх значений,
  CAS по `expected_version` (409 при рассинхроне), 400 на невалидный род.
- **Существующие аккаунты:** имя пустое, обращение мужское, ассистент
  нейтральный — ровно как требовалось.

### B. Единый identity prompt

`apps/api/src/account-settings/owner-identity.ts` — `ownerIdentityPrompt(settings)`:
«Ты — Kosmora. Представляйся этим именем, не называй себя именем базовой модели»,
запрет выводов о производителе/вендоре, имя пользователя, **отдельный** род
обращения и род ассистента (включая нейтральный). Подмешан в четыре пути:

- `ChatService.buildRequest` (обычный чат) — новый `identityPrompt?: string`;
- `general-chat-background-run-coordinator.ts` (фоновый чат);
- `relay-execution.ts` — заменён хардкод #589;
- `ManagerService.buildRequest` / `manager-work-coordinator.ts` (Koswork) —
  `accountStore` передан из `server.ts`.

### C. UI регистрации/профиля и приветствие

- `personal-settings/page.tsx`: новая секция «Профиль» — имя (сохранение по
  blur/Enter), «Обращение к вам», «Род ассистента» с нейтральным вариантом.
- `page.tsx`: загрузка `display_name` через `/api/v1/personal-settings`,
  приветствие «{Имя}, рад вас видеть.» под основным `<h2>`.
- Сохранение после перезагрузки проверено API-тестом (новый `AccountStore` на
  той же БД видит имя и оба рода).

### D. Диктовка (доведена до рабочего сценария)

`voice-composer.tsx`: добавлено состояние `failed` и `stoppedByUser`; флаг
выставляется при `onerror`, `no-speech` в `onend`, отказе `getUserMedia`,
отсутствии API браузера; сбрасывается при успешном старте. Явная остановка
**не считается ошибкой** (notice «Диктовка остановлена», кнопка остаётся
«Диктовать в браузере»). Кнопка «Повторить диктовку» появляется только после
реальной ошибки и вызывает `retry()` (очистка recognition → новый `start()`).
Два e2e-сценария: (1) `no-speech` → повтор → текст в черновике; (2) явная
остановка во время записи без потери/засорения черновика. Базовые сценарии
#589 (разрешение, dedup, вставка) сохранены.

### E. Ускорение: что реально меняется

`scripts/measure-profile-latency.mjs` (measurement-only, без live provider):
одинаковый `buildRequest` с `timeoutMs=60000` и `0`.

```
identical_request_except_timeout: true
bounded_timeout_ms: 60000  →  zero_timeout_ms: 0
config_manager_timeout_ms: 0, config_accepts_zero: true
route_change: gateway skips setTimeout when timeoutMs === 0 (PR #589)
mean_build_ms_bounded: 0.1907, mean_build_ms_zero: 0.1485
```

**Честно:** разница CPU-времени сборки — шум (0.04 мс). Измеримое изменение —
в **маршруте**: при `0` gateway не создаёт `setTimeout` и не прерывает поток по
таймауту; конфигурация `MANAGER_TIMEOUT_MS=0` принимается (раньше `<100`
отвергалось). Задержка живого провайдера не замерялась — нет ключей и live
вызова. «Ускорение» здесь = снятие искусственного потолка ожидания, не рост
скорости модели.

## Сценарии проверки (фактические результаты)

```
apps/api  owner-identity.test.ts                    4 passed
          profile-chat-path.test.ts                6 passed
            existing defaults / save+reload / invalid+stale /
            ordinary chat request / Koswork request / legacy compatibility
          полный набор                            1100 passed / 1 skipped,
            1 fail office-build-cache.test.ts — средовой Windows %TEMP%+turbo
packages/core полный набор                       425 passed (40 файлов)
packages/db  полный набор                        236 passed (41 файл)
apps/web     typecheck Done (вкл. e2e tsconfigs) · build 0
typecheck/lint 5 пакетов · prettier --check . · check:secrets · latency script — green
```

**Сценарий «регистрация → первый диалог»** (HTTP, in-memory SQLite, mock):
существующий аккаунт с defaults → PUT имени/родов → перезагрузка store →
POST `/api/v1/chats` → system-сообщение содержит «Ты — Kosmora», женский род,
«Имя пользователя: Мария», не содержит «OpenAI» → Manager (Koswork) получает
тот же identity → ChatService без `identityPrompt` сохраняет прежний prompt.

**Диктовка:** e2e-спец написан; локально webServer Playwright не поднялся
(`--require ../../scripts/windows-node-user.cjs` в `pnpm --dir ../api` не
резолвится из PowerShell), прогон уходит в CI Linux. Это ограничение, а не
пройденный живой тест — не выдаётся за таковой.

`office-build-cache.test.ts` падает и на чистой базе PR #589 (`IO error` при
создании `.turbo/cache` в `%TEMP%`, os error 5), к изменениям отношения не имеет.

## Общие файлы (правки локальные, перечислены для интегратора)

| Файл                                                                                                      | Причина                                                |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/core/src/chat.ts`                                                                               | `identityPrompt?` в `ChatRunContext`, system prefix    |
| `packages/core/src/manager.ts`                                                                            | `identityPrompt?` в `ManagerRunContext`, system prefix |
| `apps/api/src/general-chat-routes.ts`                                                                     | подмешивание identity в `buildRequest`                 |
| `apps/api/src/general-chat-background-run-coordinator.ts`                                                 | то же для фонового чата                                |
| `apps/api/src/manager-work-coordinator.ts`                                                                | `accountStore?` + identity в Koswork                   |
| `apps/api/src/server.ts`                                                                                  | передача `accountStore` в координатор Work             |
| `apps/api/src/account-settings/relay-execution.ts`                                                        | замена хардкода #589 на единый prompt                  |
| `apps/api/src/account-settings/routes.ts`, `account-store.ts`, `migration.*`                              | схема/API профиля                                      |
| `packages/db/migrations/0027_personal_settings.sql`                                                       | CREATE TABLE с новыми колонками                        |
| `apps/web/src/app/page.tsx`, `globals.css`, `personal-settings/page.tsx`, `voice/voice-composer.tsx`      | приветствие, профиль, диктовка                         |
| `apps/web/e2e/composer-controls.spec.ts`, `apps/api/test/relay-execution.test.ts`, `manager-work.test.ts` | проверки                                               |
| `scripts/measure-profile-latency.mjs`                                                                     | замер маршрута                                         |

## Ограничения

- Живой провайдер, реальная задержка модели и VPS не проверялись; прогоны на
  in-memory SQLite, mock provider и собранном web. Stage-one по `AGENTS.md` не
  объявляется полностью принятой.
- E2E диктовки не запущен локально (Windows webServer); CI Linux это покроет.
- Нейтральный род реализован как явная формулировка в prompt, а не как отдельная
  грамматическая модель русского языка.
- Приветствие добавляет имя отдельной строкой; основной `chooseGreeting()` не
  менялся (сохранена ротация приветствий).
- Поле ввода и диктовка #589 использованы как основа; настройки профиля
  профиля не дублируют навигацию проектов (PR #591).
- `office-build-cache.test.ts` — средовой flaky, не регрессия.

## Следующий шаг

Интегратору: слить PR, при одновременном мердже с #589/#591 сверить общие
файлы (особенно `page.tsx`, `general-chat-routes.ts`, `server.ts`), затем
применить обновлённую 0027/guarded ALTER на VPS и повторить сценарий на живых
данных.
