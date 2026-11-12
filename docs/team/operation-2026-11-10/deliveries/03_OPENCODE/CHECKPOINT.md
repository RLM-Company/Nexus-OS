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
14. **Срез 4 — guard полноты графа упаковки (реализован, коммит `2ee7079a`)**:
    пропущенные из build.files модули (`diagnostics.cjs`, `session-cleanup.cjs`)
    делали бы EXE неработоспособным; существующий preflight ловил только свой
    список. Новый `ci/check-package-graph.cjs` обходит граф require'ов от main.cjs
    (56 файлов) против build.files + тест package-graph (2 сценария) — теперь это
    часть `npm run check`. **npm run check: exit 0, 443 теста (0 fail)**.
15. **Аудит `ci/gui-acceptance-fixture.cjs` (509 строк) завершён — нарушений не
    найдено**: воспроизводимый сценарий приёмки упакованного EXE, две фазы
    (first-launch; relaunch-and-recovery). Гарды подтверждены: явный отказ вне
    подготовленной GUI-среды (стр. 335), workRoot заперт в RUNNER_TEMP с отказом
    иначе (336–340), EXE обязан быть установленным Kosmora.exe внутри workRoot
    (341–352), папка загрузок только новая + отказ чистить перенаправленный путь
    (353–356; 470–473), spawn с per-process таймаутом и windowsHide (299–331),
    враждебный и валидный deep-link через второй инстанс (365–369); ассерты
    покрывают восстановление origin/route, owner-B изоляцию, offline-recovery и
    logout-очистку (397–443); при падении пишется сводный отчёт с чекпойнтами
    (445–464). Нюанс (не нарушение): конфиг и отчёты фаз лежат в системном tmpdir
    с runId-именами и убираются в finally (358–362; 465–474); жёсткий краш
    процесса оставит файлы в %TEMP% — для hosted-раннера незначимо.
16. **Пакет «семантическая оценка содержимого» подготовлен (data-only, коммит на
    desc-ветке)**: фикстура v2
    `packages/db/test/fixtures/semantic-experience-distill-semantics-evaluation.json`
    — НОВЫЙ файл; v1 не тронут, RESUME прогона №2 (fixture_sha256) в безопасности
    (фикстура хешируется как один файл, ссылка в bench — ровно одна, стр. 68).
    Кейсы encoding'ают условия/отрицания/причинность как must-carry анкеры
    (relevant_literals) и «перевёртыши» как ловушки (forbidden_literals,
    документировано: ловушки намеренно вне исходника). Точка применения —
    расширение bench'а флагом `--fixture` ПОСЛЕ завершения прогона №2; решение о
    внедрении за владельцем.
17. **Аудит `desktop/windows/desktop-recovery.cjs` (103 строки) — нарушений не
    найдено**: восстановление хранит только минимальное first-party UI-состояние.
    `safeWorkspaceRoute` — строгий белый список: только статические пути, известные
    view/surface, UUID-валидация project/chat, запрет hash/backslash/`..`/%-encoding
    в пути и НЕизвестных query-ключей, каноническая пере-сериализация параметров
    (стр. 25–81) — произвольные query при сохранении не выживают. `isLoginOrLogout`
    — same-origin login/logout/signin/signout (83–90); `isExplicitLogout` — только
    plain-`/logout` и plain-`/signout` без hash/query (92–101). Замечание (не
    нарушение): hosted-выход с query/hash (`/logout?reason=…`) в явный набор не
    попадает — storage-очистка среза 3 для него не сработает (меню-выход покрывает
    этот край). Ослабление набора — возможное будущее изменение интерфейса;
    фикс-объём в срез не входил; решение за владельцем.
18. **Аудит очереди «обновление»: `update-policy.cjs` (107 строк) +
    `update-service.cjs` (238 строк) + CI-гард `ci/verify-unsigned-policy.cjs` —
    нарушений не найдено**. Правило «unsigned не превращать в автообновление»
    держится на трёх уровнях: (1) политика манифеста — fail-closed без
    закреплённого ключа («Обновления отключены»), фиксированный набор полей,
    Ed25519 над canonicalJson (с проверкой прототипа объектов), expires-свежесть,
    same-origin path-only `.exe` без query/hash/credentials, потолок пакета
    300 МБ (36–98); (2) сервис — fetch c `redirect:"manual"` и отказом на любой
    3xx/изменённый URL (13–30), манифест ≤ 16 КиБ (9, 32–49), stage()
    переподтверждает подписанный манифест и активный origin перед записью и
    после неё (123–134, 183–185), временный файл `wx` 0o600 с потоковым лимитом
    ≤ подписанного размера и финальным SHA-256, атомарный rename (139–186);
    исполнение установщика из приложения не происходит (182). `previousVerified`
    не считает mutable-профильный index якорем доверия — перед «проверенным
    откатом» перепроверяются подпись закреплённым ключом и байты файла
    (208–233). (3) CI — гард требует `trust.publicKeyPem === null` (месседж
    «Unsigned candidate must not silently enable the update channel», 89–94) и
    поведенчески проверяет `check()` → "disabled" с fetcher'ом, бросающим на
    любой сетевой вызов (95–108); туда же NSIS-асерты `oneClick:false`,
    `perMachine:false`, `deleteAppDataOnUninstall:false` — локальные данные
    владельца при удалении сохраняются (20–25). Замечание (не нарушение):
    content-length сверяется лишь при наличии заголовка — без него защиту
    полностью держат потоковый лимит и финальная сверка SHA-256/размера
    (151–153, 165, 180).
