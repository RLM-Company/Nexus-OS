# Безопасное восстановление остановленного запроса, 13 ноября 2026

ID02_DEVELOPER. **Готово к интеграции; новый HEAD CI проверяется отдельно**. Новый
[Draft PR этой ветки](https://github.com/RLM-Company/Nexus-OS/pulls?q=is%3Apr+head%3Aops%2Fdeveloper-request-recovery-2026-11-13), branch
`ops/developer-request-recovery-2026-11-13`. Самостоятельных merge в main/deploy нет.
BASE_SHA `281604b726e25118f3edb80e6b2108dc44368339`, actual main после внешней интеграции PR565/566.
Предыдущий опубликованный HEAD `72e1ad93d373f65c4b9df94df1c9b7388ddda8c6`
имеет полный SUCCESS CI43397713119; это не CI новой версии.
SOURCE_HEAD `44eb6f1c45ae80842006c57638eee39c0ea0669c`, tree
`4867702f895c341c2a0d9d87cbb53cc787ab2e3d`. Финальный HEAD — в PR/history.
Локальный source `aaf3b1a663c2acb4b2f4adce7b295f72fb491ebd` имеет то же дерево.

## Было → работает теперь

После failed/cancelled до появления assistant история содержит только user.
Предыдущее исправление уже останавливало SSE loop, но существующая кнопка
«Вернуть запрос в редактор» не предлагалась. Кроме того, условие `!draft.trim()`
разрешало восстановление поверх нового file-only/whitespace draft. При чтении
нового файла пользователь мог нажать restore: старый текст заменял пустой
редактор, `replace` отменял чтение нового файла и возвращал старое вложение.

Теперь один selector использует последний run ID и подтверждённый terminal статус
либо статус assistant. Старый failed request не подменяет более новый активный/
завершённый запуск. Существующее действие возвращает точный текст/вложения даже
при отсутствии assistant; запись browser draft и reload остаются прежними.
Восстановление предлагается только пустому редактору без файлов/активного чтения,
после загрузки текущего scope. Handler повторно проверяет live text/files/reading,
view epoch и submitPending перед изменением. Новый ввод, включая пробелы, сохраняется.

Entrypoint: чат/Manager проекта → terminal event/history → существующая кнопка →
selector текущего запроса → существующие setDraft/attachments → browser storage →
повторное чтение при reload. Отправка модели остаётся отдельным действием пользователя.

## Реализация и канонический main

- `apps/web/src/app/recoverable-run-draft.ts` и test: общий selector без нового
  runtime/store/истории. 9 новых unit tests, прежние7 terminal tests сохранены.
- `apps/web/e2e/run-draft-recovery.spec.ts`: 12 реальных browser сценариев для
  чата и проекта: ранняя ошибка/отмена, точные bytes/reload/no execution POST,
  file-only/whitespace и pending read, прежний same-turn input fence.
- Отдельный integration commit `6d3fd5a8...`: `page.tsx`, `chat-attachments.tsx`,
  `tsconfig.composer-e2e.json`. Один live reading snapshot в существующем hook,
  подключение selector/guards и одна строка strict E2E types. Макет/CSS прежние.
- Дополнительный integration commit `44eb6f1...`: существующий
  `playwright.composer.config.ts` включает обе recovery suites. Штатная команда
  `test:e2e:composer --list` подтверждает45 registered tests; это discovery, не45PASS.
- Source/helper commit `9c25062af690aed3d86a6b7850b9e6197ee58e69`.
- Пока первый gate выполнялся, интегратор включил PR565/566 в main281.
  Закрытый PR566 не обновлялся. Новая ветка начата от main281, перенесены только
  два своих source commit; byte equality шести scoped файлов проверена.
  Прочитаны новые Research artifact contracts/API и project picker, изменения
  аддитивные; исходники Research/Team Planner и миграция0066 сохранены main.
- GitHub source trees нового BASE сверены с локальными до публикации branch ref.
  Первоначальный gate на mainb47 завершился exit0/API1080/web394/DB230; его receipt
  явно помечен прежней базой. Общий gate для source на main281 завершён успешно; подробности ниже.

Перед публикацией main дополнительно обновился до501d403f8e95c2ced82f88be13b04b18789baa40
(PR573). Прочитаны новые optional AgentStudio app dependencies/contracts: CodeAgent
и recovery source paths не менялись. Main501 сохраняется merge в свою ветку;
его14 чужих paths/миграция0067 не редактируются. Локальный core выше относится
к main281; проверка окончательного merge HEAD выполняется новым CI и не подменяется им.
Собственный Multi-Agent runtime не реализуется и не запускается.

Новых собственных API/DB contracts, зависимостей, миграций, grants, провайдера/квот нет.
Правила памяти, native draft owner isolation и file grants не изменялись.

## Команды и фактические результаты

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium KOSMORA_E2E_PRODUCTION=1 pnpm --filter @cosmora/web test:e2e:composer run-draft-recovery.spec.ts
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/web exec vitest run src/app/recoverable-run-draft.test.ts src/app/restored-run-state.test.ts
KOSMORA_E2E_PRODUCTION=1 pnpm --filter @cosmora/web exec playwright test run-draft-recovery.spec.ts terminal-run-recovery.spec.ts chat-reliability.spec.ts composer-draft-races.spec.ts code-agent.spec.ts pwa.spec.ts manager-console-races.spec.ts --workers=1 --retries=0
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/web typecheck
pnpm_config_verify_deps_before_run='' pnpm check:core
```

Managed runtime: Node24.22.1/pnpm11.25.0, existing dependencies из lockfile;
новые install/dependencies не требовались. Во внешнем temp config сохранены штатные
webServer и production build/start, заданы cwd/testDir/outputDir и
`launchOptions.executablePath=/usr/bin/chromium`, workers1/retries0.
Для targeted проверки12 cases после изменения только test counter/retention
использован уже собранный production build (`pnpm start`), без повторной сборки.

- Baseline на bundle до fix, после merge main: **8FAIL+2PASS**. Не было recovery
  до assistant; unsafe control оставался при новом файле/пробелах. Same-turn
  text fence уже проходил, не выдаётся за новую реализованную функцию.
- Дополнительный baseline pending-file: **2FAIL**. Настоящий click менял пустой
  ввод на старый запрос; `Expected "" / Received "Реквизиты: 19 700 ..."` в stdout.
- Unit первоначального source: **16PASS** (9 новых+7 существующих); затем добавлена
  проверка completed observation при запаздывающей user-only history, её финальный
  результат входит в общий gate. Статусы ниже не выдаются за этот ранний unit log.
- Первый combined browser run: **85PASS+4FAIL** из89. Четыре новых теста ошибочно
  считали штатный POST `/chat-navigation/import-pins` повторной отправкой. Восстановление
  текста/вложений/reload уже прошло до этого assertion. Исходный failure сохранён.
- Исправлен только test counter: все POST пишутся в receipt, execution mutations
  проверяются отдельно. Targeted финальный run: **12PASS**, production/retries0,
  шесть JSON readbacks сохранены. Остальные77 cases ранее прошли в combined run;
  целый89-case run повторно не объявляется зелёным. Новый GitHub CI — отдельно.
- Первый source format-check указал на отступы нового условия в page; формат
  поправлен только в новом hunk, исходный warning log сохранён. Scoped types/format
  после этого exit0; новых ошибок типов не скрывалось перезапуском.
- На окончательной базе main281 полный `check:core`: **exit0**, API1085PASS+1opt-inSKIP,
  web394PASS, core425PASS, DB230PASS; tool-runtime86PASS+5opt-inSKIP. Build/lint/types/
  secrets/format/privacy/profile прошли. Turbo cache отмечен в summary; skips не PASS.
  Этот gate проверял runtime tree887f0565. После него добавлена только регистрация
  composer suite; отдельно пройдены финальные web types/lint/format.
- Через штатный config, на новой production сборке main281: **12PASS**, retries0,
  шесть actual readbacks обновлены. Это отдельный финальный run, не подмена первого89.
  Итоговое source tree4867702f совпадает на GitHub/local; CI нового HEAD — отдельно.

Фикстуры и результаты: `fixtures/request-recovery-2026-11-13/`: исполнимый input
описан в E2E и input.json; реальные browser readbacks содержат `19 700`, `00123`,
дату, «кроме доставки» и точные file contents. Служебные POST не скрыты.
Исходные baseline traces были перезаписаны следующим локальным запуском; baseline
stdout сохранён. Traces первого combined failure сохранены в workspace, не вложены
в git из-за ненужных full-source snapshots; причина и stdout приложены.
Readback JSON только форматируется для репозитория; raw hashes сохранены отдельно.

В fixture logs удалены ANSI и концевые пробелы; raw hashes сохранены в
log-normalization.json. Успехи, отказы и ошибка test counter остаются видимыми.

## Границы и интеграция

SSE/history terminal shapes заменены fixtures; настоящий Next/browser/storage и
HTTP создание/чтение fixture requests работают. Реальная модель не вызывалась.
Foreign GitHub publish, owner PC/Windows/VPS/live-model acceptance не запускались.
Этот срез восстанавливает текст/вложения из существующей истории; нового контракта
метаданных действий, shell или executor не добавлялось. История/owner data не чистятся.

Для интеграции нужны три новых source commit поверх main281 (предыдущий #566 уже в нём): helper/tests, затем отдельные page/hook/type подключения. Откат — обычный
revert integration commit и helper/tests commit; пользовательские данные и main
не сбрасывать. Далее — exact HEAD CI/review; максимальный статус готово к интеграции.
