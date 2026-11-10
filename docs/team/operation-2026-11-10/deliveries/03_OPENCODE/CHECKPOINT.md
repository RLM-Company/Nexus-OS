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

## Выполнено после первой записи CHECKPOINT (дополнение 10.11)

9. **Страница PR: #502** https://github.com/RLM-Company/Nexus-OS/pull/502 —
   MERGEABLE, CI 4 задачи запущены. Ветки: коммиты `9e7c6c07` (код),
   `c0b1439b` (docs), затем `e3cbd1a8` (диагностика).
10. **Аудит очереди №4 (downloads/local profile/credential storage) — нарушений нет**:
    - `local-vault.cjs`: scope = sha256([origin, owner]) → отдельные `vault-<scope>.json`
      и `Kosmora-vault-<scope24>`; non-overwrite через content-addressed id (sha256);
      atomic temp+fsync+rename; anti-TOCTOU чтение (O_NOFOLLOW, nlink=1, ino/dev);
      blob-первым-перед-manifest; изоляция owner/origin, dedupe, hardlink-защита и
      tamper — покрыты local-vault.test.cjs (24 сценария);
    - `download-history.cjs`: scope sha256(origin\0owner), v1-формат, active→interrupted
      при рестарте (crash recovery), bounded 50 (active не выселяются),
      credential-redaction в серверных именах файлов; download-center.test /
      download-history.test — 13 сценариев (owner switch / server switch,
      epoch-гонка, отказ без owner и др.);
    - `main.cjs` logout-оркестрация (native menu 800s, hosted /logout 907s): identityEpoch++,
      invalidate поверхностей, forget по owner+origin, clearStorageData/clearCache,
      failure → honest dialog; смена origin — commit-phase без отмены (полная очистка
      предыдущего сервера);
    - `profile-environment.cjs`: probe-write отказа/MSIX/redirect, ничего не мигрирует.
11. **Срез 6 — встроенная диагностика (вертикальный срез, реализован)**:
    - новый `desktop/windows/diagnostics.cjs` (чистый, инъекционный): app-факты,
      подключение (origin + владелец в генерации), профиль, активные загрузки,
      pinned ключ релизов, неисправности; секреты (id владельца, cookies, токены,
      имена/пути файлов) не собираются by-design; origin → чистый schema://host:port;
      неизвестные поля входа игнорируются; ограничение неисправностей 240 симв./8 шт.;
      детерминированный вывод при фиксированном now;
    - `main.cjs`: require + `showProfileStatus` показывает отчёт в СУЩЕСТВУЮЩЕМ
      нативном пункте меню (message-инварианты прежние; profileStatusText более
      не используется диалогом; ownerVerified — строго ownerCache bound к origin и не
      истёк);
    - `test/diagnostics.test.cjs`: 5 тестов (стабильность формата, отсутствие утечек
      секретов при «испачканном» входе, обрезка неисправностей, кривые типы без
      выдуманных значений, прямое сообщение о непроверенном входе);
    - `package.json`: `node --check diagnostics.cjs` в check-цепочке;
    - **npm run check: exit 0, 438 тестов (0 fail)**.
12. VISUAL_WAITLIST.md записан: идея «Повторить» в Центре загрузок — только решение
    владельца.
13. **Срез 3 — hosted-logout паритет очистки сеанса (реализован, коммит `dea0fb14`)**:
    найденный пробел — меню-выход чистил `clearStorageData`+`clearCache`, hosted
    first-party `/logout` — только черновики/историю. Новый `session-cleanup.cjs`
    (фиксированный порядок, ошибки не гасятся, 3 теста), очистка подключена к
    did-navigate (full-doc явный /logout) и did-navigate-in-page (SPA) — НИКОГДА из
    will-navigate, чтобы не удалить session cookie до ухода серверного /logout
    запроса; меню-выход и origin-switch переведены на тот же helper (устранено
    тройное дублирование). **npm run check: exit 0, 441 тестов (0 fail)**.
14. **Срез 4 — guard полноты графика упаковки (реализован, коммит `2ee7079a`)**:
    пропущенные из build.files модули (`diagnostics.cjs`, `session-cleanup.cjs`)
    делали бы EXE неработоспособным; существующий preflight ловил только свой
    список. Новый `ci/check-package-graph.cjs` обходит граф require'ов от main.cjs
    (56 файлов) против build.files + тест package-graph (2 сценария) — теперь это
    часть `npm run check`. **npm run check: exit 0, 443 теста (0 fail)**.

## Что делать следующему запуску (в порядке приоритета)1. **Если фоновый прогон №2 завершится** (see shell-нотификация): проверь
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
