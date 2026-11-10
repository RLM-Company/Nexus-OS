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

## Не завершено / следующий приоритет

- Большой repo: `service.ts:propose` отказывает при truncated tree или >20000,
  до выборочного чтения. Исследовать текущий GitHub adapter и тестовый контракт
  до выбора способа безопасного subtree/search; не обходить отсутствующий tree.

- Сквозная приёмка tmp Git выполнена первым срезом: input/output/patch/receipt
  сохранены в fixtures/check-evidence. Локально4/5 OCI (старый setup timeout),
  внешний CI на объединённом code head589eb31 —5/5 (job130077931797).
  Неполный локальный запуск остаётся4/5; его failure сохранён.
- Общий sidebar/router/back-forward dirty guard — не интегрирован.
  Raw diff не сохраняется автоматически; применить или явно отменить.
- Проверить полноту контекста больших репозиториев и secret-path исключения.
- GitHub adapter: 23 fixture-теста прошли в объединённом root test, включая lost
  PR response/read reconciliation без повторного publish, точный review, owner/base
  fences и сохранение file mode. Live push/PR в целевой репозиторий не выполнялся.

## Требуется отдельное разрешение

- Live publish в чужой целевой репозиторий/PR. Не разрешено текущим поручением.
- Вызов настоящей модели/платного API, ПК владельца, VPS, deploy/merge запрещены.
