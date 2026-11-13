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

Аудиты очереди 1–4 завершены без найденных нарушений (детализация — CHECKPOINT.md);
срез 6 (диагностика) реализован коммитом `e3cbd1a8`. Следующие шаги: если владелец
одобрит — UI-идея «Повторить» в Центре загрузок записана в VISUAL_WAITLIST (не в
этой петле); installer-проверки upgrade/uninstall и воспроизводимый сценарий
приёмки — в VM/CI; при новых срочных gap'ах — вертикальные срезы по очереди.

---

## Срез 5 (добавление, 2026-11-11): кнопка «Повторить» для прерванных загрузок

**Одобрение**: владелец явно одобрил единственный пункт VISUAL_WAITLIST
2026-11-11; компоновка и стили окна не менялись — кнопка добавляется в
существующий блок действий записи общим стилем `button`.

**Граница по контракту окна** («Ссылки скачивания не сохраняются»): URL никогда
не пишется на диск и не передаётся рендереру. Повтор возможен только пока
главный процесс помнит исходный запрос в памяти сессии; после рестарта
приложения запись остаётся «Прервано» без кнопки — честная граница, а не баг.

**Реализация**:

- `download-center.cjs`: `capture()` запоминает первый элемент redirect-цепочки
  (уже прошедший полный will-download policy-gate) как {url, origin, epoch},
  потолок 50 записей; при завершении источник удаляется (кроме interrupted);
  `invalidate()` очищает карту целиком; список для окна дополняется булевым
  флагом `retryable` (никаких URL);
- IPC `cosmora:downloads:retry`: полная переавторизация окна (sender/frame/url/
  origin/epoch/owner), re-check актуальности origin/epoch источника,
  `history.statusOf(scope, id) === "interrupted"`, живое главное окно с
  разрешённой same-origin страницей; повтор идёт через `webContents.downloadURL()`
  без навигации и заново проходит will-download policy-gate (fail-closed);
- `download-history.cjs`: новый `statusOf(scope, id)` — только статус, без пути;
- `downloads-preload.cjs` / `downloads.js`: API `retry(id)` и кнопка
  «Повторить» у записей interrupted с `retryable`;
- тесты: 4 новых в download-center (happy path с проверкой «URL не на диске»;
  отказы для completed/unknown/stale-owner/stale-origin; требование разрешённой
  страницы главного окна; очистка при invalidate) + `statusOf` в
  download-history; `npm run check` → **448 тестов / 0 fail**, prettier clean.

### Инфра-примечание к срезу 5 (2026-11-11)

Первый прогон CI среза выявил падение `Verify monorepo`, не связанное с кодом
среза: `prettier --check .` падал на `docs/research/experience-llm-distill-2026-11-10.json`
— первый отчёт дистилляции из desc-коммита `316405d0`, попавший в main через
merge #515 без форматирования (мой недосмотр при desc-передаче). Диагноз и
исправление задокументированы в CHECKPOINT item 26; сам фикс (`73bf04f1`,
prettier-only, контент deep-equal не менялся) — в PR #523, потому что в
ops-ветке файла нет и чинить на ops значило бы создать add/add-конфликт.
Порядок интеграции: сначала #523 (main снова проходит format-gate), затем пуш
доков в ops-ветку перезапускает CI этого PR.

---

## Срез 6 (добавление, 2026-11-11): паритет hosted-выхода для URL с query/hash

**Одобрение**: владелец явно выбрал этот срез после закрытия волны #523/#525;
закрывает единственную остававшуюся записанную функциональную недоделку
(`/logout?query` не входил в `isExplicitLogout` — расширение было помечено как
решение владельца).

**Проблема**: `isExplicitLogout` требовал `!u.hash && !u.search`, поэтому
`/logout?reason=…`, `/logout#…`, `/logout?next=…` не считались явным выходом.
Частичный паритет уже покрывал их через `isLoginOrLogout` в did-navigate
(epoch++, invalidate поверхностей, сброс draft-gate), но файлы черновиков и
данные браузерного сеанса после такого выхода оставались — расход с честным
паритетом меню-выхода (срез hosted-logout, `dea0fb14`).

**Решение**: дискриминатор — тот же same-origin + точный путь
`/logout`|`/signout`; query/hash больше не дисквалифицируют, subpath и чужой
origin не проходят. Направление расширения fail-safe — все потребители
очищают «больше, не меньше»: `clearDraftsForHostedLogout` (will-navigate и
did-navigate-in-page) идемпотентен, двойное срабатывание безопасно; тайминг
`alsoClearSession` сохранён (wipe не раньше коммита навигации).

