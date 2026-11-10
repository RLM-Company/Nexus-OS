# DELIVERY — 03_OPENCODE · срез 1: восстановление базовой линии и приёмка guard'а installer lifecycle

- Статус: **готово к интеграции** (дальнейшие статусы подтверждает Codex).
- Ветка: `ops/opencode-windows` · PR: **#502** https://github.com/RLM-Company/Nexus-OS/pull/502
- BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325` (= origin/main на 10.11.2026,
  сверено `git merge-base --is-ancestor` → true; по факту 10.11 origin/main вырос до
  `f9eb4528` — docs/operation-#500, сфера desktop/windows НЕ изменилась, конфликтов нет).
- Код-коммиты: `9e7c6c07` guard-фикс; `e3cbd1a8` диагностика; `dea0fb14` hosted-logout
  паритет очистки сеанса.
- HEAD_SHA: последний коммит ветки (docs-коммит этой передачи), точное значение — в
  описании PR.

---

## Срез 4 (добавление): guard полноты графа упаковки

**Найденный пробел**: мои новые модули `diagnostics.cjs` и `session-cleanup.cjs`
(требуемые main.cjs) отсутствовали в `pkg.build.files` (include-набор electron-builder)
и в списке `ci/verify-unsigned-policy.cjs` — упакованный EXE падал бы на старте
(`Cannot find module`). Существующий guard это не ловил: он проверяет только «свой»
фиксированный список и не защищает от рассинхронизации его с реальным графом
`require` из main.cjs.

**Стало**:
- оба файла добавлены в `package.json` (build.files) и в список
  `ci/verify-unsigned-policy.cjs` (двойная фиксация, как у соседних модулей);
- новый `ci/check-package-graph.cjs`: статический обход графа локальных
  `require("./…")` от `main.cjs` (56 скриптов) против `build.files` + wildcard'ы,
  double-use как CLI (`process.exitCode` при пропусках) и как модуль;
- постоянный тест `test/package-graph.test.cjs`: (1) граф полный — каждый
  достижимый require внутри build.files («упакованный EXE обязан находить все свои
  модули»), (2) новые/исполнительные модули включены ЯВНО (не wildcard'ом).
  Теперь пропавший из пакета модуль ловится в самом `npm run check`, а не в CI.

**Изменённые файлы**: `desktop/windows/package.json`, `desktop/windows/ci/verify-unsigned-policy.cjs`,
`desktop/windows/ci/check-package-graph.cjs` (новый), `desktop/windows/test/package-graph.test.cjs` (новый).

**Фактические проверки**: `node ci/check-package-graph.cjs` → «files walked: 56; misses: 0»;
`npm run check` → exit 0 (**443 теста, 0 fail**).

---

# Срез 3 (добавление): паритет очистки браузерного сеанса при hosted-выходе

**Найденный пробел** (аудит.logout-оркестрации): native-меню «Выйти и удалить локальные
данные…» выполняет `clearStorageData` + `clearCache`, а hosted-first-party `/logout`
(включая SPA-переходы) — только черновики/историю/владельца. Остатки
localStorage/cache прежнего владельца могли доживать до следующего входа на тот же
origin (partition привязан к origin, не к владельцу).

**Стало**: новый `desktop/windows/session-cleanup.cjs` (`clearBrowserSessionData` —
фиксированный порядок storage→cache, ошибки не гасятся, 3 теста на контракт) и
включение очистки в обе пост-навигационные точки hosted-выхода
(`did-navigate` full-doc по явному `/logout`, `did-navigate-in-page` по SPA-выходу)
с честным предупреждением при неудаче. **Решённая проблема тайминга**: очистка
ни при каких путях не отправляется из `will-navigate` — там она могла бы удалить
session cookie ДО ухода запроса `/logout` на сервер и сервер не смог бы инвалидировать
владельца. Меню-выход и origin-switch переведены на тот же helper (устранено
тройное дублирование с риском дрифта).

**Изменённые файлы**: `desktop/windows/session-cleanup.cjs` (новый),
`desktop/windows/test/session-cleanup.test.cjs` (новый), `desktop/windows/main.cjs`
(require + 4 точки очистки + `warnSessionResidueAfterLogout`), `desktop/windows/package.json` (check).

**Фактические проверки**: `node --test test/session-cleanup.test.cjs` → 3 pass;
`npm run check` → exit 0 (**441 тестов, 0 fail**).

---

# Срез 2 (добавление): вертикальный срез «встроенная диагностика» (очередь №6)

Пользовательский путь: меню **Application → «Состояние локального профиля…»** →
содержательный отчёт нативного диалога (без изменений web-UI и компоновки; пункт меню уже существовал).

**Было**: диалог показывал только профиль (каталог/запись/MSIX-redirect) — версии,
состояние подключения/владельца, активные загрузки и ключ обновлений вне диалога.

**Стало**: тот же диалог содержит полный отчёт: версия/окружение (упаковка, secure
storage, single-instance lock), активный сервер + подтверждение владельца в этой
генерации identity, каталог профиля + причины, активные загрузки (счётчик), состояние
ключа релизов, отдельный блок неисправностей и время отчёта.

**Границы secret-безопасности** (покрыты тестами `test/diagnostics.test.cjs`):
- никогда не включаются: id владельца, cookies, токены, имена/пути пользовательских
  файлов и скачанных артефактов;
- origin приводится к чистому `scheme://host[:port]` (query/`access_token=…` отбрасываются);
- неизвестные поля входа игнорируются by-design; управляющие символы и длина
  неисправностей ограничиваются (240/срез, max 8);
