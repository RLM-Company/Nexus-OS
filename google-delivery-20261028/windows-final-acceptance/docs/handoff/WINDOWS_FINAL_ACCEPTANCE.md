# Kosmora Windows Final Acceptance (`feature/kosmora-windows-final-acceptance`)

## 1. База, ветка и границы ответственности

- **Репозиторий:** `https://github.com/RLM-Company/Nexus-OS`
- **Целевая база (`main`):** `4b54bdef1f5c29d84d566c3eb1ecc21214bf8dd9` (*Integrate validated Kosmora stage-one release and Gemini acceptance*)
- **Рабочая ветка:** `feature/kosmora-windows-final-acceptance`
- **Затронутый контур:** исключительно `desktop/windows/**`, `.github/workflows/windows-desktop.yml` и настоящий итоговый документ `docs/handoff/WINDOWS_FINAL_ACCEPTANCE.md`.
- **Неизменённые контуры:** `apps/api/**`, `apps/web/**`, `packages/**`, `deploy/**`, `.github/workflows/ci.yml`, БД, провайдеры моделей, веб-UI, сайдбар, CSS и логотип.
- **Стабильные идентификаторы совместимости и безопасности:**
  - `name`: `cosmora-windows-desktop`
  - `version`: `0.11.2`
  - `build.appId`: `com.cosmora.desktop`
  - каталог профиля Windows: `%APPDATA%\cosmora-windows-desktop`
  - Chromium partition: `persist:cosmora`
  - `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`
  - `update-trust.json`: `{"schemaVersion": 1, "publicKeyPem": null}` (автообновления отключены до закрепления владельцем релизного ключа Ed25519; автоматического запуска скачанных `.exe` нет).

## 2. Найденные и исправленные ошибки в `main` (`4b54bdef1f5c29d84d566c3eb1ecc21214bf8dd9`)

При сверке `desktop/windows/**` на коммите `4b54bdef1f5c29d84d566c3eb1ecc21214bf8dd9` и логов падения GitHub Actions (`Windows desktop`) выявлены и устранены следующие дефекты:

1. **Дрейф `appId` и `name` в `desktop/windows/package.json`:**
   - В `4b54bdef1f5c29d84d566c3eb1ecc21214bf8dd9` значения `"name"` и `"build.appId"` были изменены на `"kosmora-windows-desktop"` и `"com.kosmora.desktop"`, что ломало `ci/verify-unsigned-policy.cjs`, расходилось с `app.setAppUserModelId("com.cosmora.desktop")` в `main.cjs` и нарушало совместимость обновления поверх `0.8.0` / `0.10.0` / `0.11.x`.
   - **Исправление:** восстановлены `"name": "cosmora-windows-desktop"` и `"build.appId": "com.cosmora.desktop"`.
2. **Неполный `scripts.check` в `desktop/windows/package.json`:**
   - В `4b54bdef1f5c29d84d566c3eb1ecc21214bf8dd9` скрипт `npm run check` пропускал `node --check download-history.cjs`, `node --check downloads.js`, `node --check connection.js` и не запускал `node --test test/*.test.cjs`. Из-за отсутствия `download-history.cjs` и `downloads.js` в `scripts.check` падал контрактный тест `test/download-package.test.cjs`.
   - **Исправление:** в `scripts.check` включены проверки синтаксиса всех `.cjs`/`.js` точек входа (`main.cjs`, `preload.cjs`, `downloads-preload.cjs`, `download-history.cjs`, `download-center.cjs`, `downloads.js`, `connection-policy.cjs`, `smoke-mode.cjs`, `gui-acceptance.cjs`, `connection.js`, `desktop-state.cjs`, `desktop-recovery.cjs`, `draft-store.cjs`, `draft-session-gate.cjs`, `owner-session.cjs`, `update-policy.cjs`, `update-service.cjs`, `ci/create-signed-update.cjs`, `ci/verify-unsigned-policy.cjs`, `ci/gui-acceptance-fixture.cjs`) и прогон `node --test test/*.test.cjs`.