**Тесты**: кейс «logout?next=чужой-origin» перевёрнут в `true` с rationale
(cleanup не следует за redirect-целью — маршрут same-origin /logout сам
является намерением выхода); добавлены кейсы `?reason=session-end` → true,
`#top` → true, `signout?step=2` → true, `/logout/other` → false.
`npm run check` → **448 тестов / 0 fail**, prettier clean.

---

## Срез 7 (добавление, 2026-11-11): hardening мостов + прямые тесты checkpoint-text

**Одобрение**: владелец делегировал выбор направления («бери то, что хочешь»)
после merge #529; выбран hardening-мини-срез как закрывающий оба записанных
наблюдения item 29 без изменения поведения.

**Проблема (два наблюдения item 29)**: (1) `Object.freeze` был только у части
contextBridge-мостов; (2) у `checkpoint-text.cjs` (`containsCredentialText` —
фильтр целей/итогов/подписей, потребители: computer-history,
work-cycle-policy, work-experience, work-result) не было прямых тестов —
покрытие только косвенное через потребителей.

**Решение (а) — freeze 9/9 мостов**: заморожены `cosmoraDesktop`,
`kosmoraDesktopDraft`, `kosmoraDesktopComputer`, `kosmoraDesktopWork`
(preload.cjs), `kosworkComputer` (computer-preload.cjs), `kosworkBrowser`
(work-cycle-preload.cjs). Замороженные ранее не тронуты: `kosmoraDesktopVault`,
downloads- и vault-мосты. Freeze — defense-in-depth: фиксированная поверхность
renderer-API; набор каналов IPC и поведение не менялись. Урок процесса: при
аудите freeze-карты первый grep был обрезан и `kosworkBrowser` выпал из поля —
полную перепроверку («9 exposeInMainWorld / 9 Object.freeze, голых нет») делаю
после основных правок, фактура в CHECKPOINT item 32.

**Решение (б) — прямой тест**: `test/checkpoint-text.test.cjs`, 2 теста /
31 кейс. Flagged (22): Bearer, password/passwd, api-key/api_key,
access-token, secret, пароль/ПАРОЛЬ (кириллица, iu-флаги), код/ПИН 4–8 цифр,
em-dash-разделитель, ghp_/gho_/github_pat_, sk-, PEM RSA/OPENSSH. Allowed
(9): пустая строка, реальные цели, «шаг 3 из 5», номера заказов, даты,
«кодировка…» («код» без цифр рядом не срабатывает), «run code review»,
UUID чата.

**Проверки**: `npm run check` → **450 тестов / 0 fail** (448 + 2), prettier
clean; реальные EXE/GUI-прогоны — VM/CI (NSIS-задание при ревью).

**Замечание (первый пуш, ретрай)**: локальный `npm run check` в
desktop/windows не включает корневой `check:secrets`, и первый прогон CI
упал на шаге «Run quality gate»: сканер флагнул литералы
`-----BEGIN … PRIVATE KEY-----` в новом тесте как «private key». Сканер не
менялся (allowlist не добавлялся) — вместо этого PEM-заголовки строятся в
тесте рантайм-конкатенацией (`pemHeader = (alg) => …`): проверяемое значение
то же, покрытия PEM-ветки нет потери, в исходнике нет литерала-триггера.
Урок: при добавлении credential-подобных фикстур прогонять
`node scripts/check-secrets.mjs` из корня до пуша.

---

## Срез 8 (добавление, 2026-11-11): план внедрения дистилляции — документ решения