- детерминированный текст при фиксированном времени (инъекция `now`).

**Изменённые файлы**: `desktop/windows/diagnostics.cjs` (новый, чистый/инъекционный);
`desktop/windows/test/diagnostics.test.cjs` (новый, 5 тестов);
`desktop/windows/main.cjs` (require + `showProfileStatus`, message-инварианты прежние,
`profileStatusText` для диалога больше не используется); `desktop/windows/package.json`
(`node --check diagnostics.cjs` в check-цепочке).

**Фактические проверки**: `node --test test/diagnostics.test.cjs` → 5 pass / 0 fail;
`npm run check` → exit 0 (60 синтаксис-проверок + 438 тестов, 0 fail).

---

# Срез 1 (основная передача)

## Сценарий до/после (конкретный)

**До** (факт, воспроизведён на этой машине): на Windows без PowerShell 7 (`pwsh`)
`desktop/windows` `npm run check` падал: `test/lifecycle-guard.test.cjs` →
`spawnSync("pwsh", …)` → ENOENT, `result.stderr === undefined` →
`ERR_ASSERTION (actual: undefined, expected: /disposable GitHub-hosted runner/)`
вместо содержательного результата. Базовая линия модуля не выводилась; локально
отказ installer-guard'а dev-машине вообще не проверялся.

**После**: тот же тест запускает guard через имеющийся `powershell.exe` 5.1
(process-level `-ExecutionPolicy Bypass` — только этому дочернему процессу разрешено
загрузить ps1-файл) и проверяет РЕАЛЬНЫЙ отказ guard-скрипта: exit ≠ 0 и текст
«disposable GitHub-hosted runner». Поведение guard'а не изменено, ослабления нет;
skip только если отсутствуют оба шелла (чисто CI-переменные окружения).

## Entrypoint

- Проверка: `desktop/windows` → `npm run check` (и отдельно `node --test test/lifecycle-guard.test.cjs`).
- Guard: `desktop/windows/ci/nsis-lifecycle.ps1` (без изменений).

## Изменённые файлы

- `desktop/windows/test/lifecycle-guard.test.cjs` (код-коммит `9e7c6c07`)
- `docs/team/operation-2026-11-10/deliveries/03_OPENCODE/{BACKLOG,CHECKPOINT,DELIVERY}.md` (docs-коммит)

## Команды и фактические результаты

