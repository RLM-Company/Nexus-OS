# DELIVERY — 03_OPENCODE · срез 1: восстановление базовой линии и приёмка guard'а installer lifecycle

- Статус: **готово к интеграции** (дальнейшие статусы подтверждает Codex).
- Ветка: `ops/opencode-windows` · PR: открывается этим же запуском (см. DIRECT-ссылку в конце).
- BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325` (= origin/main на 10.11.2026,
  сверено `git merge-base --is-ancestor` → true).
- Код-коммит: `9e7c6c07` — fix(acceptance): verify installer guard refusal without pwsh.
- HEAD_SHA: последний коммит ветки (docs-коммит этой передачи), точное значение — в
  описании PR (вычисляется фактом коммита; содержательный код — 9e7c6c07).

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

| Команда                                                                                                                                                                                   | Результат                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npx.cmd -y pnpm@11.19.0 install --frozen-lockfile`                                                                                                                                       | ✓ 359 пакетов, done 19.2s, exit 0                                                                                                   |
| `npm run check` до фикса                                                                                                                                                                  | ✗ exit 1: ERR_ASSERTION в lifecycle-guard (stderr undefined)                                                                        |
| `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ci/nsis-lifecycle.ps1 -Mode Fresh -CurrentInstaller missing-installer.exe -CurrentVersion 0.9.0 -WorkRoot <tmp>` | exit 1 + `Installer lifecycle requires a disposable GitHub-hosted runner.` (nsis-lifecycle.ps1:24) — отказ dev-машине, как задумано |
| `node --test test/lifecycle-guard.test.cjs` после фикса                                                                                                                                   | ✓ 1 pass / 0 fail / 0 skipped                                                                                                       |
| `npm run check` после фикса                                                                                                                                                               | ✓ exit 0 (59 × node --check + весь node --test, 49 тестовых файлов)                                                                 |
| `npm ci` в `document-reader/deps` + `node prepare.cjs`                                                                                                                                    | ✓ «Prepared offline document assets: 216 files» (exit 0) — документированный путь восстановления vendor-артефактов (gitignored)     |
| `node ci/verify-unsigned-policy.cjs` после prepare                                                                                                                                        | ✓ «Unsigned policy OK: 0.26.0; updates OFF; NSIS x64; no auto-install.» (exit 0)                                                    |

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

Срез 2/3: вертикальная реализация по сфере downloads/local profile/credential storage
(owner/origin isolation, версии, non-overwrite, контролируемая очистка logout) —
начать с чтения `download-center.cjs`, `download-history.cjs`, `local-vault.cjs`,
`profile-environment.cjs` и их тестов, затем добивать найденные gaps срезом с тестами.