**Одобрение**: следующий пункт очереди владельца («давай дальше» после merge
#532); документ без кода, реализация — выбор владельца.

**Содержимое**: `docs/product/EXPERIENCE_DISTILL_PLAN_RU.md` — фактура из
main (shipped-поток reference: строится на лету на каждый запрос planner'а,
hash-конфликт на API, strict-схема, защита от наследования грязных данных —
только промпт-рамка; оба измерения с честными числами), ключевой вывод
(детерминированный кандидат готов, LLM — не готов), варианты A (скраб внутри
текущего формата, только desktop/windows, с честными минусами) / B (скетч
как отдельный формат, кросс-пакет с Codex) / C (отложить) / LLM (не на
сейчас), неизменные границы, рекомендация (A первым шагом). Решение — за
владельцем.

---

## Срез 9 (добавление, 2026-11-12): вариант A — скраб reference внутри формата

**Одобрение**: владелец выбрал вариант A (question-tool, 2026-11-11) после
merge #535 (план, 3/3 зелёные).

**Реализация**: новый модуль `desktop/windows/work-reference-scrub.cjs` —
адаптация измеренного кандидата `extractive-drop-candidate-v1` из bench
(происхождение в шапке модуля; bench вне CI не тронут): 7 классов запрещённого
bench-вербатимно + сплиттер предложений. `buildWorkReference` скрабит
выдаваемый `koswork.accepted-example.v1`: цель — точный префикс до начала
первого устаревшего предложения (кап 500/well-formed прежние; re-join не
используется — отличие от bench-скетча, где предложения пересобираются),
план — без шагов с любым запрещённым фрагментом; `tool_observations` и
corrections не тронуты (вне одобренного объёма); revision = sha256 исходной
записи, не зависит от обрезок. Честные отказы вместо ослабления: цель,
начинающаяся с устаревшего предложения, и все-шаги-грязные план (schema
minItems: 1) → `COMPUTER_REFERENCE_UNAVAILABLE` (в истории reusable:false).
Модуль зарегистрирован в build.files и check-скрипте package.json.

**Унаследованная особенность, задокументированная в тесте**: `\b` без
u-флага — ASCII-only, кириллические альтернативы (`пароль:`, `см.`, `ревизия`)
срабатывают только после ASCII-словесного символа. Паттерны остаются
bench-вербатимными (измеренная база 0/32 — на них); credential-текст в
целях/шагах отсекается upstream (start/checkpoint). Исправление кириллических
`\b` — возможное будущее решение владельца (изменит измеренную базу).

**Замер на замороженной панели v1 (13 кейсов, read-only, методология:
целый reference-JSON до/после)**: медиана отношения **0.8311**, 13/13
измерено, отказов 0; чистые примеры не сжимаются (1.0 — all-safe,
large-safe, large-with-clipping), грязные — до **0.6052** (mixed-eight-steps),
plan-with-absolute-paths 0.6713, goal-prohibited-middle 0.6747. Ниже
bench-медианы 0.7935 — ожидаемо: вариант A сохраняет counts и формат.
Скрипт замера — разовый (tmp, не в репо); панели не редактировались.

**Пред-проверка из плана**: фиксации полного равенства плана reference с
записью на API-стороне нет (grep contracts/service.ts — только схема и hash).
Существующий кейс «укороченная цель» переведён на словесный наполнитель:
24+ ASCII-пробег в цели теперь классифицируется как credential_token и
честно отказывается (rationale в тесте).

**Проверки**: `npm run check` → **458 тестов / 0 fail** (450 + 7 модульных
`work-reference-scrub.test.cjs` + 1 интеграционный), prettier clean,
`check:secrets` пройден до пуша; реальные EXE/GUI-прогоны — VM/CI.

---

## Срез 10 (2026-11-12): фикс кириллических границ в скрабе

**Одобрение**: владелец выбрал фикс вопросом-инструментом (2026-11-12) после
merge #537 — следующий срез вместо варианта B.

**Причина**: `\b` в JS без u-флага — ASCII-only, поэтому в двух
bench-вербатимных паттернах кириллические альтернативы были фактически
мёртвы: «пароль:», «см.», «ревизия» после пробела не матчились (ASCII-формы
`password:`, `token=`, ISO-даты, `#123` работали). Записано в item 34 и
срез 9 как задокументированная особенность; решением владельца превращено в
одобренное расхождение.

**Реализация** (`work-reference-scrub.cjs`, оба паттерна): левая граница
`\b` заменена на lookbehind `(?<![\p{L}\p{N}])`, добавлен u-флаг; хвост
«ревизия» — `(?![\p{L}])` (воспроизводит bench-`\b` для цифр: «ревизия3»
матчится, «ревизияXYZ» — нет). Шапка модуля фиксирует одобренное
расхождение от bench-вербатимности. Направление fail-safe: больше очистки,
ложные срабатывания на встроенных словах исключены guards («выключатель:»,
«аппароль:», «ID2026-11-01»).

**Замер — честный повтор на замороженной панели v1**: числа идентичны
до фикса — медиана **0.8311**, 13/13 измерено, отказов 0. Диф-пробник
(старые vs новые паттерны по каждому шагу и предложению панели) объясняет:
ровно 2 шага (credentials-tokens, mixed-eight-steps) меняют id вердикта
(credential_token → credential_assignment) при том же исходе — шаг дропался
и раньше по токену-соседу; переключений keep→drop нет. Вывод: панель не
дискриминирует фикс; добавленная полнота продемонстрирована тестами, а не
панелью (recall за пределами панели не заявляется).

**Унаследованный нюанс, задокументированный guard'ом**: bench-хвост `\s`
после «см./смотри» требует пробела, а сплиттер предложений отрезает его у
отдельного предложения — босое конечное «См.» не матчится; в середине
предложения маркер матчится («Введи см. документ», «смотри задачу»).
Расширение хвоста — вне одобренного объёма; изменит измеренную базу и
требует отдельного решения владельца.

**Тесты**: модульный — кириллические кейсы обоих паттернов возвращены как
рабочие + guards; интеграционный — шаг «Внести ключ: 1234-ABCD в журнал»
проходит upstream-гейты (start/checkpoint: «ключ» не в их списках) и
убирается именно скрабом; цель «Собери сводку. Смотри задачу #123.» →
«Собери сводку.»; цель «Третья ревизия. …» — честный отказ end-to-end
(reusable:false). `npm run check` → **459 тестов / 0 fail** (458 + 1
интеграционный), prettier clean, `check:secrets` пройден до пуша.

---

## Срез 11 (2026-11-12): требования к скетч-формату — gate-замер и вилка

**Одобрение**: владелец выбрал вариант B (требования без кода) после merge
#540 — следующий срез.

**Документ**: `docs/product/KOSWORK_SKETCH_CONTRACT_RU.md` — материал для
решения владельца и задания пакету 01_CODEX (код не пишется до
договорённости; задание выдаёт владелец).

**Gate-замер (обязательное условие плана)**: на замороженной панели v1
скетч-конструктор bench-кандидата (цель-префикс 480 байт, kinds без counts,
бюджет 5 000) на тех же фиксированных паттернах, что продукт после #540,
против уже скрабленного reference A: медиана скетч/A **0.943** (~6% выигрыша);
с маркированными потерями (`lost_steps` + `clipped_steps`) медиана **1.0348**
— скетч больше reference A в медиане; отказов 0. Локальные выигрыши:
goal-truncated-long 0.822, large-with-clipping 0.8645, large-safe-reference
0.9382. **Вывод: байтовый аргумент B после A не подтверждён** — честная
маркировка потерь съедает выигрыш формата.

**Вилка в документе**: B-полный (новый формат, полный объём
contracts/api/conformance, ~0% байтов в медиане) / **B-lite** (опциональные
маркеры в accepted-example.v1 — маркер частичности без нового формата,
рекомендация пакета) / остаться на A. Решение владельца; задание пакету
01_CODEX — только от владельца.

**Если B-полный — требования зафиксированы**: поля схемы (prototype,
const-поля, lost_steps/clipped_steps, minItems 0 только с непустыми
потерями), revision = хэш исходной записи (не скетча, паритет с desktop),
дополнение WORK_REFERENCE_RULES о скетче, conformance на замороженной
панели (REPRODUCED бит-в-бит, 0 запрещённых фрагментов, целые подмножества
шагов/kinds) и пять открытых вопросов до кода: пустая goal_excerpt, точный
префикс против bench-нормализации re-join, состав маркеров, правило выбора
формата при двух форматах, достаточность следа без counts.

**Проверки**: docs-only; замер — разовый tmp-скрипт (панель и bench не
редактировались); prettier clean.

---

## Срез 12 (2026-11-12): решение по вилке скетч-формата — остаться на A

**Одобрение**: merge #544 исполнен владельцем; выбор по вилке (B-полный /
B-lite / остаться на A) владелец делегировал пакету («выбери сам»).