3. **Опечатка поля ключа в `desktop/windows/test/download-package.test.cjs`:**
   - Тест проверял `assert.equal(trust.publicKeysPem, null)` (во множественном числе) вместо `trust.publicKeyPem`, что в `node:assert/strict` приводило к `AssertionError: undefined == null`.
   - **Исправление:** проверка приведена в соответствие со схемой `update-trust.json` (`assert.equal(trust.publicKeyPem, null)`).
4. **Инициализация хранилищ профиля до `requestSingleInstanceLock()` и проверки `smokeMode` в `desktop/windows/main.cjs`:**
   - Вторичный процесс `Kosmora.exe` (при передаче deep link `kosmora://...` или повторном клике по ярлыку) и `--cosmora-smoke-test` инициализировали хранилища профиля до выхода, что при открытом основном окне переводило активные загрузки в `download-history.json` в статус `interrupted`.
   - **Исправление:** `ensureProfileStores()` вызывается только в основном экземпляре после получения `requestSingleInstanceLock()` и вне `--cosmora-smoke-test`.
5. **Потеря сохранённого маршрута (`lastPath` / `deferredRoute`) при входе и обрыве соединения (`desktop/windows/main.cjs`, `desktop/windows/connection.js`):**
   - После прохождения `/login` или переподключения промежуточная посадка на корневой `/` перезаписывала `preferences.lastPath` значением `"/"` раньше, чем `restoreAfterAuthentication()` успевал восстановить `deferredRoute`.
   - Обработчик `did-fail-load` при обрыве соединения не сохранял целевой `deferredRoute` перед переходом на `connection.html`.
   - На экране `connection.js` завершение устаревшей (`stale: true`) попытки подключения могло сбросить индикатор загрузки `setBusy(false)` или затереть редактируемый адрес поверх новой активной попытки.
   - **Исправление:**
     - `persistRoute(url)` не затирает `lastPath` промежуточным `"/"`, пока ожидается восстановление `deferredRoute !== "/"` или выполняется `restoreAfterAuthentication()`.
     - `did-fail-load` сохраняет `deferredRoute` из `validatedURL` либо `preferences.lastPath` до показа `connection.html`.
     - `restoreAfterAuthentication()` сбрасывает `deferredRoute` только после успешного открытия маршрута.
     - `connection.js` отслеживает `activeRequestId`, игнорирует `result.stale === true` и не перезаписывает поле `#origin`, когда пользователь редактирует адрес в режиме смены сервера.
6. **Синхронный и асинхронный IPC-канал `cosmora:draft-flush`:**
   - В `main.cjs` поддержаны оба вызова (`ipcMain.on("cosmora:draft-flush", ...)` и `ipcMain.handle("cosmora:draft-flush", ...)`), а в `preload.cjs` сохранён неблокирующий `ipcRenderer.send("cosmora:draft-flush", scope, text)` для `pagehide`.

## 3. Проверка 6 целевых блоков работ

### Блок 1. Установка → запуск EXE → подключение → форма входа → сохранение сессии → закрытие/открытие
- Первый запуск без `connection.json` открывает локальный `connection.html` (`mode: "setup"`).
- `normalizeServerOrigin` принимает только `https://` для внешних хостов и `http://127.0.0.1` / `localhost` / `[::1]` для локального стенда; учётные данные в URL, пути, query и hash отклоняются.
- `probeServer` проверяет `/api/v1/health` (и при `401` — доступность публичной страницы `/login`) с таймаутом 6 с и `redirect: "manual"`.
- Обычный вход выполняется в веб-форме `/login`; `HttpOnly` cookie сессии сохраняется в `persist:cosmora`.
- При закрытии окна сохраняются `bounds`/`maximized` в `desktop-preferences.json`, а при повторном открытии `Kosmora.exe` автоматически подключается к сохранённому `origin` и через `restoreAfterAuthentication()` возвращает пользователя на сохранённый маршрут (`lastPath`).

