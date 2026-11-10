# CHECKPOINT — 03_OPENCODE (ops/opencode-windows) на 10.11.2026

Точка продолжения для следующего запуска. Читай этот файл перед работой.

## Где работаем

- Worktree: `C:\Users\Александр\Documents\Codex\2026-10-20\opencode-check\Nexus-OS-ops-windows`
- Ветка: `ops/opencode-windows` (база `9d972e8ba447f681fbfb49253b73d9f02dd1d325` = origin/main на 10.11).
- Сфера: `desktop/windows/*` (main/preload/connection/profile/desktop-state/recovery,
  owner-session, downloads, installer/CI) + native computer-driver.
- Окружение: pnpm/corepack вне PATH → `npx.cmd -y pnpm@11.19.0`; PowerShell 7 (pwsh)
  на машине НЕТ, есть только PowerShell 5.1 (`powershell.exe`); Node v26.13.0 x64.

## Выполнено в этом запуске

1. База сверена: origin/main == 9d972e8b, ветка создана от неё (worktree).
2. Deps: `npx.cmd -y pnpm@11.19.0 install --frozen-lockfile` — 359 пакетов, done 19.2s.
3. Найден и починен СЛОМ на базовой линии: `desktop/windows/test/lifecycle-guard.test.cjs`
   падал TypeError'ом на машинах без pwsh (spawnSync ENOENT → `result.stderr` undefined).
   Фикс (коммит `9e7c6c07`, ветка ops/opencode-windows): тест фоллбэчится на
   `powershell.exe -ExecutionPolicy Bypass` (process-level) и проверяет РЕАЛЬНЫЙ отказ
   guard'а (exit != 0 + текст «disposable GitHub-hosted runner»); skip только когда
   отсутствуют оба шелла. Guard-скрипт не менялся, ослабления нет.
4. Восстановлен vendor-артефакт `document-reader` (gitignored, генерируемый):
   `npm ci` в `desktop/windows/document-reader/deps` + `node prepare.cjs`
   → «Prepared offline document assets: 216 files» → `node ci/verify-unsigned-policy.cjs`
   → «Unsigned policy OK: 0.26.0; updates OFF; NSIS x64; no auto-install».
5. Базовая линия после фикса: `npm run check` в `desktop/windows` — PASS
   (59 × node --check + полный node --test, 49 тестовых файлов).
6. Аудит среза 1 (connection/profile lifecycle) — нарушений не найдено:
   - `connection-policy.cjs`: normalizeServerOrigin (https для remote, http только
     loopback), запрет userinfo/путей/параметров;
   - `connection.js` (renderer): request-fencing через activeRequestId/renderVersion —
     поздние ответы не подменяют состояние; 6 тестов connection-renderer, включая
     «cancel wins over late submit», «старый render не затирает новый», Busy-защёлку;
   - `main.cjs`: single-instance lock (`gotSingleInstanceLock`, smoke-обход),
     second-instance → openRoute, deep link только `kosmora://open?path=…` через
     `desktop-state.cjs` → allowlist `safeWorkspaceRoute` (`desktop-recovery.cjs`);
     `openRoute` требует `verifiedOwner()` ДО навигации на приватный маршрут;
     ownerCache/identity привязаны к origin, TTL 12ч (owner-session);
   - `desktop-recovery.cjs`: хранит только минимальный first-party UI-стейт
     (views/surfaces/id-валидация), без произвольных query.
7. Аудит среза 2 (локальный executor host) — нарушений не найдено:
   - `computer-policy.cjs:382`: «A local, time-limited grant. Nothing here is restored
     on restart or received from a web page» — гранты только в памяти
     (`this.grant = null` → `enable` → `revoke = null`), никакой записи грантов на диск
     (grep по writeFileSync/persist в policy чист);
   - `computer-history.cjs`: пишет ТОЛЬКО зашифрованные текст/метаданные истории,
     гранты/ payloads не хранит;
   - `computer-console.cjs` создаётся fresh и только при
     `gotSingleInstanceLock && !smokeMode && !guiAcceptanceMode`; invalidate
     на смене owner/origin (main.cjs: 603/698/716/791/912/985/1000);
   - `computer-driver.cjs`: наблюдение ≤120с, ровно один action на скриншот,
     нативный транспорт с таймаутом, честные статусы (requested vs executed);
   - покрытие: computer-console.test.cjs — 15 сценариев (trusted frame, owner swap,
     crash revoke, picker revoke, passive snapshot и др.).