19. **Аудит кластера «права»: `draft-session-gate.cjs` (41 строка) +
    `owner-session.cjs` (81 строка) — нарушений не найдено**. Гейт черновиков:
    одна пара {origin, owner} на версию документа, доступ к scope только после
    его фактической загрузки в документе, `reset()` на каждой навигации
    (12–24, 25–29, 30–37) — страница не может молча сменить владельца или
    тронуть не-загруженный scope. Верификация владельца: same-origin
    `/api/v1/identity/sessions`, отказ на не-200/изменённый URL/redirect
    (`redirect:"manual"`), строгий content-type JSON, 32 КиБ потолок
    одновременно по content-length И по реальному потоку (23–38), разбор +
    `activeOwnerFromSessions` с отказом при любой аномалии; транспортная ошибка
    честно даёт "offline" — отказ авторизации и offline не смешиваются.
    Electron-адаптер
    пиннинг пустого `response.url` только у себя (документированный квест
    Electron 44, 52–59) и «Redirect was cancelled» = отказ авторизации,
    никогда не offline-фолбэк (66–71). Расхождений с очередью «обновление»
    нет: обе ветки доверяют только проверенному same-origin ответу.
20. **Интеграционная волна Codex на main и merge-разрешение (коммит
    `e964e7da`)**: main получил обновления за ночь — guard portability из #502
    (`ef54c468`), диагностику = мой срез 2 (`0358acd2`), Windows 0.27 candidate
    с faults-контрактом (`9a971e22`, `338ee9a4`, `37b552d9`) — ветка стала
    CONFLICTING ровно по двум файлам (`main.cjs`, `package.json`); остальное
    авто-merged. Разрешено по правилу «новые контракты main сохранять, свои
    дельты вернуть»: `main.cjs` — require `session-cleanup` держит наш (у main
    соперника нет), `faults: status.faults` держит main (поддержка поля видна в
    авто-merged `diagnostics.cjs` и его тестах); `package.json` — union: их
    цепочка check + наш `node --check session-cleanup.cjs` в той же позиции,
    их build.files + наш `"session-cleanup.cjs"`. Детерминированный резолвер
    в `tmp/` (не коммитится; никаких автопиков). Проверки после: `node --check
main.cjs`, package.json parse, prettier clean (оба файла), `npm run check`
    → exit 0, **443 теста / 0 fail**; PR #502 снова на CI.
21. **Дельта-аудит `connection-policy.cjs` (146 строк) + полный аудит
    `smoke-mode.cjs` (66 строк) — нарушений не найдено**. Первая очередь уже
    покрывала `normalizeServerOrigin` (HTTPS для remote, HTTP только loopback,
    отказ user:pass, origin-only — CHECKPOINT п. 1 очереди №1). Дельта:
    `isSafeExternalUrl` — во внешний шелл уходят только https/http/mailto без
    учётных данных в URL; `javascript:`, `file:`, `chrome-…` блокированы
    (50–57); загрузки проверяют ВСЮ цепочку redirect'ов на same-origin или
    same-origin `blob:` (59–73); имена загрузок чистятся от Windows-запрещённых
    символов, trailing dots/spaces, потолок 180 (75–83), перезапись запрещена —
    суффикс «(1)» (85–96); generation-gate отменяет superseded-попытки — они не
    могут ни записать, ни перечитать решение (98–134). Нюанс (не нарушение):
    зарезервированные имена (CON, NUL, COM1) не экранируются — их честно
    отвергает fs. `smoke-mode.cjs`: вход только по явному флагу argv
    `--cosmora-smoke-test`, без env-автовключений (9–11); payload строго из
    упакованного win32/x64 с абсолютными путями (23–43); маркер пишется только
    в tempdir с regex-allowlist `cosmora-smoke-…json` и 0o600 (46–64) — на
    машине владельца приёмочный режим не открывается ни под каким видом.
