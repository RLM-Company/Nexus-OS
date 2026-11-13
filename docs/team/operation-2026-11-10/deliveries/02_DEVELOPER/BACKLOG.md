# Coscode: порядок снимков задачи, 13 ноября 2026

Статус: **готово к интеграции** по локальным gates; exact HEAD CI ожидается.
Ветка `ops/developer-coscode-snapshot-order-2026-11-13`; [Draft PR по ветке](https://github.com/RLM-Company/Nexus-OS/pulls?q=is%3Apr+head%3Aops%2Fdeveloper-coscode-snapshot-order-2026-11-13).
[Поставка, команды и ограничения](COSCODE_SNAPSHOT_ORDER_DELIVERY_RU.md).
Начальная база501d403, сохранён актуальный main1b73e497.
Source HEAD404c3ddb3cf69ed473b72d3ad304555942ab783a,
дерево69766e22c7ca813d5c59ee10bb74b7cd33bd0d52.
Baseline3FAIL+1PASS; unit4PASS; final production5PASS.
В существующем accept добавлены version-first и request-order для legacy;
старый ответ не сбрасывает редактор/approval/publication uncertainty.
Late403 остаётся видимым. Новых runtime/store/прав нет.
Финальный check:core exit0; полный scoped production35PASS, retries0.
API1086PASS+1SKIP, web389PASS, DB236PASS; Turbo cache отмечен в логе.
Следующий шаг: опубликовать отдельный Draft PR, проверить exact HEAD CI,
передать интегратору без самостоятельного merge/deploy.
PR574 остаётся отдельной открытой поставкой; его ветка не менялась.

Состояние очереди этого среза:

- Уже работает: текущий CodeAgent runtime/patch/review/check/checkpoint и publication reconciliation; существующие30 browser tests сохранены, scoped35PASS.
- Исправлено: подтверждённый stale polling/manual response; baseline3FAIL+1PASS, после исправления5 новыхPASS.
- Не проверено живьём: настоящая модель и публикация в чужой repo; не запускались, разрешение не расширялось.
- Требует исследования: dirty-editor при новой proposal identity из другой вкладки; пока гипотеза, не подтверждённый дефект. Dev-resolver stand остаётся ограничением, production проходит.
- Требует решения: merge/release принимает интегратор, новые продуктовые направления не выбирались.

Исторические точки ниже.

---

# Текущий срез: terminal run recovery, 13 ноября 2026

BASE main7c2abad; ветка ops/developer-postmerge-acceptance-2026-11-13.
[Поставка и доказательства](TERMINAL_RUN_RECOVERY_2026_11_13_RU.md).
Предыдущие #549/#551/#558 включены RLM-Company через PR563; в этом сеансе merge нет.
Подтверждён и исправлен loop terminal → stale user-only history → queued → SSE.
Source04c4b2e/tree78443d83, 7unitPASS/69browserPASS, scoped types/lintPASS;
полный check:core exit0 (API1077PASS+1SKIP/web385PASS), build/secretsPASS. Старый baseline3FAIL (12/15/17 observer) сохранён.
Статус: **готово к интеграции**. [Draft PR по ветке](https://github.com/RLM-Company/Nexus-OS/pulls?q=is%3Apr+head%3Aops%2Fdeveloper-postmerge-acceptance-2026-11-13).
Следующий шаг: проверить точный HEAD CI нового PR, затем ревью интегратора.
Настоящая модель, foreign publish и owner-PC/VPS не проверялись и не запускались.
Предыдущие точки ниже — история, не текущее состояние этого среза.

---

# Интеграционная приёмка с новым main, 12 ноября 2026

PR [#551](https://github.com/RLM-Company/Nexus-OS/pull/551), ветка
`ops/developer-coscode-context-secrets-2026-11-12`.
Предыдущий HEAD `30ff9d1d69703d13f07afc5ec889f6d19eab991d` имеет зелёные
CI43255526930 и identity43255527039; это не CI нового объединённого дерева.

Main `33f43b8825756d60c67db306783fed9e3de717ee` сохранён merge-коммитом
`958c8a2e79c71f62a15050ea9b51a446b5dfc1da`, source tree
`57f5c6de8c05908b96a8ab547284bd77ea8f316e`. Изменения research изучены:
аддитивные типы/функция и текст отчёта, без изменений CodeAgent/Manager/executor.
Конфликтов и ручных правок общих файлов нет. Продуктовый код Coscode не менялся.

Подробности: [INTEGRATION_REVIEW_2026_11_12_RU.md](INTEGRATION_REVIEW_2026_11_12_RU.md).
Дальше — CI точного финального docs HEAD, затем независимое ревью и решение
об интеграции. Не сбрасывать длинный browser job попутным push. Самостоятельные
merge в main/deploy, live модель и foreign publish не выполняются.
Максимальный статус — **готово к интеграции**, не интегрировано и не принято в выпуск.

Предыдущая история ниже.

---

# Закрыт подтверждённый пробел: metadata/envelope, 12 ноября

Базаffc794c: CI43247327193/identity43247327083 SUCCESS с первой попытки,
включая5OCI; предыдущая combined-main приёмка завершена.

- Read-only probe подтвердил: credential-shaped имя файла проходит safe path filter
  и попадает в selected prompt tree, даже когда содержимое этого файла не читалось.
- Baseline actual service:4FAIL на tree/list metadata, task/issue и legacy repair task;
  после fix4PASS, scoped157PASS+1SKIP/web4PASS/coreexit0/API1077/web363 и real Git/OCI1PASS.
- Реализовано текущим guard: безопасный path filter и final request
  envelope check; не добавлять DLP engine/хранилище/новые полномочия.
- Обычный код/имена/данные и прежние task/version/one-attempt fences сохранены.
- Sourceb764ac2/tree400edb99; финальный docs HEAD в PR551. Дальше exact HEAD CI
  и review, без новых функций/перезапуска browser job до результата.
- Raw owner records не чистятся: это предотвращение known-format model dispatch,
  не DLP всего хранилища. Live модель по-прежнему отложена владельцем.

Предыдущая приёмка ниже.

---

# Программная приёмка Coscode, 12 ноября 2026

- Проверено объединение main1c07f8d: общие Skills contracts просмотрены, scoped
  source не изменился, main сохранён без conflicts/ours override.
- Combined coreexit0/API1070/web363; scoped150PASS+1SKIP; actual tmpGit/API/OCI1PASS.
- Кандидат mergec3cef4b/treeb455ff73, PR551. Новая реализация не нужна:
  существующие сильные реализации сохранены и прошли текущую приёмку.
- Дальше: финальный HEAD CI и review. Не добавлять новый продукт ради продолжения.
- Отложено владельцем: live model API и модельная приёмка. Остальные реальные
  границы перечислены в SOFTWARE_ACCEPTANCE_RU.md, не прячутся под статусом completed.

Исторический backlog далее.

---

# Продолжение PR551: legacy repair feedback, 12 ноября

- Найдено: repair валидирует старый check, но отбрасывает очищенный результат;
  исходные stdout/stderr/journal копируются в попытку и могут уйти модели.
- Реализовано: использовать существующий canonical validator/redactor до excerpt,
  записи repair_request и dispatch; сохранить digest/exit/status/consent/version fences.
- Входы: только искусственные legacy credentials; model/GitHub/runner — fixtures.
- Проверено: очистка prompt и нового checkpoint, отмена до dispatch, повтор UUID,
  точные диагностические факты и размер excerpt. Новый runtime/сканер не нужен.
- Новый core exit0: API1065PASS+1SKIP, web361PASS. Перед интеграцией — финальный CI
  PR551 и свежий main; main5b6013d уже сохранён без code/contract changes.

Предыдущий срез далее.

---

# Следующий срез: проверка содержимого Code context, 12 ноября

BASE_SHA a5f6511875ef7ec116e34dd6c35ff445bdea4313; ветка
ops/developer-coscode-context-secrets-2026-11-12. Независима от Draft PR549.

- Работает: immutable tree/blob, исключение secret paths, точные snapshots/diff,
  negotiated read_file, подтверждённый check/publication и redaction stdout.
- Найден пробел: обычный source path может содержать встроенный token/private key;
  read callback возвращает его в policy result, snapshot и затем model context.
- Реализовано: отказ по распознаваемым credential formats до durable read result и
  context dispatch; сохранение обычного исходника без маскирования байтов;
  legacy checkpoint gates и понятное сообщение через существующий UI.
- Проверено: первоначальный и negotiated read, legacy repair/review/check/publish,
  обычные значения/числа/отрицания, cancel/revoke/retry; fixtures без реальных секретов.
- Локальные gates: scoped API144PASS+1SKIP, web adapter4PASS, полный core exit0
  (API1059PASS+1SKIP/web361PASS). До интеграции нужен CI точного финального HEAD и новый main.
- Live ИИ API отложен владельцем; не блокирует этот программный срез.
- Граница: перечисленные credential formats; неизвестные/encoded/частичные строки,
  task/issue/model output и metadata не получают общей DLP-сертификации.

Историческая очередь далее.

---

# Coscode: проверенный backlog

Дополнительное ревью: stale-check approval закрыт source40a3a9e/9877f5b.
Same review hash больше не заменяет check version; repair-v2 + capability2, новый
consent после reload, старые payloads fail closed. Root0/API117/realHTTP-OCI1/
production30PASS; детали и baselineFAIL в актуальной DELIVERY.

Предыдущий итог ниже — история на3936e5f.

Итог 11 ноября: согласованный сценарий завершён до статуса «готово к интеграции».
Source3936e5f, Draft PR519. Failed-check → одна явно разрешённая модельная попытка →
новый diff → реальный повтор той же проверки → свежий review подключён к продукту.
Реальный OCI API/Git сценарий PASS; root check:core exit0. Браузерный результат
и точные commands/receipts — в актуальной верхней части DELIVERY.md.
Список ниже сохраняет историю срезов, а не утверждает завершение release/live.

Исполнитель: Разработчик + GPT Plus. Branch: ops/developer-coscode.
BASE_SHA: f9eb45285f3473bfd3fe9a73939c1903dc696b3b.
База 9d972e8ba447f681fbfb49253b73d9f02dd1d325 — предок фактического main.

## Уже работает по прочитанному коду; проверки отмечаются в DELIVERY

- `/code-agent` → project/task/issue → code-agent routes/service/store → строгий
  patch preview/review → текущий OCI/HTTP executor → draft GitHub adapter.
- Immutable repository SHA, ограниченный выбор контекста, safeCodePath, строгие
  hunk/index/base checks, durable tasks и output checkpoints, отмена и privacy fences.
- GitHub публикация с токеном подтверждения, checkpoint SHA и reconciliation без
  автоматического повторения неизвестного побочного эффекта.

## Исправлено первым срезом (готово к интеграции)

- HTTP executor и service доверяют `status: passed` без обязательного exitCode=0.
  Неподтверждённый результат может получить publication_token. Исправлено первым
  вертикальным срезом: runner response → durable proof → UI → publication gate.
- Журнал executor не валидируется/не редактируется столь же строго, как stdout/stderr.
  В том же срезе journal ограничен/проверен и отредактирован перед сохранением.

## Исправлено вторым срезом (готово к интеграции)

- Предупреждение/отмена discard при выборе проекта/задачи/нового запуска/GitHub
  и native reload. Точный текст сохраняется при отказе.
- Raw diff отслеживается отдельно от выбранных файлов, есть явная отмена.
  Старые proofs не возвращаются. Review по-прежнему канонический checkpoint.
- Production UI15PASS, type/lint/build. Только местные контролы и native unload;
  общая SPA-навигация требует канонической интеграции Codex.

## Исправлено третьим срезом (готово к интеграции)

- Deep link вне последних20: exact GET без подмены другой задачей, отказ для
  недоступного project/run и несовпадающего ID; epoch guards поздних ответов.
- Уход из patch editor блокирует поздний preview/invalidate-review и изменение новой задачи.
- Production UI22PASS, web lint/types/build и strict E2E types; после main — см. DELIVERY.

## Исправлено четвёртым срезом (проверки см. DELIVERY)

- Полное tree22 002 путей больше не отклоняется произвольным порогом20k;
  transport8MB и count100k остаются ограниченными, файлы/модель читаются выборочно.
- Полный existence index сохранён; unread existing path не принимается за новый.
- Credential config/private dirs/SSH key paths исключены из prompt/read/diff.
- Legacy checkpoint с запрещённым путём не допускается к review/check/publish;
  данные не удаляются. Cancel/revoke/truncated проверены scoped API.

## Исправлено пятым срезом (проверки см. DELIVERY)

- search_files в прежнем negotiated tool cycle: literal query1–160, result<=32,
  total_count/partial; безопасный immutable index без дополнительных remote reads.
- Поиск → exact read → durable patch доказан scoped API, tools-free fallback сохранён.

## Исправлено шестым срезом (готово к интеграции, PR519)

- Review/invalidation привязаны к parent review hash: старая вкладка не стирает
  новые edits/proof. Explicit checkpoint load с discard, включая raw editor.
- Failure→repair→new proof→stop/recover через отдельный file SQLite connection
  проверен; API64, coreexit0, Chromium24PASS. Это ещё не automatic model repair.

## Исправлено седьмым срезом (готово к интеграции; upstream format blocker)

- Bounded immutable nonrecursive recovery при truncated tree, полный индекс без
  выдуманной полноты; callback scope в текущем adapter и service authority gates.
- Code68/GitHub23/tree9=100PASS. Все gates после format прошли; общий coreexit1
  на чужом main research JSON сохранён, не объявляется успехом.

## Исправлено восьмым срезом (готово к интеграции)

- Собственный navigation hook защищает cancelable sameDocument traverse в браузерах
  с Navigation API. Настоящие Back/Forward, visible edits, explicit discard и no
  workspace writes проверены production26PASS. Shell/history/router не переписаны.
- Старые браузеры/uncancelable platform events — честная compatibility boundary.

## Девятый срез: исправление после проверки (готово к интеграции)

- Existing gateway/ownerBudget/executor, exact working bytes владельца и одна попытка.
- Server capability, отдельное подтверждение, idempotency UUID, запрет replay после
  restart/unknown, сохранённая ошибка и новый review перед token/publication.
- Fast tool-only authority revoke исправлен внутри действующего guarded model scope.
- Старый upstream formatter blocker исправлен владельцем файла в main и принят merge;
  новый root coreexit0. Новых продуктовых блоков вне поручения не создаём.

## Оставшиеся подтверждённые границы

- Tree recovery за128nodes/100k/8MB/30s заканчивается честным отказом.
- Node syntax/node-test ограничены выбранным snapshot; не произвольный build стека.

- Сквозная приёмка tmp Git выполнена первым срезом: input/output/patch/receipt
  сохранены в fixtures/check-evidence. Локально4/5 OCI (старый setup timeout),
  внешний CI на объединённом code head589eb31 —5/5 (job130077931797).
  Неполный локальный запуск остаётся4/5; его failure сохранён.
- Modern browser Back/Forward guard подключён в собственном Code hook. Старые
  браузеры без Navigation API и uncancelable events не покрываются им.
  Raw diff не сохраняется автоматически; применить или явно отменить.
- После текущих secret-path guards остаётся содержательный аудит секретов внутри
  произвольного допустимого исходника; фильтр имени не гарантирует чистое содержимое.
- GitHub adapter: 23 fixture-теста прошли в объединённом root test, включая lost
  PR response/read reconciliation без повторного publish, точный review, owner/base
  fences и сохранение file mode. Live push/PR в целевой репозиторий не выполнялся.

## Требуется отдельное разрешение

- Live publish в чужой целевой репозиторий/PR. Не разрешено текущим поручением.
- Вызов настоящей модели/платного API, ПК владельца, VPS, deploy/merge запрещены.

Живая проверка GitHub и OCI описана в [отчёте от 12 ноября](LIVE_ACCEPTANCE_2026-11-12_RU.md). Проверка с ответом модели остаётся открытой.