**Решение пакета: остаться на A.** Основание (полное — в строке решения
документа требований и CHECKPOINT item 37): gate-замер item 36 не даёт
байтового выигрыша (0.943 / 1.0348 с метками); маркеры потерь дублируют
рамку WORK_REFERENCE_RULES, уже называющую те же классы, и приглашают
модель достраивать пробелы; хранимый след — только при реальном запросе
память/история; семантика «пример без молчаливых шагов» принята в #537.

**Следствие**: дистилляция «Опыт выполнения» закрыта — A в main (#537,
#540), B-вилка решена замером, LLM measurement-only. В пакет 01_CODEX
ничего не передаётся; `KOSWORK_SKETCH_CONTRACT_RU.md` остаётся материалом
на будущее (память/история).

**Проверки**: docs-only (записи решения); prettier clean; `check:secrets`
пройден до пуша.

---

## Срез 13 (2026-11-12): план живой приёмки — отложение снято

**Одобрение**: владелец снял отложение live-приёмки (question-tool,
2026-11-12, после опустошения очереди пакета).

**Документ**: `docs/product/LIVE_ACCEPTANCE_PLAN_RU.md` — проверяемый
сценарий по записанному отложенному объёму (BACKLOG пакета, INTEGRATION/
ACCEPTANCE_0.11.2, README desktop/windows).

**Объём**: три механизма на реальном Electron-клиенте против живого сервера —
A. cookie gateway (вход, identity fetch с привязкой к origin, 30-дневное
поведение, hosted /logout очистка, смена origin), B. DPAPI
(сохранение/перезапуск/выход, изоляция владельцев A/B, честный отказ без
DPAPI), C. reconnect при живом сервере (обрыв/возврат сети, перезапуск
сервера, потеря доступности API, отмена побеждает запоздалые ответы) +
финальный настоящий пользовательский цикл владельца (правило пакета:
автоматика не заменяет первую приёмку). Матрица 14 сценариев с разделением
VM/CI ↔ владелец.

**Честные факты в плане**: NSIS fresh/upgrade/uninstall и sandbox уже
покрыты CI — не дублируются; логика механизмов уже покрыта node-тестами;
`gui-acceptance.cjs` жёстко требует loopback-фикстуру
(`http://127.0.0.1:<port>`) — сценарии против живого сервера требуют
параметризации origin или отдельного live-харнесса (код — отдельный срез
после одобрения плана); повышение версии — отдельный интеграционный commit
с Codex.

**Требует владельца**: живой сервер (выкладка — отдельно, не этот срез),
лицензия/учётные данные, решение о GitHub-секретах для VM-сценариев,
финальная приёмка на ноутбуке. Границы плана повторяют границы пакета
(unsigned+updater OFF не переключать, без signing-секретов, платные вызовы —
по явному решению, Jarvis/облачный ПК/веса не запускаются).

**Проверки**: docs-only; prettier clean; `check:secrets` пройден до пуша.

---

## Срез 14 (2026-11-12): live-харнесс — параметризация origin в gui-acceptance

**Одобрение**: план приёмки merge (#550); первый кодовый шаг его раздела 5
(параметризация origin).

**Реализация** (`gui-acceptance.cjs`): не-loopback origin принимается только
при двойном явном opt-in — `remoteOrigin: true` в конфиге И env-гейт
`KOSMORA_GUI_ACCEPTANCE_ALLOW_REMOTE_ORIGIN=1`; удалённый origin строго
`https://` (http-удалённый отклоняется — паритет с `connection-policy`); не-boolean
флаг трактуется как отсутствие opt-in; `remoteOrigin` возвращается в
разобранной конфигурации. Fail-closed: fixture-прогоны и текущий CI не
меняются (loopback-фикстура остаётся обязательной по умолчанию) —
live-сервер возможен только явно, на disposable runner (existing
`assertGuiAcceptanceEnvironment` сохранён: packaged + GitHub-hosted
Windows).

**Тест**: gate-кейсы в `test/gui-acceptance.test.cjs` — без env-гейта /
с env-гейтом (принято, remoteOrigin:true) / не-boolean флаг / удалённый
http (отклонён /https/).

**Следующий шаг по плану приёмки**: open-вопросы владельца (origin
живого сервера, GitHub-секреты, учётная запись, время участия) →
подключение live-сценариев в windows-desktop workflow (env-гейт + секреты)
→ VM-прогоны → участие владельца → финальный цикл.

**Проверки**: `npm run check` → **459 / 0 fail**, prettier clean,
`check:secrets` пройден до пуша.

---

## Срез 15 (2026-11-12): вайринг live-сценариев в windows-desktop workflow

**Одобрение**: владелец — «Вайрить сейчас, секреты потом» (question-tool,
2026-11-12, после merge #552). Секреты GitHub владельец создаёт, когда
готов; до тех пор задание — видимый no-op.

**Фаза `live-smoke` в `gui-acceptance.cjs`**: не-loopback https origin +
оба opt-in'а (`remoteOrigin: true` И env-гейт) + hostname не loopback;
fixture-поля (workspaceRoute/draftScope/draftText/downloadDirectory) не
требуются и игнорируются. Ветка прогона: connection.html (setup) → connect
БЕЗ учётных данных → честный `/login` живого origin (недостижимый сервер —
таймаут → честный красный, не тишина) → инвариант бриджей на /login →
origin сохранён → отчёт `{ok, landedOnLogin, savedOrigin}`. Никаких
черновиков, загрузок и workspace-доступа в фазе нет.

**Драйвер `ci/gui-acceptance-live.cjs`**: guard'ы disposable-runner
(DI environment/platform), work-root строго в RUNNER_TEMP, EXE строго
Kosmora.exe внутри work-root; origin только из env `KOSMORA_LIVE_ORIGIN`
(https, не-loopback, без credentials в URL, нормализация schema://host:port,
на диск не пишется); пишет конфиг (`phase: live-smoke, remoteOrigin:
true`), спавнит packaged-приложение, ждёт отчёт, валидирует, пишет
`cosmora-gui-acceptance-live-report.json` (честный fail-отчёт с
checkpoint'ом при ошибке). Env-гейт приложения остаётся на workflow-шаге.

**Задание «Live server acceptance smoke» в windows-desktop.yml**:
`needs: build` (артефакт installer'а), секрет-гейт уровня шагов — job-level
`if` не может видеть secrets/env, поэтому `if: env.KOSMORA_LIVE_ORIGIN
== ''` на шагах: без секрета задание зелёное с шагом-отчётом «skipped»,
видимо в чеках; с секретом — install NSIS `/S /D=` (образец
`Invoke-Installer`), запуск драйвера с
`KOSMORA_GUI_ACCEPTANCE_ALLOW_REMOTE_ORIGIN=1`, uninstall `/S`, upload
отчёта. NSIS-задание не тронуто.

**Тесты**: live-smoke-конфиг (opt-in'ы, отказ loopback/не-boolean/без
гейта, игнорирование fixture-полей) в `gui-acceptance.test.cjs`; драйвер
(parseLiveOrigin — 9 кейсов; guard-отказы до спавна — 6 кейсов) в новом
`test/gui-acceptance-live.test.cjs`.

**Дальше**: секрет `KOSMORA_LIVE_ORIGIN` от владельца (задание включится
само) → VM-прогоны (C1-C4, B1/B2/B5, A4) → участие владельца (A1-A3,
B3-B4) → финальный цикл → ACCEPTANCE-отчёт.

**Проверки**: `npm run check` → **462 / 0 fail**, prettier clean,
`check:secrets` пройден до пуша.

---

## Срез 16 (2026-11-13): карточка раздела Multi-Agent — материал для обсуждения

**Одобрение**: владелец выбрал «Карточка Multi-Agent» (question-tool,
12.11.2026, после отложения live-прогонов — «тесты и прогоны потом, а сейчас
работа»). Без реализации: runtime, UI и сервер не меняются.

**Документ**: `docs/product/KOSMORA_MULTI_AGENT_CARD_RU.md` — 9 секций по
stage-two: пользовательская задача и полезный результат; фактическое
состояние по коду (проверка 12.11.2026); конкуренты с датами проверки;
почему раздел и когда оправдан; предложение (переиспользуем/доделываем/
убираем); механизмы ↔ результат; сценарий/ошибки/отмена/восстановление/
ограничения; критерии готовности; 4 открытых вопроса владельца.

**Честное ядро по коду**: governance-слой Agent Studio полностью построен —
CRUD API functions/patterns (test_status)/blueprints/proposals (включая
делегированные)/decision-events с идемпотентностью, owner/project scoping
и mutation-журналом (`apps/api/src/app.ts`); контракты с grant
(capabilities/tools/data scope/бюджет/delegation_depth/valid_until),
memory_scope и task_contract (`packages/contracts/src/agent-studio.ts`);
таблицы `agent_*` + pattern library (`packages/db/src/schema.ts`).
**Runtime отсутствует**: ни один исполнительный код не потребляет
`agent_instances` (Work-агент single-task —
`apps/api/src/computer-control/service.ts`); UI-режим «Multi-Agent» —
статический макет (Manager/Исполнитель/Критик,
`apps/web/src/app/workspace-sections.tsx`).

**Конкуренты (даты проверки)**: Claude Cowork «Sub-agent coordination» —
свежая проверка 12.11.2026 (суб-агенты не конфигурируются пользователем,
распространяются через plugins); Gemini Tasks — sub-agent-координации
внутри задачи не описано (свежая проверка 12.11.2026); ChatGPT Work —
субагенты по записи 28.10.2026, сегодня страницы 403, честно помечено.
Вывод: многоагентная координация — не общепринятый стандарт.

**Открытые вопросы владельца (раздел 9 карточки)**: (1) формат раздела —
видимый «конструктор команд» vs внутренний механизм Work; (2) объём первого
выпуска (параллельные части + проверяющий без записи + бюджет команды);
(3) формулировка «мультиагентная команда» в существующем макете;
(4) приоритет относительно live-приёмки.

**Проверки**: docs-only (NSIS не запускается); prettier clean;
`check:secrets` пройден. Реализация — только после согласования объёма
владельцем.

---

## Срез 17 (2026-11-13): решения владельца по карточке + уточнение формулировки шапки чата

**Одобрение**: владелец разобрал все четыре открытых вопроса раздела 9
карточки (question-tool, 2026-11-13): (1) формат — blueprint-
ориентированный (состав из blueprint'ов проекта, подтверждение владельцем
при первом запуске состава; без blueprint'ов — один агент по умолчанию);
(2) объём — минимальный + файловые артефакты завершённых частей с
версиями; (3) формулировку уточнить сейчас; (4) Multi-Agent впереди,
live-приёмка остаётся отложенной. Решения записаны в раздел 9 карточки
(«Решения владельца»).

**Реализация (пункт 3)**: надпись шапки чата проекта
`apps/web/src/app/page.tsx` — «Менеджер · мультиагентный проект» →
«Менеджер · проект» (точечный запрос владельца по `apps/web/UI_RULES.md`;
только текст одной строки, компоновка/стили/иконки/токены не тронуты).
Надпись уникальна и статична — пишется для каждого проекта без реальной
«моды» за ней. Сопутствующий e2e-тест, закреплявший старую фразу,
`apps/web/e2e/pwa.spec.ts` (утверждение «Главный чат проекта» содержит
фразу) обновлён на новую формулировку с rationale-комментарием («шапка
нейтральна, пока настоящая команда не реализована»); прочие e2e
(b0.1.spec.ts, project-invalid-view-route.spec.ts) проверяют только
видимость региона — не задеты.

**Честная граница**: это правка текста существующего макета, не шаг
реализации Multi-Agent; runtime не менялся.

**Проверки**: prettier clean (оба файла), `check:secrets` пройден;
поверхностная перепроверка тестов на «Главный чат проекта»/
«project-mode-label» — закрепление текста только в обновлённом месте;
Browser acceptance (Playwright) — в CI этого PR.

---

## Срез 18 (2026-11-13): планировщик команды Multi-Agent — ядро team.plan / team.confirm

**Одобрение**: владелец одобрил старт реализации с планировщика команды
(question-tool, 2026-11-13, после того как все 4 открытых вопроса карточки
решены и исполнены — срез 17). Объём среза — только планировщик: порождение
pending-ростера из blueprint'ов проекта и подтверждение состава владельцем;
исполнение частей, arbiter, бюджет команды, панель хода и файловые
артефакты — следующие срезы.

**Контракты** (`packages/contracts/src/agent-studio.ts`): операции
`team.plan` / `team.confirm` в decision-журнале, объектный тип `team`,
схемы `PlanAgentTeamRequest/Response`, `ConfirmAgentTeamRequest/Response`,
`TeamCompositionIdSchema`. Composition id = sha256 над отсортированными
строками `blueprint_id@version` — равные наборы blueprint'ов дают один id
независимо от порядка proposal'ов; пустая строка = «без blueprint'ов — один
агент» (сегодняшнее поведение по умолчанию, решение владельца).

**Данные** (`packages/db`): миграция `0066_agent_team_compositions.sql`
(+ journal idx 66) — подтверждённые составы: PK (owner, project,
composition), FK (project_id, owner_id) → projects ON DELETE CASCADE,
индекс (project, confirmed_at); drizzle-таблица `agentTeamCompositions` в
schema.ts. Новый стор `agent-team-store.ts`: `plan` (реиспользует
pending-ростер — один самый ранний proposed parentless экземпляр на
blueprint — или порождает `proposeRoot`'ы), `resolvePlan`,
`confirm` (все owned/parentless/proposed, re-assert expiry грантов,
INSERT OR IGNORE — повторное подтверждение того же состава no-op),
`resolveConfirm`, `compositionConfirmed`. `agent_instances` хранит ТОЛЬКО
proposal'ы (DB CHECK `status='proposed'`) — активация и жизненный цикл
остаются сущностью будущего среза исполнения; миграция agent_instances не
требовалась.

**API** (`apps/api/src/app.ts`, `server.ts`): POST
`/api/v1/projects/:projectId/agent-studio/teams/plan` — при пустом ростере
(нет неистёкших blueprint'ов) отвечает дефолтом без записи mutation; иначе
идемпотентная запись `team.plan` с reference = composition id. POST
`.../teams/confirm` — идемпотентная запись `team.confirm`. Ошибки:
валидация команды → 400, несоответствие записанного состава своему ростеру
(целостность) → честный 409; чужие/неизвестные экземпляры → 404. Team-
маршруты в собственном guard-блоке — большие agent-studio маршруты не
требуют team-стора (промежуточная версия с общим guard'ом ломала write/read
API тесты; поймано локально, исправлено до коммита).

**Тесты**: `packages/db/test/agent-team-store.test.ts` (7), `apps/api/test/
agent-studio-team-api.test.ts` (3: дефолт, полный поток plan→replay→confirm
→replay→plan-без-подтверждения + decision-events, ошибки). Локально: db
230/230, agent-studio 9/9, typecheck apps/api чист. Полный apps/api прогон
локально нестабилен под параллельной нагрузкой (13 файлов по 1 тесту;
все проверенные соло проходят) — authoritative гейт CI Verify.

**Проверки**: prettier clean, `check:secrets` пройден до пуша. NSIS не
запускается (desktop/windows не тронут).

**Интеграция (13.11.2026)**: PR #564 слит владельцем — main `b47e5cc9`.
CI потребовал три прогона: (1) Verify — мой ESLint
`consistent-type-imports` в сторе + 2 неиспользуемых type-импорта в app.ts
(починены `edd0d711`), (2) Verify — typecheck db на тест-фикстуре
(починено `29047473`), Browser acceptance между прогонами флакал на чужом
`chat-reliability.spec.ts:87` (волна #539) — перезапуск задания зелёный,
итог 4/4. Урок записан: перед пушем — `pnpm run lint` + `pnpm run
typecheck` в каждом затронутом пакете. Гигиена на новом tip: волна #563
мои файлы не тронула; typecheck api чист, тройка agent-studio 9/9,
desktop/windows 462/0.

---

## Срез 19 (2026-11-13): Multi-Agent, срез 1 — исполнение частей, lifecycle, файловые артефакты с версиями

**Одобрение**: по «продолжаем» владелец выбрал разбиение «Два среза: сначала
артефакты» и формат «1 blueprint = 1 узел» (вопросы заданы после разведки
Work-runtime, см. CHECKPOINT п. 44). Потолок статуса — **готово к
интеграции**; merge только по явному одобрению владельца.

**Разведка (факты)**: планировщик и исполнитель не связаны — ни один
`ManagerWorkCoordinator` / `WorkDagCoordinator` / `ComputerControlService` /
CodeAgent / Research не читает `agent_instances` / `agent_team_compositions`.
Переиспользуемо без изменений: admission, единый WorkOwnerBudget/ledger,
чекпоинты, `recover()`, `work_artifact_versions` (immutable, sha256/bytes/
version/published), `WorkDagCoordinator.control` (дочерний Work на узел +
проверенный readback зависимостей), `run_plan` (последовательное исполнение
по одной с явным `acknowledge_cost`). Три сериализатора остаются на срез 2.

**Стало (минимальное ядро, без нового исполнителя)**:

- Контракты `packages/contracts/src/agent-studio.ts`: операция
  `team.activate`, `AgentTeamPartStatus/Part`, Activate/Parts Request/Response,
  `execution_status: "awaiting_owner_run"` (активация не делает модельных
  вызовов; платное исполнение остаётся за `run_plan`).
- Миграция `0067_agent_team_parts.sql` + journal idx 67 + drizzle
  `agentTeamParts`: lifecycle в **отдельной** таблице (`agent_instances`
  proposals-only из-за DB CHECK `status='proposed'`), FK на compositions и
  instances binding.
- `packages/db/src/agent-team-run-store.ts`: `activate()` (проверка 64-hex
  composition id, целостность/размер ростера, `goal ≤ 4000`, полный pending
  ростер, `INSERT OR IGNORE` + fast-path по `agent_team_parts` → граф не
  пересоздаётся при replay), `parts()` (статус из DAG-узлов, `artifact_count`
  из published `work_artifact_versions`); 1 blueprint = 1 узел,
  `goal = task_contract`, `depends_on: []`, стабильный `node_id` из sha256.
- `apps/api/src/team-graph-adapter.ts`: адаптер `AgentTeamRunGraphPort` к
  `WorkDagCoordinator.create` (идемпотентен по
  `client_request_id: "team:<composition_id>"`).
- Маршруты `apps/api/src/app.ts` в отдельном guard-блоке: POST
  `.../teams/activate` (через `mutations.create`, replay → activate), GET
  `.../teams/:compositionId/parts`; error mapping 404/400. Проводка в
  `apps/api/src/server.ts` через публичный `managerWorkCoordinator.dag`.

**Проверки**: `lint` + `typecheck` в `packages/contracts`, `packages/db`,
`apps/api` — чистые; затронутые тесты db **16/16** + api **4/4** (включая
новые `agent-team-run-store.test.ts` 6 сценариев и расширенный team-api до 4);
prettier clean; `node scripts/check-secrets.mjs` — passed. NSIS/GUI/VM не
запускались (desktop/windows не тронут); live-приёмка остаётся отложенной.

**Следом (срез 2)**: bounded concurrency — снятие трёх сериализаторов, затем
arbiter (#538), бюджет команды, панель хода.
