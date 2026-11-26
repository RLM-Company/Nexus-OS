# Инвентаризация: выполнение действий на устройстве и голос

**Ветка:** `feature/device-voice-control` от `main` `5f976d77`.
Цикл 1 — фактические разрывы между постановкой, наблюдением и действием.

## 1. Локальный исполнитель и computer-control — что уже есть

- Полный словарь действий в `packages/contracts/src/computer-control.ts:31-237`:
  компьютер (`observe/list_apps/find_apps/open_app/open_url/open_file/focus/click/type_text/press/scroll/wait/ask_user/done`),
  браузер (`browser_tabs/open/switch/close/read/search/fill/key/click/upload/download/...`),
  выбранная папка (`workspace_list/find/read/create/update/...`), работа (`work_plan/work_step/work_switch`).
- Валидация и mode-gating: `apps/api/src/computer-control/service.ts:472-565,789-843`.
- Одно действие на свежее наблюдение, одноразовая авторизация 10 с, stop/abort, privacy fence:
  `service.ts:99,557-579,593-601,602-620,884-948`.
- Нативный мост: `desktop/windows/computer-driver.cjs` (захват/ввод),
  `computer-session.cjs` (цикл, пауза `ask_user`, journal, unknown-outcome fail-closed),
  `computer-policy.cjs` (валидатор и одноразовый action id),
  `computer-workspace.cjs` (папка, версии, байты).
- Смена активного окна: повтор захвата до 3 раз, затем fail-closed и fresh observation
  (`computer-driver.cjs:158-162`, `computer-session.cjs:223-240,609-640`).
- Отсутствие приложения/файла: `COMPUTER_APP_NOT_FOUND`, `COMPUTER_FILE_NOT_FOUND` —
  жёсткие ошибки, не типизированные recovery-события.
- Отключение устройства: частично — нативный процесс завершается с
  `COMPUTER_NATIVE_INTERRUPTED` / `COMPUTER_DESKTOP_UNAVAILABLE` /
  `COMPUTER_SCREEN_UNAVAILABLE`, сессия завершается fail-closed; корректный
  reconnect с обязательным новым наблюдением отсутствует.

Разрывы: нет типизированных полей в observation для window-change/dialog/
app-missing/device-disconnect; проверка результата после действия поручена модели
через промпт, machine-readable receipt отсутствует.

## 2. Специальный браузер

- Оболочка: `desktop/windows/browser/engine.cjs` (вкладки, CDP-isolation, DOM-read,
  fill/key, upload/download с SHA256, first-party search),
  `shell.cjs` (отдельное окно, подтверждения, takeover, folder connect, сессии),
  `browser.js` (вкладки, загрузки, план, история),
  `profiles.cjs` (per-owner Chromium-сессии),
  `recovery.cjs` (одноразовый pre-input recovery hint),
  `action-evidence.cjs` (DOM-diff), `document.cjs` (shadow/frame text).
- Рабочее окно привязано к задаче: `main.cjs:1478-1516`, `shell.cjs:671-720`;
  пользователь может наблюдать и вмешиваться (takeover `shell.cjs:221-227`).

Разрывы: механизм «Stars» — владение вкладкой/окном и очередь экранных действий —
отсутствует; одновременно идёт только одна задача (`policy.cjs:43-61`,
`shell.cjs:604-605`); OS-level unexpected dialog не классифицируется
(только DOM dialog/alert как evidence).

## 3. Голос

- Есть: диктовка через Web Speech API с явным запросом доступа и retry
  (`apps/web/src/app/voice/voice-composer.tsx:47-205`, E2E `composer-controls.spec.ts:169-341`);
  одноходовой голосовой диалог с TTS ответа (`voice-assistant.tsx:24-233`);
  серверная платная речь/транскрипция с явным согласием на платёж
  (`media-service.ts`, `media-routes.ts:73-75`).
- Нет: соответствия голосовых команд действиям устройств, полного state machine
  (listening/processing/executing/speaking), агентного уровня со свободным
  поручением выбранному режиму, голосовой корректировки/перебивания работающего
  агента, адаптера созвонов, offline STT.

**Ограничение владельца:** Jarvis/голосовой ассистент отложен (AGENTS.md:31-33,
Инструкция 3 этапа.md:32, B15 в `STAGE_TWO_GESTALT_BOARD_RU.md:122`); снятие —
по явному указанию владельца. Текущее поручение прямо вводит голосовой цикл,
поэтому объём и основу нужно сверить с владельцем до интеграции.

## 4. Референсы и лицензии

ChatGPT Work / Claude in Chrome / Cowork — только как research references
(`COMPETITOR_REVIEW_2026-10-28_RU.md:37-45`, `KOSWORK_COMPETITIVE_DEEP_DIVE_2026-10-28_RU.md:27-32,355-397`,
`2026-11-14-owner-review.md:14-19`). Работа вживую не перепроверена, поэтому
сравнения помечены как observation/research, не verified fact.

Speech-библиотеки в зависимостях отсутствуют; серверная речь — платный OpenAI API.

## Следующий шаг цикла 1

Зафиксировать инвентаризацию, затем цикл 2: минимальный типизированный
recovery-слой поверх нативных ошибок + проверка результата новым наблюдением
(без расширения словаря действий без согласования).
