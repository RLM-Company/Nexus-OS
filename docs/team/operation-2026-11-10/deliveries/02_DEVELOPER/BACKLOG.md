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
