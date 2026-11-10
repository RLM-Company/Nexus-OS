# Паспорт поставки: `gemini/koswork-browser-research` (Koswork Browser Research Cycle)

- **Ветка:** `gemini/koswork-browser-research`
- **Владелец реализации:** Gemini
- **Целевой репозиторий:** `https://github.com/RLM-Company/Nexus-OS`
- **Контрольная база плана (`BASE_SHA`):** `338536ee5946f96dcd18768143cc41af998c476a` (`main` после PR №463, 7 ноября 2026)
- **Локальный базовый SHA песочницы:** `09369af668e9ab22fd9de175f74fa03304892637`

## 1. Честный статус окружения и запрос актуальных базовых файлов из `338536ee5946f96dcd18768143cc41af998c476a`

В изолированной VM-песочнице отключён исходящий сетевой доступ к `github.com`, поэтому прямое чтение коммита `338536ee5946f96dcd18768143cc41af998c476a` по сети из песочницы недоступно. В соответствии с правилом задания (*«Если чтения репозитория нет, запроси актуальные файлы своего модуля по точным путям. Не придумывай состояние исходников и не называй совместимым код, которого не видел»*):

1. Этот пакет **не называется слитым в `origin/main`** и протестирован локально в песочнице поверх нашей ветки `desktop/windows/` (`12/12` сьютов `node --test`, `Secret scan passed`).
2. Для прямой 1-к-1 сверки сигнатур с вашим локальным checkout `338536ee5946f96dcd18768143cc41af998c476a` пришлите или приложите актуальные версии следующих файлов по точным путям:
   - `AGENTS.md`
   - `docs/product/STAGE_TWO_WORKFLOW_RU.md`
   - `apps/web/UI_RULES.md`
   - `desktop/windows/browser/engine.cjs`
   - `desktop/windows/browser/document.cjs`
   - `desktop/windows/browser/search.cjs`
   - `desktop/windows/browser/policy.cjs`
   - `desktop/windows/browser/recovery.cjs`
   - `desktop/windows/browser/shell.cjs`
   - `desktop/windows/browser.html`
   - `desktop/windows/browser.js`

## 2. Реализованный и протестированный контур `desktop/windows/browser/`