### Блок 2. Восстановление после недоступности сервера, позднего ответа и изоляция владельцев
- При недоступности сервера (`probeServer`, `did-fail-load`, `startConnectivityMonitor`) открывается локальный экран `connection.html` в режиме `offline` с кнопками **Повторить** и **Сменить адрес**.
- Неудачная попытка подключения к новому серверу не перезаписывает `connection.json` и не стирает `currentOrigin` или `deferredRoute`.
- `createLatestAttemptGate()` в `main.cjs` и `activeRequestId` в `connection.js` гарантируют, что поздний ответ от старой попытки (`stale: true`) не подменяет текущую попытку.
- Текстовые черновики (`draft-store.cjs` + `draft-session-gate.cjs` + `owner-session.cjs`) шифруются через Windows DPAPI (`safeStorage`), привязаны к `origin + "\0" + verifiedOwnerId + scope` и защищены от чтения/записи другим владельцем (`Owner B`).

### Блок 3. Загрузка и открытие файлов результата (`will-download`, `download-center.cjs`, `download-history.cjs`)
- `isAllowedDownload` проверяет всю цепочку редиректов `item.getURLChain()`: разрешены только URL активного `currentOrigin` и `blob:` того же `origin`. Внешние редиректы, `data:` и `file:` блокируются.
- `safeDownloadFilename` очищает небезопасные символы (`<>:"/\|?*` и управляющие байты), а `nextAvailableDownloadPath` добавляет суффиксы `(1)`, `(2)` без тихой перезаписи существующих файлов.
- Центр загрузок (`Ctrl+J` / **Файлы → Центр загрузок…**) изолирует историю по `SHA-256(origin + "\0" + ownerId)`, скрывает `savePath` и `scope` от рендерера `downloads.html`, переводит незавершённые загрузки в `interrupted` после перезапуска и блокирует запуск исполняемых расширений (`.exe`, `.msi`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`, `.reg`, `.lnk` и др.) через **Открыть**, оставляя безопасный **Показать в папке**.

### Блок 4. Single instance, закрытие, восстановление окна и deep links
- `app.requestSingleInstanceLock()` предотвращает запуск второго независимого окна и не трогает файлы профиля при отказе в блокировке.
- События `second-instance` и `open-url` фокусируют существующее окно (`revealWindow`) и передают маршрут из `kosmora://open?path=...` через `deepLinkFromArgv` и `openRoute` только после проверки белого списка `safeWorkspaceRoute` и подтверждения владельца `verifiedOwner()`.
- `restoredBounds` восстанавливает положение и размер окна только в пределах видимой рабочей области текущих мониторов.

### Блок 5. Воспроизводимый packaged GUI acceptance в изолированном Windows CI
- Добавлены `desktop/windows/gui-acceptance.cjs`, `desktop/windows/ci/gui-acceptance-fixture.cjs` и `desktop/windows/test/gui-acceptance.test.cjs`, а также вызов `Invoke-PackagedGuiAcceptance` в `desktop/windows/ci/nsis-lifecycle.ps1` (режим `Fresh`) и `.github/workflows/windows-desktop.yml`.
- В отличие от `--cosmora-smoke-test` (который завершает процесс до `createMainWindow()`), `--cosmora-gui-acceptance` запускает **настоящий установленный `Kosmora.exe` с реальным `BrowserWindow`** против локального loopback-сервера `http://127.0.0.1:<port>` в два этапа:
  1. **Этап 1 (`first-launch`):** открытие `connection.html` (`setup`) → подключение к `http://127.0.0.1:<port>` → отправка формы `/login` → получение 30-дневной `HttpOnly` cookie в `persist:cosmora` → переход на рабочий маршрут `/?project=...&view=chat&surface=code` → сохранение и чтение черновика через `window.kosmoraDesktopDraft` и Windows DPAPI (`safeStorage`) → скачивание двух файлов с одинаковым небезопасным именем `report<final>:"?.md` в `report_final____.md` и `report_final____ (1).md` без перезаписи → блокировка внешнего редиректа `/files/foreign-redirect` → проверка окна Центра загрузок (`downloads.html`) на отсутствие утечки `savePath`/`scope` → штатное закрытие окна.
  2. **Этап 2 (`relaunch-and-recovery`):** повторный запуск установленного `Kosmora.exe` → автоматический вход по сохранённой сессии и восстановление маршрута `/?project=...&view=chat&surface=code` → расшифровка черновика `Owner A` после перезапуска → запуск второго процесса `Kosmora.exe` с вредоносным deep link (отклоняется) и валидным `kosmora://open?path=%2Fgithub` (фокусирует первое окно и открывает `/github`) → отключение локального сервера (`offline`) → переход на экран восстановления `connection.html` без потери `connection.json` даже при попытке ввода недоступного адреса → возврат сервера в `online` и успешный `retry()` с восстановлением `/github` → смена владельца сессии на `Owner B` (проверка, что черновик `Owner A` недоступен) → явный выход `/logout` с полной очисткой черновиков, истории загрузок и сбросом `lastPath` в `"/"`.
- Локальный fixture-сервер не обращается к платным моделям, внешним сетям или реальным аккаунтам.

## 4. Итоговая матрица приёмки

| Проверка / Сценарий | Статус | Подтверждение |
| :--- | :--- | :--- |
| Синтаксис всех 20 `.cjs`/`.js` модулей (`npm run check`) | **PASS (Linux VM)** | `node --check` для всех модулей в `desktop/windows` и `desktop/windows/ci` — `0 errors` |
| Модульные, контрактные и стендовые тесты Node (`node --test test/*.test.cjs`) | **PASS (Linux VM)** | `42 tests`: `41 pass`, `0 fail`, `1 skip` (`lifecycle-guard.test.cjs` требует `win32`) |
| Offline preflight пакета и политики обновлений (`npm run verify:unsigned`) | **PASS (Linux VM)** | `Unsigned policy OK: 0.11.2; updates OFF; NSIS x64; no auto-install.` (все 24 упакованных файла на месте) |
| Изоляция черновиков и Центра загрузок (`draft-*.test.cjs`, `download-*.test.cjs`) | **PASS (Linux VM)** | Разделение по `origin + owner`, защита от подмены, блокировка опасных расширений, очистка при `/logout` |
| Локальный стенд `gui-acceptance-fixture.cjs` (`test/gui-acceptance.test.cjs`) | **PASS (Linux VM)** | Полный цикл `/api/v1/health` → `/login` → `/api/v1/identity/sessions` → загрузки → offline/retry → Owner B → `/logout` |
| Нативная сборка `Kosmora-Setup-0.11.2-x64.exe`, Windows DPAPI (`safeStorage`), NSIS `Fresh` + packaged GUI acceptance + `Upgrade` на `windows-latest` | **UNVERIFIED on Linux / Ready for Windows CI** | В Linux-песочнице нет Win32 GUI, DPAPI и NSIS; полный автоматизированный прогон настроен в `.github/workflows/windows-desktop.yml` и `desktop/windows/ci/nsis-lifecycle.ps1` |

## 5. Команды для интегратора и Windows CI

Локальная проверка и сборка неподписанного установщика на Windows (Node.js 24+):

```powershell
cd desktop/windows
npm run check
npm run verify:unsigned
powershell -NoProfile -File ci/build-unsigned.ps1
Get-Content dist/SHA256SUMS.txt
```

Полная проверка жизненного цикла NSIS (`Fresh` + реальный packaged GUI acceptance в `Kosmora.exe` + `Upgrade` с 0.8.0 + сохранение профиля при удалении) выполняется автоматически в GitHub Actions workflow `.github/workflows/windows-desktop.yml` на изолированном `windows-latest` раннере. Не запускайте `ci/nsis-lifecycle.ps1` в обход защитного guard на рабочей машине владельца.
