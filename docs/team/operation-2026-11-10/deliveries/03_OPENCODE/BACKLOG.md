# 03_OPENCODE — Kosmora Windows: устойчивый настольный клиент

## Идентификация

- Ветка: `ops/opencode-windows` (worktree `Nexus-OS-ops-windows`)
- BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325` (origin/main на 10.11.2026, ровно
  проверенная база из задания)
- Сфера: `desktop/windows/*` (main/preload/connection/profile/desktop-state/recovery,
  owner-session, downloads, package.json/installer CI) + native computer-driver.
- Прочитано: AGENTS.md, docs/product/STAGE_TWO_WORKFLOW_RU.md, apps/web/AGENTS.md
  (локальный AGENTS у desktop/windows отсутствует), docs/team/2026-11-07/02_OPENCODE_WINDOWS.md
  (контекст прежнего пакета той же сферы).

## Базовая линия при старте (честно, факт на 10.11.2026)

- `desktop/windows` npm run check — после фикса ниже: PASS (59 `node --check` +
  весь `node --test test/*.test.cjs`, 49 тестовых файлов).
- НАЙДЕНО СЛОМАННЫМ при старте и починено первым коммитом: `test/lifecycle-guard.test.cjs`
  падал TypeError'ом на машинах без `pwsh` (spawnSync ENOENT → stderr undefined).
  Guard-скрипт `ci/nsis-lifecycle.ps1` НЕ ослаблялся: тест теперь фоллбэчится на
  `powershell.exe -ExecutionPolicy Bypass` (process-level) и проверяет ТЕКСТ
  реального отказа guard'а (exit 1 + "disposable GitHub-hosted runner"),
  skip только когда оба шелла отсутствуют.
- `node ci/verify-unsigned-policy.cjs` — запуск в списке следующих проверок среза.

## BACKLOG (уже работает / сломано / отсутствует / требует решения)

### Уже работает (подтверждено тестами на базовой линии)
- Синтаксис и каркасы всех модулейincl. browser/*, document-reader, workspace, vault,
  computer-*, work-cycle (59 files node --check).
- Draft isolation/gate, owner-session, connection-policy, update-policy/service,
  package-policy, profile-environment, desktop-state/recovery, downloads, computer-*,
  work-result-* — покрываются тестами (детализация по каждому — в CHECKPOINT.md среза).
- Installer lifecycle guard: отказ dev-машине честно проверяется на этом ПК
  (через 5.1 фоллбэк-шелл после фикса).
- Deep link привязка, single-instance, unsigned-policy (по фиксациям ACCEPTANCE_0.11.2
  и её файлам; по-факту проверяется ниже в срезе 1).

### Сломано
- (пока) ничего сверх lifecycle-guard — будет дополняться по мере честного аудита.

### Отсутствует / аудит-статус по очереди задания
1. Свежая установка / первый запуск / deep links / вход-выход / отсутствие повторного
   пароля в сессии — сборка установщика и EXE-приёмка допустимы только в disposable
   CI/VM (guard). Локально проверяется вся логика (deep-link allowlist, owner verification,
   owner-session expiry) на уровне node-тестов; GUI/DPAPI-поведение переносится в VM.
2. Connection/profile lifecycle: offline/reconnect, смена сервера, повторный вход,
   отмена подключения, второй экземпляр, потеря доступности API; обрыв не теряет
   черновик и не подключает к неверному владельцу — СРЕЗ 1 (идёт).
3. Локальный executor host: обнаружение возможностей, lifecycle дочерних процессов,
   честная диагностика, подключение/отзыв разрешений; после перезапуска старые grants
   не оживают — срез 2+.
4. Downloads/локальный профиль/credential storage: owner/origin isolation, версии,
   non-overwrite, контролируемая очистка logout — аудит после среза 1 (многое уже
   покрыто тестами, проверить remaining gaps).
5. Упаковка/обновление/удаление с сохранением и политикой: unsigned + updater OFF —
   нельзя превращать в автообновление; CI/VM зона. Локально держим
   ci/verify-unsigned-policy + package-policy тесты.
6. Встроенная диагностика и воспроизводимый сценарий приёмки (installer — VM/CI only).

### Требует решения владельца / интегратора
- Повышение общей версии package.json (общие файлы) — только отдельный интеграционный
  commit, согласованный с Codex.
- Запуск nsis-lifecycle / сборка установщика — disposable GitHub-hosted Runner
  (guard требует это программно; локально не повторять, а не обходить).
- Реальная живая приёмка (cookie gateway, DPAPI, reconnect при живом сервере) —
  отдельно согласованные live-проверки, не сюда.

## Срез 1 (текущая работа): connection lifecycle — данные и владелец

Задача среза: доказать и при необходимости довести, что:
- отмена/новый адрес побеждают запоздалые ответы (не остаются «Подключение…»);
- обрыв/возврат сети не теряет черновик и не соединяет с чужим владельцем;
- повторный вход/вторая сессия/второй экземпляр не подменяют текущего owner;
- потеря доступности API даёт понятные статусы, а не «тихо» зависшие кнопки.

Статус: аудит кода и покрытие тестами — в CHECKPOINT.md; далее правки + тесты,
commit в эту ветку, DELIVERY.md — при завершении среза.