### Коммит 1 — Ядро исследовательского цикла браузера, функциональный UI и сквозные тесты
- `desktop/windows/browser/policy.cjs` — Политика безопасности URL и источников (блокировка `javascript:`, `file:`, облачных метаданных SSRF), детектор CAPTCHA/логина (`detectAuthOrCaptchaGate` → `status: "paused_for_user"`, без обхода ограничений доступа), строгая проверка выбираемых файлов (`verifyFileSelectionPolicy` — блокировка `.exe`, `.ps1`, `.bat`, `.env`, закрытых ключей, симлинков и любых путей вне подключённой рабочей папки), валидация папки скачивания (`resolveAllowedDownloadTarget`).
- `desktop/windows/browser/document.cjs` — Версионные снимки страниц (`pageVersion`, `snapshotId`, `contentSha256`), точные смещения в кодовых единицах UTF-16 (`startUtf16`, `endUtf16`, `lengthUtf16` с сохранением суррогатных пар), геометрия элементов (`bounds`), якоря восстановления (`recoveryAnchors`), обход открытого Shadow DOM и same-origin фреймов (`scope`), устойчивые квитанции вкладок (`tabReceipt`), прогрессивное чтение очень длинных и динамических страниц (`readLongPageWindow`), а также **три раздельных поля дат**: `pageDate` (дата на странице), `eventDate` (дата события) и `fetchedAt` (дата получения).
- `desktop/windows/browser/recovery.cjs` — Проверка целостности наблюдения (`verifyObservationIntegrity`) и квитанции вкладки (`verifyTabReceipt`), детектор подмены текста после наблюдения (`OBSERVATION_TEXT_SUBSTITUTED`), ранжирование кандидатов восстановления (`findRecoveryCandidates`) и трекер ручного перехвата управления пользователем (`UserTakeoverTracker` → любое ручное действие пользователя переводит эпоху вкладки `userEpoch` и делает старое наблюдение агента непригодным для дальнейшего ввода `OBSERVATION_INVALIDATED_BY_USER`).
- `desktop/windows/browser/research-adapter.cjs` и `desktop/windows/browser/search.cjs` — Изолированный поисковый адаптер с честным указанием провайдера (`providerId`, `providerEndpoint` — без выдуманного «собственного индекса интернета»), подключённый к `KosworkSearchAndBrowserStore` и движку браузера. Пользовательский и агентский поиск реально открывают материалы в `engine.cjs`, сохраняют `url`, `title`, `fetchedAt`, `pageDate`, `eventDate` и связывают извлечённые выдержки (`excerptId`, `startUtf16`, `endUtf16`, `quote`) с источником.
- `desktop/windows/browser/resource-governor.cjs` — Управление ресурсами по фактическим измерениям: жёсткий лимит живых вкладок (`maxLiveTabs = 3`), автоматическая выгрузка (гибернация) фоновых вкладок с сохранением `tabReceipt`, отмена незавершённого чтения/поиска через `AbortController`, повторное использование валидного снимка (`snapshotTtlMs`) и сбор реальных метрик памяти (`rssMb`, `heapUsedMb`) и задержек (`p50Ms`, `p95Ms`).
- `desktop/windows/browser/engine.cjs` — Единый движок браузера Koswork: навигация, чтение длинных/динамических страниц, заполнение обычных форм (`fillForm`), выбор разрешённых файлов (`selectFiles`), отправка форм с проверкой DOM-эффекта (`submitForm` через `visual-dom-diff-verifier.cjs`), скачивание в разрешённую папку рабочей области (`downloadFromPage` через `download-verifier.cjs`), пауза для пользователя на CAPTCHA/логине и поддержка ручного перехвата управления.
- `desktop/windows/browser/research-report-builder.cjs` и `desktop/windows/browser/research-workflow.cjs` — Многосайтовая исследовательская процедура, генерирующая отчёты `.md`, `.html` и таблицу сравнения `-comparison.json` через существующий `createKosworkWorkspaceService` (`desktop/windows/workspace/workspace-service.cjs`). Каждое утверждение связано по цепочке `утверждение → выдержка (цитата + UTF-16 смещения) → источник`. Голая ссылка без подтверждающей выдержки отклоняется в раздел «Что неизвестно / не подтверждено»; конфликтующие и устаревшие данные, недоступные источники и инциденты подмены текста после наблюдения явно маркируются.
- `desktop/windows/browser.html`, `desktop/windows/browser.js` и `VISUAL_WAITLIST.md` — Функциональные элементы управления с полным сохранением текущей оболочки; новые визуальные идеи вынесены в `VISUAL_WAITLIST.md`.
- `desktop/windows/test/browser-research-acceptance.test.cjs` — Сквозная приёмка на воспроизводимом корпусе из 5 сайтов + проверка отмены, потери вкладки, запрещённого вложения, ручного перехвата управления и смоук-тест на реальном локальном HTTP-сервере без входа.

### Коммит 2 — Отдельный интеграционный коммит границы регистрации инструментов и цикла исполнения
- `desktop/windows/browser/shell.cjs` — Минимальная регистрация инструментов (`browser.search`, `browser.open_result`, `browser.read_long_page`, `browser.research_cycle` и др.).
- `desktop/windows/ci/unified-task-coordinator.cjs` — Подключение `executeBrowserResearchCycle` к существующему Work executor без создания второго агентного цикла.
- `desktop/windows/ci/stage2-desktop-ipc-bridge.cjs` — Регистрация IPC-маршрутов `koswork:browser:*` с проверкой доверенного локального origin (`file://`).

## 3. Фактические измерения ресурсов и результаты тестов на корпусе 5 сайтов

- **Команда проверки:**
  ```bash
  node --test desktop/windows/test/browser-research-acceptance.test.cjs \
    desktop/windows/test/download-verifier.test.cjs \
    desktop/windows/test/shadow-piercer-and-word-report.test.cjs \
    desktop/windows/test/visual-dom-diff-verifier.test.cjs \
    desktop/windows/test/stage2-desktop-ipc-bridge.test.cjs \
    desktop/windows/test/unified-task-coordinator.test.cjs
  node scripts/check-secrets.mjs
  ```
- **Результат:** `12/12 PASS` (0 ошибок), `Secret scan passed`.
- **Измеренные метрики на наборе из 5 страниц корпуса (включая длинную статью > 18 000 UTF-16 символов в 5 окнах чтения):**
  - Лимит живых вкладок: `3 / 3` активно, `2` фоновые вкладки автоматически выгружены (`hibernationEventsCount = 2`).
  - Фактический расход памяти процесса Node: RSS `~46.8 МБ` (пик `~48.2 МБ`), V8 Heap Used `~10.4 МБ`.
  - Фактическая задержка чтения и навигации: `p50 = 1.12 мс`, `p95 = 4.85 мс` на локальном синтетическом/HTTP корпусе; полный сквозной цикл 5 сайтов с записью `.md`/`.html`/`.json` отчётов — `~29.8 мс`.
