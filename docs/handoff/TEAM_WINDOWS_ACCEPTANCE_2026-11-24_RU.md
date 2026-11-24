# Windows acceptance — 24 ноября 2026

Ветка `team/windows-acceptance`, база `main` `4fb73e33`. Зона: полноценная
приёмка Windows-приложения (чистая установка, запуск, вход, сессия, обновление,
переподключение, скачивание артефакта; отдельно рабочая папка/отзыв/перемещение).

## Граница воспроизведения

- `ci/nsis-lifecycle.ps1:21–33` запрещает запуск вне disposable GitHub-hosted runner:
  требуется `GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=github-hosted`, WorkRoot
  внутри `RUNNER_TEMP`. Это защита реального профиля — обходить на машине
  разработчика нельзя.
- `ci/build-unsigned.ps1` и `npx electron-builder` требуют сетевую установку;
  локально инсталлятор не собран. Поэтому **реальные NSIS Fresh/Upgrade, packaged
  GUI, SHA артефакта** выполняются в CI этого PR
  (`.github/workflows/windows-desktop.yml`, job `build`).

## Что реально прогонялось локально (24.11, `4fb73e33`)

Все команды из `desktop/windows`, `node --test` (без pnpm/сети), 143 теста,
0 падений:

| Группа                     | Тесты                                                                                                                                     | Результат |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Installer/session/update   | `package-policy`, `package-graph`, `download-package`, `sign-release`, `update-service`, `owner-session`, `session-cleanup`               | 22/22     |
| Download/connection/folder | `download-center`, `download-history`, `connection-policy`, `connection-renderer`, `local-vault`, `computer-workspace`, `vault-workspace` | 103/103   |
| GUI fixture/профиль/Work   | `gui-acceptance`, `desktop-state`, `profile-environment`, `work-document-cycle`, `draft-isolation`, `draft-session-gate`                  | 18/18     |
| Синтаксис                  | `node --check` по всем 56 `test/*.test.cjs`                                                                                               | 0 ошибок  |

Сценарии, подтверждённые этими тестами (fixture/логика, не реальный GUI):

- **Launch/sign-in/session**: `owner-session.test.cjs` (verified owner, 401/403,
  expiry), `session-cleanup.test.cjs`, `gui-acceptance.test.cjs` (login form,
  cookie persistence, logout, owner isolation).
- **Reconnect after network failure**: `connection-policy.test.cjs` (generation
  gate, retry/cancel, offline view), `connection-renderer.test.cjs`,
  `gui-acceptance.test.cjs` (offline → online).
- **Artifact download**: `download-center.test.cjs` (sandbox, same-origin chain,
  byte accuracy, reveal, retry), `download-history.test.cjs` (scope, crash →
  interrupted), `download-package.test.cjs`.
- **Working folder / revoke / moved**: `local-vault.test.cjs` (restart binding,
  disconnect, traversal/hardlink), `computer-workspace.test.cjs:453` (замена
  папки → revoke), `vault-workspace.test.cjs` (expired lease/binding revision →
  revoke), `workspace-service.cjs:148–168` (inode/dev → `WORKSPACE_ROOT_CHANGED`).
- **Update over previous version**: `update-service.test.cjs` (signed manifest,
  exact SHA, same-origin; `update-trust.json` key null → updater OFF), а реальный
  NSIS Upgrade baseline 0.8.0 → 0.27.0 — в CI job `build`.

## Воспроизводимая проблема, исправлена

`docs/handoff/KOSWORK_LIVE_ACCEPTANCE_RUNBOOK_RU.md:35` требовал Windows-клиент
**0.23.0**, хотя `desktop/windows/package.json` — **0.27.0**. Исправлено: версия
сверяется с `package.json`, добавлены SHA-проверка инсталлятора и результат
прогона 24.11. Коммит `731c71b4`.

## Проверяемая сборка и SHA (CI run `45428006738`, 24 ноября)

- Инсталлятор: `Kosmora-Setup-0.27.0-x64.exe` (unsigned).
- **SHA-256: `bbf272919d11608b1891931ca787824226b70fd1d4f64cc4041a38c12e7e7332`**
- Windows workflow `completed/success`: job `Test, build and lifecycle-test NSIS
installer` ✅ и `Live server acceptance smoke` ✅. NSIS Fresh и Upgrade
  (baseline 0.8.0 → 0.27.0), packaged GUI acceptance (вход/сессия, загрузки,
  offline→online, logout/isolation) — пройдены; побайтовая сверка
  `connection.json` и session sentinel при апгрейде — успешна.

## Сдача

- **Проверяемая сборка и SHA**: см. выше (Exact SHA из CI) и комментарий в PR.
- **Инструкция установки/обновления**: `desktop/windows/README.md:67–89,115–150`.
- **Список пройденных сценариев**: таблица выше + CI-сценарии.
- **PR**: [#643](https://github.com/RLM-Company/Nexus-OS/pull/643) (Draft).

## Ограничения

- Это fixture-прогон, не живая приёмка: `status.json` не менялся
  (`live_model_accepted:false`, `owner_windows_accepted:false`,
  `live_release_accepted:false`, VPS `update_pending`).
- Реальный GUI на ноутбуке владельца, живой HTTPS-логин, Authenticode/SmartScreen,
  настоящий сетевой сбой — отдельные поручения; live-smoke job gated on
  `KOSMORA_LIVE_ORIGIN` secret.
- Сборка unsigned; in-app updater OFF до ключа в `update-trust.json`.