22. **LLM-дистилляция: прогон №2 завершён — REPRODUCED true (desc-ветка,
    PR #515)**. RESUME-рестарт после обрыва сервера дошёл до конца: 13/13
    кейсов, повтор воспроизвёл метрики первого прогона (жадное декодирование;
    parse_ok 10/13, within_budget 10/13, median_reduction 1,
    fabricated_file_tokens 1, stale_step_leak 16, declared_lost 2/recover 1 —
    ограничения честно перечислены в теле PR #515). Инцидент по пути: обрыв
    вчерашнего вечера оставил живой zombie-процесс прогона (PID 13468, ~1.1 ГБ,
    застрял на последнем кейсе на ~10 ч, partial не обновлялся) — он выдавил
    рестарт в OOM (exit 134, свободно было 0.6 ГБ); процесс убит, partial цел,
    рестарт с `--max-old-space-size=2048` прошёл успешно. Отчёт
    `-repeat.json` закоммичен (`356efc41`), partial удалён самим bench; строки
    очередей «Опыт выполнения» в RUFLO/GEMINI-доках обновлены — «измерена
    (measurement-only), внедрение — решение владельца» (`59176fba`); PR #515
    открыт только с отчётом, merge не делать. Фикстура v1 и bench во время
    прогона не менялись.
23. **Решение владельца исполнено: PR #502 и PR #515 слиты в main**. #502 —
    merged 07:19:47Z после полностью зелёного CI на `cdf442eb`; #515 — 07:20:45Z
    следом (mergeable подтверждён после пересчёта; конфликт очередей разрешён
    ранее union-ом в `9b1cb0a1`: текст main с экстрактивной дистилляцией и
    conformance-панелью сохранён, добавлена дельта «LLM-поворот измерён,
    REPRODUCED true», семантическая оценка — подготовлена). Авто-merge на
    уровне репо отключён GitHub'ом — мержено вручную по явному решению
    владельца. Прогон №3 (фикстура v2 semantics, 4 кейса, measurement-only,
    без reference-аргумента — базу создаёт сам прогон) запущен в фоне; ему
    предшествовал протокольный шаг 1 — флаг `--fixture` в bench (`fe2e981d`,
    дефолт v1 не изменён, prettier-clean, node --check pass). На момент записи
    закрыт первый кейс v2 (`conditional-anchors-all-safe`, partial 1/4).
24. **Прогон №3 завершён; отчёт оформлен (PR #523, merge — решение владельца)**.
    4/4 кейса, exit 0, partial удалён bench'ем; отчёт data-only
    `experience-llm-distill-semantics-2026-11-10-report.json` закоммичен в
    desc-ветке (`dd9158bd`), протокол дополнен итогом (статус-блок обновлён).
    Честные числа: parse_ok 3/4, deterministic_pairs 4, forbidden_carried 2,
    relevant_carried 11/14, declared_lost recovered 2/3, fabricated_file_tokens
    0, stale_step_leak 4, within_budget 3/4, median_reduction 1 (extractive
    0.7935). Это НЕ воспроизведение прогона №1 (другая фикстура, другой sha).
25. **Срез «Повторить» для прерванных загрузок — реализован (явное одобрение
    владельца, VISUAL_WAITLIST п. 1)**. Ретрай возможен только пока главный
    процесс помнит исходный URL в памяти сессии: `download-center.cjs` хранит
    `retrySources` (id → {url, origin, epoch}, потолок 50; запись при capture из
    первого элемента redirect-цепочки — она уже прошла полный policy-gate;
    удаление при завершении, кроме interrupted; полная очистка при invalidate).
    Ручной IPC `cosmora:downloads:retry` перепроверяет: авторизацию окна
    (sender/frame/url/origin/epoch/owner), актуальность origin/epoch источника,
    `history.statusOf(scope, id) === "interrupted"` (новый метод в
    `download-history.cjs`), живое главное окно с разрешённой same-origin
    страницей (`isAllowedRemoteNavigation`); повтор идёт через
    `webContents.downloadURL()` БЕЗ навигации и заново проходит весь
    will-download policy-gate (fail-closed). URL не попадает ни на диск, ни в
    рендерер — контракт окна «Ссылки скачивания не сохраняются» соблюдён; в
    public-записи только булев флаг `retryable`. Рендерер: кнопка «Повторить»
    только у interrupted с `retryable`, общий стиль `button`, компоновка не
    менялась. Тесты: 4 новых в download-center (happy path с проверкой «URL не
    на диске», отказы completed/unknown/stale-owner/stale-origin, требование
    разрешённой страницы, очистка при invalidate) + `statusOf` в
    download-history; `npm run check` → **448 тестов / 0 fail**, prettier clean.
    Ограничение зафиксировано в DELIVERY: после рестарта приложения ретрая нет.
26. **Диагностика CI-fail на #525: поломка format-gate на уровне main; фикс
    передан в #523 (`73bf04f1`)**. Лог job 130397877659 (run 42983102536):
    шаг «Run quality gate» → `pnpm check:core` → `prettier --check .` падает на
    `docs/research/experience-llm-distill-2026-11-10.json`. Это первый отчёт
    дистилляции из моего коммита `316405d0` (desc-ветка, 10.11): закоммичен без
    prettier и через merge #515 (`d047ce12`) попал в main; в ops-ветке файла нет
    (не существовал на BASE_SHA), поэтому чинить на ops = add/add-конфликт.
    Тот же fail уже горел на #523 (job 130395167198) — раннее предположение
    «CI на desc-ветке нет» было ошибочным, исправлено. #502 зелёный честно
    (`316405d0` не предок его merge-ref). Фикс: `prettier --write` файла на
    desc-ветке (`73bf04f1`), контент не менялся (JSON.parse deep-equal,
    canonical 10538 байт до/после); тело #523 дополнено. Порядок дальше:
    merge #523 первым → main проходит format-gate → пуш локального
    ops-док-коммита перезапускает CI #525 → зелёный.
27. **Повторный CI #523 — зелёный 3/3** (Verify monorepo 4m18s, Browser
    acceptance 9m16s, Code sandbox 33s; run 42985500695): формат-фикс
    `73bf04f1` подтверждён; #523 готов к merge владельцем.
28. **Аудит vault-UI кластера (`vault-console` / `vault-workspace` /
    `vault-preload` + рендерер) — нарушений нет, код не менялся**. Покрытие
    сверено с item 10 (там — только хранилище `local-vault`); здесь — слой
    окна/аренды:
    - `vault-preload.cjs`: единственный frozen-мост `kosmoraVault.command`,
      один канал — минимальная поверхность;
    - `vault-console.cjs`: `trusted()` = sender + senderFrame + mainFrame +
      URL === страница (fail-closed); `authorized()` перепроверяет epoch,
      identity и binding и вызывается ЗАНОВО после каждого диалога (выбор
      папки/файла, экспорт, remove, send) — TOCTOU-узор; окно: sandbox,
      contextIsolation, отдельная partition `kosmora-local-vault`, deny
      window-open, запрет navigate/redirect; import: lstat (isFile, не
      symlink, nlink=1, ≤10 МБ) + O_NOFOLLOW + fstat-перепроверка ino/dev/size;
      snapshot: redirect manual + равенство URL + content-type JSON + потолок
      4 МБ + re-auth после fetch; export: флаг `wx` и mode 0600 (без
      перезаписи); busy-сериализация; честные сообщения без секретов;
    - `main.cjs` проводка (1420s): `isTrustedRemoteEvent` (main-окно,
      same-origin, не login/logout) на `kosmora:vault-open/-read-context/
-ack-context`; read-context перепроверяет trust ПОСЛЕ await;
    - `vault-workspace.cjs`: аренда контекст-связная (owner+origin), 30 мин,
      revision-fingerprint (любое изменение хранилища отзывает), префикс
      `.kosmora-vault` строго readonly (только list/find/read; запись,
      upload и protected-path отклоняются), валидация курсоров/фингерпринтов
      против устаревших страниц, выдача ограничена 14 000 байт JSON,
      обрезка сниппетов уважает границы UTF-8/UTF-16;
    - рендерер `vault.html/js`: CSP `default-src 'none'; connect-src 'none';
img-src 'none'`; весь динамический контент через textContent/
      createElement — безопасно при враждебных именах файлов; честный текст
      окна («Файлы в папке не зашифрованы»);
    - тесты: критичные поведения консоли покрыты внутри
      `local-vault.test.cjs` («native console rejects remote/subframe
      commands…», «rechecks identity after a delayed folder dialog»);
      механика аренды — `vault-workspace.test.cjs` (1238 строк). Отдельного
      `vault-console.test.cjs` нет — замечание зафиксировано, действий не
      требует.
29. **Аудит мостов и хелперов (`preload.cjs`, `draft-store.cjs`,
    `tool-result.cjs`, `checkpoint-text.cjs` + draft-проводка main.cjs) —
    нарушений нет, код не менялся**:
    - `preload.cjs`: для file:-страницы только connection-мост; для
      hosted-контента (http/https) четыре bounded-моста — vault
      (open/read/ack/onContext), draft (load/save/clear/flush), computer
      open, work open/onResult; никакого screen/keyboard/mouse/shell/
      filesystem RPC; наблюдение (не нарушение): `Object.freeze` применён
      только к `kosmoraDesktopVault`, остальные три моста без freeze
      (defense-in-depth несимметрия; поверхность API при этом фиксирована
      contextBridge);
    - `draft-store.cjs`: DPAPI-codec обязателен (отказ без защищённого
      хранилища — честный); имена файлов sha256(origin\0owner) — та же схема
      изоляции scope, что у vault/downloads; validateDraft отклоняет
      credentials-тексты (Bearer/пароли/api-key/токены/GitHub-PAT/sk-/PEM)
      от локального сохранения; чтение перепроверяет binding ВНУТРИ
      шифротекста (ownerId+origin+scope+savedAt) — скопированный шифротекст
      другого пользователя/scope не восстанавливается; запись атомарная и
      bounded (40 записей, 5.3 МБ, 30 дней, newest-first); clearAll удаляет
      только файлы вида `[0-9a-f]{64}.json`;
    - draft-проводка main.cjs (1519s): все четыре канала за
      `isTrustedRemoteEvent`; save/clear — epoch/origin перепроверки внутри
      очереди + `draftSessionGate.allowWrite` (documentVersion+origin+owner+
      scope); `draft-flush` (pagehide, best-effort) намеренно без сетевого
      roundtrip — переиспользует ТОЛЬКО ранее серверно-подтверждённого
      неистёкшего владельца из gate + кросс-чек ownerCache (owner/origin/
      expires), синхронная запись шифротекста, без plaintext-фоллбека и
      скрытых ретраев; rationale задокументировано в коде;
    - `tool-result.cjs`: полный receipt при ≤16000 байт; иначе честный
      excerpt с `excerpt_only: true`, `original_characters` и инструкцией
      «не проигрывать действие заново, не выдумывать значения» — контракт
      нетронутых «квитанций» соблюдён; покрытие — computer-control.test;
    - `checkpoint-text.cjs`: общий SENSITIVE-фильтр для целей/планов Work;
      прямых тестов нет (наблюдение; семейство регулярок покрыто через
      draft-store.test);
    - покрытие: draft-store.test / draft-isolation.test /
      draft-session-gate.test / gui-acceptance.test; computer-control.test.
      Карта остатка после этого аудита: `computer-api-client`,
      `computer-preload`, `computer-workspace`, `computer-session` (Codex),
      work-кластер (`work-cycle-*`, `work-experience`, `work-result`,
      `work-retry-guard` — пересечение с Codex/desc).
30. **Аудит computer-остатка (`computer-preload.cjs`, `computer-api-client.cjs`,
    `computer-workspace.cjs` + каналы в `computer-console.cjs`) — нарушений
    нет, код не менялся**. Консоль/политика/история/драйвер уже покрыты
    прежними аудитами (item 10-серия); здесь — оставшаяся тройка:
    - `computer-preload.cjs`: фиксированный набор invoke-каналов
      (availability/workspace/browser/projects/start/stop/resume/history/
      recover/accept/clearHistory + onStatus/onPrefill) — прямого RPC за
      пределами списка нет; наблюдение: без `Object.freeze` (та же
      defense-in-depth несимметрия, что у остальных мостов);
    - `computer-api-client.cjs`: route только `/api/v1/…` без `?`, `#`, `\`;
      130-секундный дедлайн + внешний signal через `AbortSignal.any`;
      identity берётся ДО запроса с `expected`-binding (origin+owner) и
      ПОСЛЕ ответа (смена идентичности отклоняет уже обработанный сервером
      результат — TOCTOU-узор); redirect manual, равенство response.url,
      content-type JSON, bounded чтение (200 КБ, reader.cancel в finally),
      UTF-8 fatal-декодирование (мусор не подменяет текст молча); коды
      ошибок сервера пропускаются только через whitelist; `begin`: случайный
      client_secret (32 байта base64url), ответ обязан совпасть по id,
      planner обязан быть model_gateway/provider (mock отклоняется —
      честное COMPUTER_LIVE_MODEL_REQUIRED), при сбое — best-effort DELETE
      с тем же id/token («cancellation is safe… never recreate or retry»);
      `next`: строгая валидация decision_source (kind/mode, provider_id≠
      mock, session_id, step, run_id-UUID, длины provider/model);
      `authorize`: sha256-хэш действия; `end`: DELETE с 5-секундным
      дедлайном; покрытие — computer-api-client.test;
    - `computer-workspace.cjs`: codec обязателен (fail-closed); scope-привязка
      owner+origin на snapshot до и после операции; uploadFile/reserveDownload/
      verifyDownload — через `resolveSafeWorkspaceTarget` (root-scoped),
      no-overwrite (`wx`, mode 0600, до 100 попыток), санитизация имени
      (win32 basename, управляющие символы → `_`, хвостовые точки/пробелы,
      ≤150), verifyDownload — двойная стат-перепроверка (size/mtime/ino/dev)
      с bounded-receipt; `execute`: binding до/после, bounded параметры
      (30 записей/15 результатов/10 КБ чтение), `workspace_update` требует
      полного чтения версии перед заменой (честная ошибка конфликта),
      `result.rootPath` вырезается из выдачи (путь серверу не утекает),
      выдача ограничена 15000 байт; workspace/*-внутренности — зона Codex
      (граница аудита: обёртка); покрытие — computer-workspace.test;
    - каналы workspace-status/select в console: `trusted(event)` +
      `checkedContext` + identity-перепроверка после диалога выбора папки;
      при ошибке — invalidate.
      На этом map остатка (в-sphere): пусто; вне границы остались только
      `computer-session` и work-кластер (Codex/desc — их аудируют их пакеты).
31. **Срез: паритет hosted-выхода для URL с query/hash — реализован (явное
    одобрение владельца; закрывает единственную записанную функциональную
    недоделку)**. `isExplicitLogout` (desktop-recovery.cjs) ранее требовал
    `!u.hash && !u.search`, поэтому `/logout?reason=…`, `/logout#…`,
    `/logout?next=…` не считались явным выходом. Частичный паритет уже
    покрывал такие URL через `isLoginOrLogout` в did-navigate (epoch++,
    invalidate поверхностей, сброс draft-gate), но файлы черновиков и данные
    браузерного сеанса после такого выхода оставались. Теперь дискриминатор —
    тот же same-origin + точный путь `/logout`|`/signout`; query/hash больше
    не дисквалифицируют, subpath и чужой origin не проходят. Направление
    fail-safe: потребители (clearDraftsForHostedLogout в will-navigate и
    did-navigate-in-page, clearBrowserSessionData в did-navigate) — очистка
    «больше, не меньше»; clearDraftsForHostedLogout идемпотентен (двойное
    срабатывание безопасно), тайминг alsoClearSession сохранён (wipe не
    раньше коммита навигации). Тестовый кейс «logout?next=чужой-origin»
    перевёрнут в true с rationale (cleanup не следует за redirect-целью);
    добавлены кейсы ?reason=, #top, ?step=, logout/other → false.
    `npm run check` → **448 тестов / 0 fail**, prettier clean.
32. **Срез: hardening мостов + прямые тесты checkpoint-text — реализован
    (выбор владельца «бери то, что хочешь»; закрывает оба записанных
    наблюдения item 29, без изменения поведения)**.
    (а) `Object.freeze` вокруг объекта API доведён до **9/9**
    contextBridge-мостов. Заморожены в срезе: `cosmoraDesktop`,
    `kosmoraDesktopDraft`, `kosmoraDesktopComputer`, `kosmoraDesktopWork`
    (preload.cjs), `kosworkComputer` (computer-preload.cjs) и
    `kosworkBrowser` (work-cycle-preload.cjs — найден при полной
    перепроверке карты после основных правок: первый grep был обрезан,
    шестой мост выпал из поля). Уже были заморожены ранее:
    `kosmoraDesktopVault`, downloads- и vault-мосты. Freeze —
    defense-in-depth: поверхность renderer-API фиксирована, мутация со
    стороны страницы не может изменить набор каналов; каналы IPC и
    поведение не менялись.
    (б) Новый прямой тест `test/checkpoint-text.test.cjs` (2 теста,
    31 кейс) закрывает наблюдение «нет прямых тестов у checkpoint-text»:
    22 flagged-кейса (Bearer, password/passwd, api-key/api_key,
    access-token, secret, пароль/ПАРОЛЬ — кириллица с iu-флагами,
    код/ПИН 4–8 цифр, em-dash-разделитель, ghp_/gho_/github_pat_, sk-,
    PEM RSA/OPENSSH) и 9 allowed-кейсов (пустая строка, реальные цели,
    «шаг 3 из 5», номера заказов, даты, «кодировка…» — «код» без цифр
    рядом не срабатывает, «run code review», UUID чата).
    `npm run check` → **450 тестов / 0 fail** (448 + 2), prettier clean.
33. **План внедрения дистилляции «Опыт выполнения» — документ решения
    подготовлен (без кода; реализация — выбор владельца)**.
    `docs/product/EXPERIENCE_DISTILL_PLAN_RU.md`. Фактура собрана из main:
    shipped-поток reference (buildWorkReference → accepted-example.v1,
    reference строится на лету на каждый запрос planner'а сессии, hash-конфликт
    на API, схема strict: additionalProperties false, план 1–8, маркера
    частичного плана нет; защита от наследования грязных данных сегодня —
    только промпт-рамка WORK_REFERENCE_RULES) + оба измерения (детерминированный
    кандидат: медиана 0,7935, запретов 0/32, честные co-location потери;
    LLM-кандидат: №3 — сокращение 1, запрещённых 2, parse 3/4, ~9–14 мин/кейс
    — не готов). Варианты: A — скраб внутри текущего формата (только
    desktop/windows, defense-in-depth поверх рамки; честные минусы: немаркированная
    частичность плана, co-location потери, сокращение переизмеряется — counts
    сохранены); B — скетч как отдельный формат (кросс-пакет: contracts/api —
    сфера Codex); C — отложить; LLM — не на сейчас. Рекомендация: A первым
    шагом, B — после кросс-пакетной договорённости. Решение владельца.
34. **Срез: вариант A дистилляции — скраб внутри формата реализован (вариант
    выбран владельцем 2026-11-11)**. Новый модуль
    `desktop/windows/work-reference-scrub.cjs` — адаптация измеренного
    кандидата `extractive-drop-candidate-v1` (bench-вербатимные 7 классов
    запрещённого + сплиттер предложений; происхождение указано в шапке).
    `buildWorkReference` применяет его к выдаваемому
    `koswork.accepted-example.v1`: цель — точный префикс до начала первого
    устаревшего предложения (кап 500 и well-formed-механика прежние,
    re-join не используется), план — без шагов с любым запрещённым
    фрагментом (дроп целиком, консервативно); `tool_observations` не
    тронуты; revision остаётся sha256 ИСХОДНОЙ записи (не зависит от
    обрезок). Честные отказы вместо ослабления: цель, начинающаяся с
    устаревшего предложения, и план, где запрещённое есть в каждом шаге
    (schema minItems: 1), → COMPUTER_REFERENCE_UNAVAILABLE (canReference →
    reusable:false в истории). Corrections (`confirmed-correction.v1`) не
    скрабятся — вне одобренного объёма. Зарегистрирован в build.files и
    check-скрипте package.json. Унаследованная особенность задокументирована
    в тесте, не «замазана»: `\b` без u-флага — ASCII-only, кириллические
    альтернативы (`пароль:`, `см.`, `ревизия`) срабатывают только после
    ASCII-словесного символа; паттерны остаются bench-вербатимными (измеренная
    база 0/32 получена на них), а credential-текст в целях/шагах и так
    отсекается upstream (start/checkpoint). Замер на замороженной панели v1
    (13 кейсов, read-only): медиана отношения 0.8311, 13/13 измерено,
    отказов 0; чистые примеры не сжимаются (1.0), грязные — до 0.6052;
    ниже bench-медианы 0.7935 — ожидаемо (counts и формат сохранены).
    Пред-проверка из плана выполнена: фиксации полного равенства плана на
    API-стороне нет. Существенный кейс «укороченная цель» переведён на
    словесный наполнитель (24+ ASCII-пробег теперь классифицируется как
    credential_token и честно отказывается — rationale в тесте).
    `npm run check` → **458 тестов / 0 fail** (450 + 7 модульных + 1
    интеграционный), prettier clean, `check:secrets` пройден до пуша.
35. **Срез: фикс кириллических границ в скрабе (одобрено владельцем
    2026-11-12)**. Причина: `\b` в JS без u-флага — ASCII-only, поэтому в
    двух паттернах кириллические альтернативы фактически были мёртвы
    (`пароль:`, `см.`, `ревизия` после пробела не матчились; ASCII-формы
    работали). Фикс: в `credential_assignment` и `date_or_old_ref` левая
    граница `\b` заменена на lookbehind `(?<![\p{L}\p{N}])` (u-флаг
    добавлен); для «ревизия» сохранён хвостовой `(?![\p{L}])`
    (воспроизводит bench-`\b` для цифр: «ревизия3» матчится, «ревизияXYZ» —
    нет). Направление fail-safe (больше очистки); встроенные слова не
    ловятся (guards: «выключатель:», «аппароль:», «ID2026-11-01»). Шапка
    модуля фиксирует одобренное владельцем расхождение от
    bench-вербатимности с обязательством повторного замера. Замер повторён
    на замороженной панели v1: числа идентичны до фикса (медиана 0.8311,
    13/13 измерено, отказов 0); диф-пробник (старые vs новые паттерны по
    каждому шагу и предложению панели) показывает почему: ровно 2 шага
    меняют id вердикта (credential_token → credential_assignment) при том
    же исходе (шаг дропался и раньше по токену-соседу), переключений
    keep→drop нет — панель не дискриминирует фикс, добавленная полнота
    продемонстрирована тестами, а не панелью. Унаследованный нюанс
    задокументирован guard'ом: bench-хвост `\s` после «см./смотри» требует
    пробела, а сплиттер отрезает его у отдельного предложения — босое
    конечное «См.» не матчится (в середине предложения — матчится);
    расширение хвоста — вне одобренного объёма. Новый интеграционный кейс:
    шаг «Внести ключ: 1234-ABCD в журнал» проходит upstream-гейты
    (start/checkpoint — «ключ» не в их списках) и убирается именно
    скрабом; цель «Собери сводку. Смотри задачу #123.» → «Собери
    сводку.»; цель «Третья ревизия. …» — честный отказ end-to-end
    (reusable:false). `npm run check` → **459 тестов / 0 fail** (458 + 1
    интеграционный), prettier clean, `check:secrets` пройден до пуша.
36. **Срез: требования к скетч-формату для кросс-пакетной договорённости
    (выбрано владельцем 2026-11-12 после merge #540; без кода)**. Документ
    `docs/product/KOSWORK_SKETCH_CONTRACT_RU.md` — материал для решения
    владельца и задания пакету 01_CODEX; в чужую сферу не входит. Выполнен
    gate-замер, которого требовал план («B — только если после A остаточная
    ценность подтверждена замером»): на замороженной панели v1 скетч-конструктор
    bench-кандидата на тех же фиксированных паттернах против уже скрабленного
    reference A — медиана скетч/A **0.943** (~6% выигрыша), а с обещанными
    планом маркированными потерями медиана **1.0348** — скетч в медиане
    БОЛЬШЕ reference A; отказов 0. Вывод: байтовый аргумент B после A не
    подтверждён; остаётся ценность честности (маркер частичности),
    хранимого компактного следа (память/история будущего) и выравнивания
    лимитов. В документе — честная вилка: B-полный (новый формат, полный
    объём contracts/api/conformance, ~0% байтов), **B-lite** (опциональные
    маркеры в accepted-example.v1 — маркер без нового формата,
    рекомендация пакета) или остаться на A; решение владельца. Если
    B-полный: поля схемы (включая lost_steps/clipped_steps, prototype,
    const-поля), revision = хэш исходной записи (не скетча), WORK_REFERENCE_RULES
    дополнение, conformance на замороженной панели (REPRODUCED бит-в-бит,
    0 запрещённых, целые подмножества шагов) и пять открытых вопросов до
    кода (пустая цель, точный префикс против нормализации re-join, состав
    маркеров, правило выбора формата, достаточность следа без counts).
    Замер — разовый tmp-скрипт; панель и bench не редактировались;
    docs-only, проверка NSIS в CI не запускается.
37. **Решение по вилке скетч-формата (делегировано владельцем 2026-11-12,
    «выбери сам»)**: решение пакета — **остаться на A**. Основание:
    (1) gate-замер item 36 — медианы 0.943 (скетч/A) и 1.0348 (с метками) —
    байтового выигрыша нет; (2) маркеры потерь дублируют рамку
    WORK_REFERENCE_RULES, которая уже называет те же классы
    наследуемо-запрещённого (пути, получатели, реквизиты, координаты,
    старые ссылки, апрувы), а упоминание дропнутых шагов приглашает модель
    достраивать пробелы — ровно то, от чего рамка предостерегает;
    (3) хранимый компактный след — ценность только при реальном запросе
    память/история-функций (план предусматривает вернуться тогда);
    (4) семантика «пример без молчаливых шагов» уже принята владельцем
    в #537. Записано: строка решения в KOSWORK_SKETCH_CONTRACT_RU.md и
    в EXPERIENCE_DISTILL_PLAN_RU.md; в пакет 01_CODEX ничего не
    передаётся; B-требования остаются материалом на будущее. Дистилляция
    «Опыт выполнения» считается закрытой: A в main (#537, #540),
    B-вилка решена замером, LLM measurement-only, данные и bench в main.
    docs-only.
38. **Срез: план живой приёмки (владелец снял отложение 2026-11-12)**.
    Документ `docs/product/LIVE_ACCEPTANCE_PLAN_RU.md` — проверяемый сценарий
    по записанному отложенному объёму (BACKLOG: «реальная живая приёмка —
    отдельно согласованные live-проверки»; INTEGRATION/ACCEPTANCE_0.11.2;
    README desktop/windows): три механизма на реальном Electron-клиенте
    против живого сервера — A. cookie gateway (вход, identity fetch с
    привязкой к origin, 30-дневное поведение, hosted /logout очистка,
    смена origin), B. DPAPI (сохранение/перезапуск/выход, изоляция A/B,
    честный отказ без DPAPI), C. reconnect при живом сервере (обрыв/возврат
    сети, перезапуск сервера, потеря доступности API, отмена побеждает
    запоздалые ответы) + финальный настоящий пользовательский цикл
    владельца. Матрица 14 сценариев с разделением VM/CI ↔ владелец;
    сборка pack:unsigned:win (unsigned, updater OFF, без секретов);
    повышение версии — отдельный интеграционный commit с Codex. Честные
    факты: NSIS fresh/upgrade/uninstall и sandbox уже в CI — не
    дублируются; логика механизмов покрыта node-тестами; `gui-acceptance.cjs`
    жёстко требует loopback-фикстуру — сценарии против живого сервера
    требуют параметризации origin или live-харнесса (код — отдельный срез
    после одобрения плана). Требует владельца: живой сервер (выкладка —
    отдельно), лицензия/учётные данные, решение о GitHub-секретах для
    VM-сценариев, финальная приёмка на ноутбуке. docs-only.
39. **Срез: live-харнесс — параметризация origin в gui-acceptance (код)**.
    Первый кодовый шаг плана приёмки (item 38, раздел 5 п.1):
    `gui-acceptance.cjs` принимает не-loopback origin только при ДВОЙНОМ
    явном opt-in — `remoteOrigin: true` в конфиге И env-гейт
    `KOSMORA_GUI_ACCEPTANCE_ALLOW_REMOTE_ORIGIN=1` (оба отсутствуют по
    умолчанию → поведение CI без изменений, loopback-фикстура остаётся
    обязательной); удалённый origin строго `https://` (http-удалённый
    отклоняется — паритет с connection-policy); флаг не-boolean трактуется
    как отсутствие; `remoteOrigin` возвращается в разобранной конфигурации
    для наблюдаемости. Fail-closed по дизайну: fixture-прогоны и текущий CI
    не меняются, live-сервер возможен только явно. Тест: gate-кейсы
    (без env-гейта / с env-гейтом / не-boolean флаг / удалённый http)
    в существующем тесте `gui-acceptance.test.cjs` (5/0).
    `npm run check` → **459 / 0 fail**, prettier clean, `check:secrets`
    пройден. Дальше по плану приёмки: open-вопросы владельца (origin
    живого сервера, GitHub-секреты, учётная запись, время участия) →
    подключение live-сценариев в workflow (env-гейт + секреты) → VM-прогоны.
40. **Срез: вайринг live-сценариев в windows-desktop workflow (код)** —
    одобрение владельца «Вайрить сейчас, секреты потом» (2026-11-12).
    (1) Новая фаза `live-smoke` в `gui-acceptance.cjs`: не-loopback https
    origin + оба opt-in'а (`remoteOrigin: true` И env-гейт) + hostname не
    loopback (127.0.0.1/localhost/[::1]); fixture-поля (workspaceRoute,
    draftScope, draftText, downloadDirectory) для фазы не требуются и
    игнорируются; ветка прогона: connection.html в setup-режиме → connect
    БЕЗ учётных данных → честный `/login` живого origin (недостижимый
    сервер = таймаут waitFor → честный красный, не тишина) → инвариант
    бриджей на /login (нет connection-бриджа, есть draft-бридж — как в
    first-launch) → origin сохранён → отчёт `{ok, landedOnLogin, savedOrigin}`
    - quit. Никаких черновиков, загрузок или workspace-доступа в фазе.
      (2) Драйвер `ci/gui-acceptance-live.cjs`: guard'ы disposable-runner
      (DI environment/platform как в пакете), work-root строго в RUNNER_TEMP,
      EXE строго Kosmora.exe внутри work-root; origin только из env
      `KOSMORA_LIVE_ORIGIN` (https, не-loopback, без credentials в URL,
      нормализация schema://host:port, на диск не пишется); пишет конфиг
      (`phase: live-smoke, remoteOrigin: true`), спавнит packaged-приложение,
      ждёт отчёт, валидирует (ok/phase/savedOrigin/landedOnLogin), пишет
      `cosmora-gui-acceptance-live-report.json` (и честный fail-отчёт с
      checkpoint'ом при ошибке); env-гейт приложения остаётся на workflow-шаге.
      (3) Отдельное задание «Live server acceptance smoke» в
      `.github/workflows/windows-desktop.yml`: `needs: build` (артефакт
      installer'а), секрет-гейт уровня шагов (`if: env.KOSMORA_LIVE_ORIGIN
== ''` → шаг-отчёт «skipped» и задание остаётся зелёным no-op, видимым
      в чеках; job-level `if` не может видеть secrets/env — поэтому шаги);
      install NSIS `/S /D=` по образцу `Invoke-Installer`, запуск драйвера
      с `KOSMORA_GUI_ACCEPTANCE_ALLOW_REMOTE_ORIGIN=1`, uninstall `/S`,
      upload отчёта. NSIS-задание не тронуто. Тесты: live-smoke-конфиг
      (обязательность opt-in'ов, отказ loopback/не-boolean/без-гейта,
      игнорирование fixture-полей) + драйвер (parseLiveOrigin 9 кейсов,
      guard-отказы до спавна 6 кейсов). `npm run check` → **462 / 0 fail**,
      prettier clean, `check:secrets` пройден. Реальный live-прогон ждёт
      секрета `KOSMORA_LIVE_ORIGIN` от владельца; без него задание — no-op.

## Что делать следующему запуску (в порядке приоритета)

1. **Merge среза вайринга** (PR с ветки ops/opencode-windows, item 40):
   CI — 4 чека + новое задание live-smoke (no-op до секрета); merge только
   владельцем.

2. **Секрет и origin — решение владельца**: создать GitHub-секрет
   `KOSMORA_LIVE_ORIGIN` (https origin живого сервера) → задание включится
   само на следующем PR/диспетче; затем VM-прогоны (C1-C4, B1/B2/B5, A4)
   → участие владельца (A1-A3, B3-B4) → финальный пользовательский цикл →
   ACCEPTANCE-отчёт.

3. **Очередь владельца**: дистилляция закрыта; Multi-Agent — последний
   раздел; новых продуктовых срезов без указания владельца не начинать.

4. **После любого нового main**: проверить новые общие контракты ПРЕЖДЕ чем
   разрешать конфликты (не автопик своей версии).

## Границы (не нарушать)

- Установку/EXE/GUI/NSIS — только disposable VM/CI (guard'ы `ci/nsis-lifecycle.ps1`,
  `gui-acceptance.cjs`, `smoke-mode.cjs` требуют GitHub-hosted).
- Не превращать unsigned+updater OFF в автообновление; повышение общей версии —
  только отдельный интеграционный commit с Codex.
- Не редактировать: browser/* (Gemini), document-reader/workspace,
  computer-session/work-cycle (Codex), память DeepSeek, account/auth API.
- Не читать .env/токены/БД; не выдавать Electron remote странице Node/полный IPC.
