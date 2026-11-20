# BACKLOG — stage3/chat-profile

- **BASE_SHA:** `f187fc0c8b83d633174675775c70695a2fefb57c` (head PR #589, взят как основа по указанию владельца «использовать уже сделанные правки»).
- `main` = `500f1beec12e282828eb96a611c307bb4a93ed95`; PR #589 OPEN / UNSTABLE, PR #591 (проекты) OPEN / CLEAN.
- **Ветка:** `stage3/chat-profile`.

## Что уже сделано в PR #589 (используем, не дублируем)

| Файл                                                                                                                                                     | Правка                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/api/src/account-settings/relay-execution.ts:180`                                                                                                   | «Introduce yourself as Kosmora», не угадывать модель/вендора, masculine default, neutral self-address |
| `apps/web/src/app/voice/voice-composer.tsx`                                                                                                              | упрощён на ~397 строк: запрос микрофона, текст в черновик                                             |
| `packages/config/src/index.ts`, `packages/core/src/model-service-options.ts`, `packages/contracts/src/model.ts`, `packages/model-gateway/src/gateway.ts` | `timeoutMs === 0` — отключение таймера (ускорение)                                                    |
| `apps/web/src/app/page.tsx`, `workspace-*`                                                                                                               | Koscode/Интеграции, Deep Research/Presentations в основном воркспейсе, composer + menu                |
| `apps/web/e2e/composer-controls.spec.ts`                                                                                                                 | 6 Chromium-тестов, speech fixture                                                                     |

## Пробелы (воспроизведено разведкой)

1. **Нет имени/рода пользователя**: `AccountPreferences` содержит только
   relay/language/optimize/provider/model/chat_style/tokens. `chooseGreeting()`
   не знает имени, приветствие «Чем могу помочь?».
2. **Род ассистента не настраивается отдельно**: в #589 захардкожено
   «Use gender-neutral phrasing for yourself by default», нейтральный вариант
   есть только де-факто, без выбора.
3. **Identity prompt только в relay**: обычный чат (`ChatService`) и Koswork
   (`ManagerService`) его не получают → выбор не влияет на ответы.
4. **Диктовка**: #589 даёт базовый сценарий, но нет проверки остановки и
   повтора после ошибки, и нет замера ускорения/маршрута.
5. **Регистрация**: отдельной формы имени/рода нет; надо встроить в существующий
   путь первого диалога и в профиль.

## План срезов (цикл: воспроизвести → реализовать → пройти → исправить) — ВСЕ ГОТОВО

- **A. Схема и контракт.** ✅ `0027` + guarded ALTER, поля в
  `AccountPreferences`/`prefs`/GET/PUT, optional в PUT/PreferenceUpdate,
  defaults masculine/neutral, CAS 409, 400 на невалидный род.
- **B. Единый identity prompt.** ✅ `ownerIdentityPrompt()` в ChatService,
  background chat, relay (замена хардкода #589), Manager/Koswork.
- **C. UI регистрации/профиля.** ✅ секция «Профиль», имя в приветствии,
  сохранение после перезагрузки (API-тест).
- **D. Диктовка.** ✅ `failed`/`retry()`, явная остановка, e2e на
  ошибку→повтор→текст→стоп; базовые сценарии #589 сохранены.
- **E. Ускорение.** ✅ `measure-profile-latency.mjs`: маршрут 60000→0,
  gateway без таймера; CPU-разница обозначена как шум.
- **F. Прогон сценария, исправления, отчёты, PR.** ✅ api 1100, core 425,
  db 236, web typecheck/build 0; один средовой office-build-cache flaky.

## Границы

Не трогаю навигацию проектов (DeepSeek/PR #591), общие файлы правлю локально
и перечисляю в PR: `apps/api/src/app.ts`, `apps/api/src/general-chat-routes.ts`,
`packages/core/src/manager.ts`, `packages/core/src/chat.ts`,
`apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`.
Не меняю тарифы/квоты/права, Multi-Agent, VPS, production.
