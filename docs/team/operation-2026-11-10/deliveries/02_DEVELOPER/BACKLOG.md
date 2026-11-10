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

## Не завершено / следующий приоритет

- Сквозная приёмка на настоящем временном Git repo с несколькими файлами,
  реальным OCI, ошибкой/исправлением/отменой и точным diff: выполнить и сохранить receipt.
- Аудит потери несохранённых правок patch editor при смене задачи/reload;
  состояние replay/checkpoint и конфликт исходной версии.
- Проверить полноту контекста больших репозиториев и secret-path исключения.
- GitHub adapter сценарии lost response/idempotency/чужие файлы проверить тестами,
  не выполнять live push/PR в выбранный пользователем целевой репозиторий.

## Требуется отдельное разрешение

- Live publish в чужой целевой репозиторий/PR. Не разрешено текущим поручением.
- Вызов настоящей модели/платного API, ПК владельца, VPS, deploy/merge запрещены.
