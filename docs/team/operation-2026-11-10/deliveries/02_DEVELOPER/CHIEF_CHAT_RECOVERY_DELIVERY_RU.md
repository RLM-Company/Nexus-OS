# Главный разработчик: восстановление безопасного повтора чата

12 ноября 2026. Исполнитель: Разработчик + GPT. ID 02_DEVELOPER.
Статус: **готово к интеграции**; опубликован Draft PR [#549](https://github.com/RLM-Company/Nexus-OS/pull/549).

## Версии и очередь

BASE_SHA checkout: `03cd454089dbe53a32e36d92578180f59357c21c`.
Затем сохранён новый main `a5f6511875ef7ec116e34dd6c35ff445bdea4313`
(решение #545: остаться на варианте A; Sketch fork не начинать).
Плановая база `9d972e8ba447f681fbfb49253b73d9f02dd1d325` — предок этого main.
Ветка: `ops/chief-chat-recovery-2026-11-12`.
SOURCE_HEAD_SHA: `05fc4936cda966bf27a6d5f1d0d7c2fa58f5054f`.
SOURCE_TREE: `49b6efb393fdbf69e42d01e2dd1f6ea563e26d9b`.
GitHub tree совпадает с локальным проверяемым деревом. Финальный SHA с отчётом — в истории PR.

Проверка `git merge-base --is-ancestor SHA a5f6511` показала:
Office/Drive top #527 `66a22a8f08c9fa7eebe69bc7c5412a9a8a90a730` уже в main,
как и исходник Coscode #519 `40a3a9ed5ceaec68c46a8e9e904cb7e08d2e5879`.
Их открытые старые PR и старые checkpoints не означают отсутствующую реализацию.
Chat #541 `493f3b4fe139584153d76ac44e92ca3e1dbcf2fd` в main отсутствовал.
Его цепочка #539/#541 сохранена merge-коммитом `a58625e2b38b3b7537b3d0ce90853aee6b8c9970`.
Чужие ветки и общий журнал не редактировались.

## Действующий путь и исправление

Entrypoint: существующий composer `apps/web/src/app/page.tsx` →
`useBrowserComposerDraft` → `composer-draft-storage` → canonical localStorage records;
отправка использует существующий chat API, idempotency marker и серверное хранилище.

До: после потерянного ACK текст/вложения восстанавливались, а text_action пропадал.
Повтор менял тело запроса, поэтому не мог восстановить исходный client_message_id.
Браузерная регрессия действительно упала на отсутствии «Объяснить тему» после reload.

Теперь действия принадлежат своему chat draft; pending send markers независимы
для разных чатов. Дополнение сохраняет web_search и полный text_action (включая
selection/tone/length) в **существующей** bounded material-записи черновика.
Гидратация восстанавливает действие до доступной отправки; отдельной очереди,
хранилища или исполнителя нет. Сравнение перед очисткой учитывает actions через
каноническую raw-запись; старый ACK не удаляет action-only изменение другой вкладки.
Старые записи без actions читаются как раньше. Невалидные actions отклоняются
с предупреждением, при этом корректные текст и вложения остаются доступны.
Лимиты количества/возраста/размера и очистка черновика распространяются на действия.
При пустом тексте выбранное действие также сохраняется; бездействующий пустой
черновик очищается. Поля действия проверяются канонической ChatTextActionSchema.

## Файлы

- `apps/web/src/app/page.tsx`: scoped actions/retry и минимальное подключение persistence.
- `apps/web/src/app/chat-send-retry.ts`, `.test.ts`: принятая исходная цепочка #539/#541.
- `apps/web/src/app/composer-draft-storage.ts`, `.test.ts`: lifecycle actions и валидация.
- `apps/web/src/app/use-browser-composer-draft.ts`: snapshot/dedup включает actions.
- `apps/web/e2e/chat-reliability.spec.ts`: существующие и новый реальный browser/API сценарий.
- `packages/contracts/src/domain.ts`: только export канонического валидатора;
  отдельный интеграционный commit `49806ca8a63ee0d6905298e86438a1dff9613430`.
- Этот отчёт, CHECKPOINT/BACKLOG/INTEGRATION и scoped evidence в каталоге 02_DEVELOPER.

Новых зависимостей, миграций, маршрутов, capability/permission/provider/quota changes нет.
Чат/сайдбар/глобальные стили и компоновка не менялись; VISUAL_WAITLIST не требуется.

## Воспроизведение

Из checkout с уже установленными зависимостями lockfile:

```sh
pnpm --filter @cosmora/contracts build
pnpm --filter @cosmora/web exec vitest run src/app/composer-draft-storage.test.ts src/app/chat-send-retry.test.ts
pnpm --filter @cosmora/web build
KOSMORA_E2E_PRODUCTION=1 KOSMORA_E2E_CHROMIUM_EXECUTABLE=/usr/bin/chromium pnpm --filter @cosmora/web exec playwright test -c playwright.acceptance.config.ts e2e/chat-reliability.spec.ts --workers=1 --retries=0
KOSMORA_E2E_PRODUCTION=1 KOSMORA_E2E_CHROMIUM_EXECUTABLE=/usr/bin/chromium pnpm --filter @cosmora/web exec playwright test -c playwright.acceptance.config.ts e2e/composer-draft-races.spec.ts --workers=1 --retries=0
pnpm check:core
```

В этой облачной сессии к pnpm добавлялось `pnpm_config_verify_deps_before_run=''`,
чтобы pnpm11 не запускал автоматическую установку. Зависимости переиспользованы
из pinned store; установка пакетов/случайных install-скриптов не выполнялась.
Chromium уже установлен на отдельном облачном стенде, не на ПК владельца.

Scoped stdout, baseline, реальный browser draft readback, exit codes и SHA256SUMS
сохранены в `fixtures/chat-action-recovery-2026-11-12/`. Readback получен из browser
localStorage после отклонения отправки/reload и содержит fixture text/file/hash.
Логи нормализованы только по LF/хвостовым пробелам для git diff --check;
исходные SHA256 сохранены в receipt, нормализованные — в SHA256SUMS.
Первый staged diff check обнаружил пробелы в stdout, после нормализации прошёл;
результаты проверок при этом не менялись.
Полный payload retry проверяется в браузерном assertion, без подмены успешным ответом модели.

Вход regression: существующий fixture chat, текст «Объясни тестовый пример 00123»,
действие explain; реальный POST обрабатывается API, первый HTTP ACK теряется
через route.abort после route.fetch. После reload ручной повтор даёт HTTP [202,200],
структурно идентичный полный JSON payload/client_message_id и одну user message.
Reload сам ничего не отправляет. SQLite/API настоящие тестовые; модель — mock.
Реальная модель HY4, интернет-поиск и Windows desktop этим прогоном не вызываются.

## Проверки и ограничения

- Baseline regression: 1 FAILED, сохранён `baseline-browser-failure.log`.
- После исправления: production Chromium reliability 18 PASSED и composer races 12 PASSED,
  retries=0/workers=1. Races проверяют pagehide, acceptance/rejection, новую правку,
  другую вкладку и native text-only flush (bridge fixture, не Windows приёмка).
- Focused draft/retry unit: 22 PASSED; contracts: 206 PASSED.
- Production Next/Turbopack build: exit0.
- Scoped ESLint source: exit0. Попытка включить E2E напрямую в ESLint дала
  project-service parsing error: файл не входит в lint tsconfig. Ошибка сохранена;
  E2E проверен отдельным strict tsc с `--types node` (exit0) и браузером.
- Первая standalone tsc-команда без `--types node` упала на process/Buffer;
  добавление уже имеющихся Node типов исправило конфигурацию запуска, не тест.
- Подготовительные сборки до материализации hermetic pinned store падали:
  Next/package resolution, затем отсутствовавший contracts/dist. После исправления
  среды штатная production сборка прошла; эти ошибки не являются успешными проверками.
- Полный `check:core`: exit0, формат/secrets/lint/types/unit/build/privacy/profile gates passed.
  В том числе API1040 PASS+1SKIP; web374 PASS; tool-runtime86 PASS+5SKIP.
  Skips не считаются пройденными live/OCI проверками; отдельный GitHub CI isolation job прошёл.
  Полный вывод сохранён в `check-core-passed.log`.

Это исправление browser draft. Native Windows bridge сохраняет текст по прежнему
owner-scoped пути; восстановление actions после полного desktop restart здесь
не аттестовано и не подменено незащищённым localStorage. Live provider acceptance
Coscode остаётся отдельным gate: PR #546 содержит выполненный GitHub/OCI прогон
без модели. Тестовый Draft PR #542 и synthetic base **никогда не объединять в main**.
CreateRepository ранее был отклонён GitHub; расширение роли пользователя не меняет
фактический отказ API. Production/VPS/ПК владельца в этом срезе не использовались.

## Интеграция и откат

Проверить актуальный main/CI на точном HEAD PR549; общая схема остаётся прежней,
валидатор поставляется вместе с web fix. Сохраняется ancestry исходной chat цепочки.
Не merge/deploy автоматически. Максимальный статус исполнителя — готово к интеграции.
Для отката отдельным PR отменить fix-коммит и затем helper, если он больше никем
не используется. Уже сохранённые actions опциональны: предыдущий reader игнорирует их.
Не удалять пользовательские черновики и не reset чужие изменения.