| Команда | Результат |
| --- | --- |
| `npx.cmd -y pnpm@11.19.0 install --frozen-lockfile` | ✓ 359 пакетов, done 19.2s, exit 0 |
| `npm run check` до фикса | ✗ exit 1: ERR_ASSERTION в lifecycle-guard (stderr undefined) |
| `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ci/nsis-lifecycle.ps1 -Mode Fresh -CurrentInstaller missing-installer.exe -CurrentVersion 0.9.0 -WorkRoot <tmp>` | exit 1 + `Installer lifecycle requires a disposable GitHub-hosted runner.` (nsis-lifecycle.ps1:24) — отказ dev-машине, как задумано |
| `node --test test/lifecycle-guard.test.cjs` после фикса | ✓ 1 pass / 0 fail / 0 skipped |
| `npm run check` после фикса | ✓ exit 0 (59 × node --check + весь node --test, 49 тестовых файлов) |
| `npm ci` в `document-reader/deps` + `node prepare.cjs` | ✓ «Prepared offline document assets: 216 files» (exit 0) — документированный путь восстановления vendor-артефактов (gitignored) |
| `node ci/verify-unsigned-policy.cjs` после prepare | ✓ «Unsigned policy OK: 0.26.0; updates OFF; NSIS x64; no auto-install.» (exit 0) |

## Аудиты (без правок кода — код зрелый, покрыт тестами)

- **Срез 1 connection/profile lifecycle** (аудит, нарушений нет): origin-нормализация
  (`connection-policy.cjs`), renderer request-fencing (`connection.js`, 6 тестов
  connection-renderer: cancel-prohibited, старый render не затирает новый, busy-защёлка),
  single-instance + second-instance → openRoute, deep link только
  `kosmora://open?path=…` → allowlist `safeWorkspaceRoute`, `openRoute` требует
  `verifiedOwner()` до приватных маршрутов, ownerCache привязан к origin (TTL 12ч
  owner-session), recovery хранит только минимальный UI-стейт.
- **Срез 2 executor host** (аудит, нарушений нет): grants только в памяти
  (`computer-policy.cjs:382` — «Nothing here is restored on restart», writeFileSync
  отсутствует), история хранит лишь зашифрованные тексты (не гранты/payloads),
  console создаётся fresh только при `gotSingleInstanceLock && !smoke && !guiAcceptance`,
  invalidate на смене owner/origin, driver: наблюдение ≤120с, один action на скриншот,
  честные статусы; computer-console.test.cjs — 15 сценариев.

## Зависимости/миграции/схемы

- Новых зависимостей и миграций нет. Vendor-артефакты `document-reader` — генерируемые,
  gitignored, восстанавливаются документированным путём (таблица выше).

## Полномочия и границы

- Изменён только тест своей сферы + отчёты своего каталога. Общие файлы не тронуты →
  INTEGRATION.md не требуется.
- Installer/EXE/GUI-прогоны не запускались локально (guard'ы программно требуют
  disposable GitHub-hosted runner): `ci/nsis-lifecycle.ps1`, `gui-acceptance.cjs`,
  `smoke-mode.cjs`.

## Несовместимости/ограничения

- На машинах БЕЗ PowerShell 7 тест фоллбэчится на 5.1; при отсутствии обоих — skip.
  На GitHub-hosted runner слабого места нет: там есть оба шелла и установщик реально
  проверяется.
- Повышение общей версии (`package.json` 0.26.0 → …) — НЕ в этом PR: только отдельный
  интеграционный commit, согласованный с Codex.

## Что ещё не проверено живьём

- Реальная установка/запуск EXE, GUI restart/offline/logout, upgrade с предыдущей
  версии, uninstall с сохранением/очисткой — только VM/CI (guard'ы программно
  запрещают иные прогоны).
- Живой reconnect на реальном сервере — отдельная согласованная live-проверка.
- Эти пробелы — природа среды разработки (нет electron/установщика локально), не баг.

## Следующий шаг (очередь владельца)

Аудиты очереди 1–4 завершены без найденных нарушений (детализация — CHECKPOINT.md);
срез 6 (диагностика) реализован коммитом `e3cbd1a8`. Следующие шаги: если владелец
одобрит — UI-идея «Повторить» в Центре загрузок записана в VISUAL_WAITLIST (не в
этой петле); installer-проверки upgrade/uninstall и воспроизводимый сценарий
приёмки — в VM/CI; при новых срочных gap'ах — вертикальные срезы по очереди.
