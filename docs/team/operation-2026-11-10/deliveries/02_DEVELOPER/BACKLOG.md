# Coscode: проверенный backlog

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

## Не завершено / следующий приоритет

- Следующий приоритет — приёмка failed-check → точная owner/model правка → новый
  review/check → checkpoint recovery. Сначала повторить существующее сильное поведение
  retryProposalCheck/check и не добавлять скрытую платную перегенерацию.
- Tree recovery реализован; случаи за128nodes/100k/8MB/30s остаются честным
  ограничением с original truncated=true. Общий formatter main blocked чужим artifact.

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