8. Передача: BACKLOG.md записан; PR открыт (см. DELIVERY.md).

## Паркованный пакет (LLM-поворот, desc-ветка) — текущее состояние

- Ветка `desc/experience-llm-turn-20261110`, коммит `316405d0` (запушен):
  резюме-патч bench + реальный отчёт ПРОГОНА №1 + операторские дайджесты манифеста.
- Прогон №1 УЖЕ ЗАВЕРШЁН (когда-то считался прерванным): полный отчёт
  `docs/research/experience-llm-distill-2026-11-10.json` — 13 кейсов, parse_ok 10/13,
  deterministic_pairs 13/13, files_verified 10/10, total_gen_ms 13 577 770 (~3.7 ч).
  Parse-fail: mixed-eight-steps, large-safe-reference, large-with-clipping
  (обрезка JSON ниже maxNewTokens=700 — кандидаты в fixture v2).
- ПРИНЯТ ПОДХОД-ИЗМЕНЕНИЕ после двух потерь на рестартах сервера: bench теперь
  пишет по-кейсовый чекпоинт `<output>.partial.json` и умеет RESUME; прогон №2
  (repeat+compare) запущен в фоне (shell `sh_1c6af753a001Jd8qnkc800KXd1` из
  Nexus-OS-чекута, output `-repeat.json`, compare с отчётом №1).
- Правила пакета прежние: без фейковых чисел (exit 2/3), weights вне репо, bench не
  в CI, PR только с отчётом, решение о внедрении — за владельцем.

## Что делать следующему запуску (в порядке приоритета)

1. **Если фоновый прогон №2 завершится** (see shell-нотификация): проверь
   `REPRODUCED true/false`. При true: коммит отчёта `-repeat.json` в
   desc-ветку, обнови строки очередей «Опыт выполнения» в
   `docs/product/RUFLO_ADOPTION_SCOPE_RU.md` и
   `docs/product/GEMINI_NOVEMBER_ADOPTION_RU.md`, открой PR desc-ветки
   (ТОЛЬКО с отчётом, merge не делать). При false: разбери расхождение
   (какие поля), не выдавай выборку за дубль.
2. **Если прогон ещё идёт/потерян**: рестарт только по RESUME-механике
   (partial-файл `<output>.partial.json` продолжит кейсы; общий прогон ~3.5-4 ч,
   по кейсу ~17 мин). Запуск из Nexus-OS-чекута:
   `node scripts/bench-experience-llm-distill.mjs "%TEMP%\opencode\models\qwen25-05b-q4" docs/research/experience-llm-distill-manifest-2026-11-10.json docs/research/experience-llm-distill-2026-11-10-repeat.json docs/research/experience-llm-distill-2026-11-10.json`
   (output ≠ предыдущий путь — compare читает предыдущий отчёт ДО записи).
3. **Следующий вертикальный срез ops-сферы**: downloads/local profile/credential
   storage (очередь владельца №4): owner/origin isolation, версии, non-overwrite,
   контролируемая очистка logout. Начать с reading `download-center.cjs`,
   `download-history.cjs`, `local-vault.cjs`, `profile-environment.cjs` + их тесты;
   искать gaps и реализовать срезом.
4. Периодически recheck mergeable у PR №489/№491 (desc, старый протокол).
5. После любого нового main: проверить новые общие контракты ПРЕЖДЕ чем
   разрешать конфликты (не автопик своей версии).

## Границы (не нарушать)

- Установку/EXE/GUI/NSIS — только disposable VM/CI (guard'ы `ci/nsis-lifecycle.ps1`,
  `gui-acceptance.cjs`, `smoke-mode.cjs` требуют GitHub-hosted).
- Не превращать unsigned+updater OFF в автообновление; повышение общей версии —
  только отдельный интеграционный commit с Codex.
- Не редактировать: browser/* (Gemini), document-reader/workspace,
  computer-session/work-cycle (Codex), память DeepSeek, account/auth API.
- Не читать .env/токены/БД; не выдавать Electron remote странице Node/полный IPC.
