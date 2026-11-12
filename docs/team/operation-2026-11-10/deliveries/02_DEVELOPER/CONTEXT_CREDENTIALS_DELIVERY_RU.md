# Coscode: встроенные credentials в разрешённом исходнике

12 ноября 2026, ID 02_DEVELOPER. Статус: **готово к интеграции**; Draft PR
[#551](https://github.com/RLM-Company/Nexus-OS/pull/551).
BASE_SHA: `a5f6511875ef7ec116e34dd6c35ff445bdea4313`.
Ветка: `ops/developer-coscode-context-secrets-2026-11-12`.
SOURCE_HEAD_SHA: `ab53ef4832d3fe79c7441c015fde100edb93a63d`.
SOURCE_TREE: `585330c92836da90896085eaaccf13b551470b0e`.
Точный SHA финального отчёта — в истории этого PR. GitHub/local source tree equality
проверена. Срез независим от #549: его новый код не включён в эту ветку.

## До / после и пользовательский путь

Entrypoint: `/code-agent` → выбранные project/task/repository/files → действующий
CodeAgentService.create/import → GitHub immutable tree/blob → GuardedToolRuntime →
policy_operations → run.snapshot → codePromptFiles → существующий ModelGateway.
Review/check/repair/publish используют прежние методы и durable checkpoints.

До: запрещённые имена файлов фильтровались, но обычный `src/add.js` мог содержать
встроенный ключ. Guarded read возвращал его в durable policy result, snapshot,
а затем в модель. Redactor stdout уже существовал, однако он предназначен для
вывода проверки: применение его к исходнику изменило бы байты и испортило точный diff.

Теперь содержимое распознаваемых форматов отклоняется **внутри** callback чтения,
до возврата успешного результата в GuardedToolRuntime. Поэтому новые read results
и snapshot не сохраняют такой файл, а модель не получает его содержимое.
Новый error `CONTEXT_CONTENT_FORBIDDEN` сохраняется как понятная неудача; web показывает
объяснение в существующем разделе. Выход: выбрать безопасные файлы/commit.
Файл не маскируется, не переписывается и не отправляется на внешний сканер.

codePromptFiles повторно проверяет источник при формировании initial/repair input.
Legacy snapshot/proposal блокируются перед review/check/repair/publish. Отредактированные
review files проверяются до создания durable draft; исторические draft.plan.files
тоже проверяются перед исполнением, repair и публикацией. Старые записи не удаляются,
их версия/содержимое при отказе сохраняются. Повтор client_request_id не перечитывает
файл и не запускает модель. Cancel/revoke во время чтения не допускают snapshot,
model dispatch, executor или GitHub write.

## Объём детектора

Повторно использованы форматы существующего проектного secret scan; логика встроена
в текущий code-agent/proposal-input, без нового runtime/store/исполнителя и зависимостей.
Распознаются private-key headers (в том числе OpenSSH), GitHub token families,
OpenAI-style tokens и AWS access-key IDs. Это консервативная проверка формы,
а не подтверждение валидности ключа у провайдера. Тестовые примеры такого формата
в реальном исходнике также могут быть отклонены.

Обычные переменные `apiKey = process.env.API_KEY`/`password = config.password` не
считаются credentials. Нет entropy scoring и эвристического переписывания строк.
Это **не универсальный DLP**: произвольные пароли, неизвестные форматы, кодированные
или собранные из частей ключи могут остаться нераспознанными. Task/issue, модельные
output checkpoints и дерево metadata не получают отдельной общей DLP-политики этим
срезом; нельзя считать весь репозиторий сертифицированно свободным от секретов.

## Исходники и интеграция

- `apps/api/src/code-agent/proposal-input.ts`: stateless format guard и prompt gate.
- `apps/api/src/code-agent/service.ts`: guard внутри существующего read callback,
  legacy context и review/draft gates.
- `apps/api/test/code-agent.test.ts`: source fixtures; initial/tool reads, durable
  result, cancel/revoke/repeat, legacy snapshot/draft, manual review и safe exact edits.
- `apps/api/test/code-proposal-input.test.ts`: форматы/повторный scan/обычный код/байты.
- `apps/web/src/app/code-agent/patch-client.ts` и `.test.ts`: сообщение отказа без retry.
- Этот отчёт, BACKLOG/CHECKPOINT/DELIVERY/INTEGRATION и scoped evidence в 02_DEVELOPER.

Общие contracts/gateway/DB registration/schema/app/navigation не менялись; отдельный
integration commit не нужен. Новых tools/capabilities/routes/migrations/dependencies
нет; capability negotiation и owner/project scopes сохранены. Провайдер/модель/
тарифы/квоты и shell/network/isolation не менялись. Layout/CSS/sidebar/chat не тронуты.

## Fixtures и фактические результаты

Входы находятся непосредственно в scoped тестах. Токены синтетические, собираются
из prefix + повторяемого символа; реальные ключи/.env/БД владельца не использовались.
Fixture GitHub и SSE adapter обрабатывают действующие service/store/routes/guarded
operations с временным SQLite, а не выставляют успешный статус вручную.

1. Initial `src/add.js` с искусственным GitHub token: failed/context error,
   snapshot=[], provider calls=0, token отсутствует в policy_operations/view.
   Проверены tool-enabled и text-only route.
2. Negotiated read_file `src/add.test.js` с OpenAI-style fixture: один предшествующий
   безопасный model turn; дополнительной отправки нет, запрещённый файл не сохранён,
   snapshot содержит только исходный безопасный add.js. Внешних GitHub writes нет.
3. Повтор creation UUID возвращает тот же failed run без новых reads/model calls.
4. Cancel/revoke во время blob response: нет сохранения исходника/dispatch/check/write.
5. Legacy snapshot/draft остаются на месте; review/check/repair/publish отклонены.
   Реальный HTTP publish endpoint возвращает409 с одним безопасным error code.
6. Безопасный source с `19 700`, `00123`, `2026-11-12`, `кроме доставки`, `not enabled`
   и CRLF/no final newline проходит text context → точная замена a-b на a+b →
   durable proposal → review → check snapshot. Все нетронутые байты совпадают.
   **Runner результата проверки здесь fixture**, не реальный OCI/Node прогон.

Модель/GitHub/runner в этих orchestration tests — явные фикстуры. Реальный ИИ API
отложен владельцем; новых платных вызовов/foreign push/live PR не было. Публиковалась
только собственная рабочая ветка Nexus-OS и Draft PR551. Предыдущий реальный
GitHub/OCI без модели — отдельный PR546; synthetic test PR542 не merge в main.

## Команды и журнал проверок

При уже установленных pinned зависимостях:

```sh
pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts test/code-proposal-input.test.ts test/code-agent-github-tree.test.ts test/github-integration.test.ts --maxWorkers=2
pnpm --filter @cosmora/web exec vitest run src/app/code-agent/patch-client.test.ts
pnpm --filter @cosmora/api typecheck
pnpm check:core
```

В этой сессии pnpm запускался с `pnpm_config_verify_deps_before_run=''`, чтобы
не выполнять автоматическую установку. Использован подготовленный pinned store.

- Baseline до guard:3 FAILED; результат сохранён в baseline-failed.log.
  Tool-enabled initial case не получил ожидаемый failed; text-only/negotiated
  достигли ошибок ответа фикстуры вместо требуемого content refusal. Это не PASS.
- Первый expanded API run:138 PASS+1FAIL+1SKIP. Новый HTTP тест послал строку unused
  вместо UUID publication_token и получил400 на схеме до содержательного guard.
  Исправлен fixture на randomUUID; схема API не ослаблялась. Вывод сохранён.
- После этого scoped API/context/tree/GitHub:144 PASS+1 opt-in SKIP.
- Web adapter:4 PASS; scoped eslint/secrets/diff check exit0.
- Первый check:core exit1 на TS2379 в новом legacy fixture: optional digest мог
  стать undefined при exactOptionalPropertyTypes. Исправлен пересчётом digest
  исходного snapshot отдельным commit, без изменения production guard.
- API typecheck после исправления exit0; полный повтор check:core **exit0**.
  API1059 PASS+1SKIP, web361 PASS; tool-runtime86 PASS+5SKIP; остальные test/type/lint/
  format/secrets/build/privacy/profile gates также прошли. Skips не считаются live/OCI PASS.
  Новые браузерные сценарии локально не запускались: UI изменение — только текст
  существующего error mapping; web adapter4, весь web361 и production build проверены.

Scoped logs и итоговые exit codes/hashes — fixtures/context-credentials-2026-11-12/.
Логи нормализованы только по LF/хвостовым пробелам; raw hashes — в receipt,
нормализованные — в SHA256SUMS. Это не изменение результатов проверки.
Отчёт не выдаёт непрогнанные live/OCI/browser проверки за успешные.

## Очередь, интеграция и откат

PR549 final HEAD `0d36f8c92ce6655305bee3a64c5d485eaa08880b` теперь имеет полный
успешный CI: run43208031846, jobs browser131148341524/monorepo131148342037/
isolation131148342120; identity run43208031683 также success. Это отдельный
кандидат и не подтверждение CI текущего PR551. Office/Drive527 и Coscode519 уже main.

После локальных gates проверить CI точного финального HEAD PR551 и свежий main,
передать максимум «готово к интеграции». Merge/deploy не выполняются автоматически.
Откат — отдельный revert исходного guard commit; нет миграций и удаления данных,
ранее отклонённые runs сами не возобновляются. Не делать reset main/удаление snapshots.
Следующая граница — полноценная live модельная приёмка после настройки API владельцем;
не создавать новый продукт ради продолжения и не обходить отложенное подключение.
