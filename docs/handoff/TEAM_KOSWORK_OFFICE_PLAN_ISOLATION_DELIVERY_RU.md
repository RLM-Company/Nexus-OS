# Office: неизменность подтверждённого плана

10 ноября 2026, Москва. Ветка `developer/koswork-office-workspace`,
[PR #466](https://github.com/RLM-Company/Nexus-OS/pull/466).
Начальная поставка: `90fbc36bb60f1bbab0f5b937bbca8a4fc8f836b3`.
При продолжении сохранён main `cabe400d5e9d7606a96117187ed46c55e8f008d5`
после #487; перед публикацией обнаружен также main
`9a7ffec6846b1a02f041f2c69ea9a726fdff49fd` после #488; он также включён без конфликтов, предыдущие main-изменения сохранены.

## Дефект и исправление

Native `preview` сохранял и возвращал один объект receipt. Вызывающий JS-код,
сохранивший ссылку на результат, мог поменять `output_path` после preview:
последующий commit действительно записывал файл по новому пути. Кроме того,
в diff оставалась ссылка на вложенный `value` входной XLSX-операции. Изменение
`value.formula` после preview меняло отчёт о выполненных правках, хотя выходные
байты уже были подготовлены с прежней формулой.

Это дефект целостности API внутри процесса; удалённое изменение JS-памяти
моделью или через IPC здесь не заявляется. Проверка использует настоящий
workspace-service, grant и временные Office-файлы. Никаких реальных данных
владельца, HY4 или внешних запросов.

`office-workspace.cjs` теперь делает отдельный глубокий snapshot квитанции
при построении плана и возвращает отдельную копию. Внутренний план больше
не разделяет вложенные объекты ни с входными operations, ни с возвращённым
preview. Существующий `describe` сохраняет свою защитную копию. Подготовленные
байты не пересоздаются, подтверждение, single-use, source version, grant и
проверка непосредственно перед записью сохранены.

Действующий путь: существующий Work tool `workspace_office_preview` →
`computer-workspace.cjs` → `workspace-service.previewOfficeDocument` →
`office-workspace.preview`; отдельный `workspace_office_commit` использует
прежний план. Новый исполнитель, store или UI не добавлялись. Web export API
остаётся отдельным существующим stateless adapter и этого native plan не хранит.

## Реальные входы, выходы и diff

[Fixtures](fixtures/koswork-office-plan-isolation/) содержат четыре сценария:
DOCX/XLSX/PPTX с изменением возвращённой квитанции и отдельный XLSX с изменением
входного объекта формулы. В каждом каталоге `source.*` — настоящий вход,
`approved.*` — сохранённый workspace-service результат, `result.json` — чтение
результата, source/new version, SHA256 и `executed_changes` с before/after.
[Общий результат](fixtures/koswork-office-plan-isolation/results.json).

Проверены неизменность исходника, отсутствие `unexpected.*` и
`described-unexpected.*`, сохранение согласованного пути/версии/hash/diff,
повторное чтение и отказ повторного commit. Изменение отдельно возвращённого
`describe` тоже не влияет на запись. В XLSX сохранена `SUM(B1:B1)`, а не
подставленная после preview `SUM(A1:A1)`; формулы модулем не вычисляются.
`00123`, дата, `19 700`/19700 и «кроме доставки» проверены по реальному чтению.

| Формат             | SHA256 выходных байтов                                             |
| ------------------ | ------------------------------------------------------------------ |
| DOCX               | `3d64fd25ffa22af115d6407d668bd9b025f97d09df46d68b3d539b511d098b1c` |
| XLSX, оба сценария | `8da8f293735dab2f1b69ffe6efed53fa04fbc669456e327e69bd37e4d1c61d61` |
| PPTX               | `23ac52edc212d346907ac7fc6732d5fc8ca24e4f233c03f3688fa985a08da760` |

Все выходы побайтно совпали с ранее сохранёнными
`fixtures/koswork-office/offer.updated.*`. Прежние Linux render artifacts
относятся к этим же байтам. Новое открытие/рендер в этой работе не выполнялись;
ограничения печати XLSX и прежнего renderer сохранены в исходном Office handoff.
Microsoft Office/Windows visual acceptance и настоящий HY4 не заявляются.

## Проверки и воспроизведение

До исправления: **4 FAIL / 0 PASS**, exit 1.
[Настоящий red-log](fixtures/koswork-office-plan-isolation/failure-before-fix.txt)
содержит записи `unexpected.docx/xlsx/pptx` и расхождение формул в diff.
При переносе red-log `git diff --check` нашёл конечные пробелы в строках
Node test reporter; удалены только эти пробелы. Исходный лог сохранён в
`/tmp/koswork-plan-isolation-red.log`. После исправления: **4/4 PASS**. Затем добавлена проверка изолированного
`describe`, и полный native check прошёл: **386 PASS / 1 Windows-only SKIP /
0 FAIL**, 387 всего, exit 0. Лог `/tmp/koswork-plan-isolation-native.log`.
Production browser до включения #488: **52/52 PASS**, retries=0,
`/tmp/koswork-plan-isolation-browser.log`. На окончательном коде с #488:
**59/59 PASS**, retries=0, workers=1, exit 0,
`/tmp/koswork-plan-isolation-browser-final.log`: 52 Office/composer/CSV/Studio/upload
и семь принятых Work progress/retry/recovery сценариев.

Scoped Office E2E typecheck: exit 0. Финальный `pnpm check:core`: **exit 0**,
`/tmp/koswork-plan-isolation-core.log`; format/secrets/lint/typecheck/build,
root guards/privacy/profile PASS. Web tests **270 PASS** выполнены заново,
API **952 PASS** использовали Turbo cache; DB 173, contracts 206, config 17,
core 386, gateway 151, policy 43, tool runtime 64 PASS / 4 local OCI SKIP.

Standalone scenario runner выполнил все четыре реальных записи, exit 0,
`/tmp/koswork-plan-isolation-delivery`; эти файлы скопированы в delivery fixtures.

Из корня checkout, с установленными зависимостями:

```sh
node --test desktop/windows/test/office-plan-isolation.test.cjs
node desktop/windows/test/fixtures/run-office-plan-isolation.cjs /tmp/koswork-office-plan-proof
pnpm --dir desktop/windows check
pnpm --filter @cosmora/web exec tsc -p tsconfig.office-e2e.json
pnpm check:core
git diff --check
```

Runner требует новый каталог, чтобы не перезаписать прежние доказательства.
Общий browser-прогон 59 сценариев воспроизводится временной конфигурацией;
на этом checkout не запускать его одновременно с Next build/gate:

```sh
(
set -e
proof_config=apps/web/playwright.koswork-plan-proof.tmp.ts
test ! -e "$proof_config"
trap 'rm -f "$proof_config"' EXIT
cat > "$proof_config" <<'TS'
import { defineConfig } from "@playwright/test";
import base from "./playwright.office-composer.config";
export default defineConfig({ ...base, testMatch: [...(base.testMatch as string[]), "**/work-progress-refresh.spec.ts"] });
TS
KOSMORA_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @cosmora/web exec playwright test --config=playwright.koswork-plan-proof.tmp.ts
)
```

Входы воспроизводятся существующим `office-edit-brief.cjs`; доступ ограничен
только созданной fixture-папкой. Тестовые profile/grant хранятся во временном
каталоге и очищаются после отзыва доступа.

## Файлы, интеграция и откат

- `desktop/windows/workspace/office-workspace.cjs`: глубокие snapshots плана.
- `desktop/windows/test/office-plan-isolation.test.cjs`: четыре регрессионных теста.
- `desktop/windows/test/fixtures/run-office-plan-isolation.cjs`: настоящий сценарий
  I/O с сохранением входов, выходов и отчёта, используется также тестами.
- Этот handoff, ссылка из общего handoff и реальные fixture artifacts.

Окончательный source commit: `156836487817f7979dee006af1272a1583c1431b`,
проверенное дерево `14c6ebc19f8fb1f6a315bee711ac9c8d42f058d9`.
Merge main: `9174b4dc90ee10f4626efc2b25f1bfe9a08d034e`.
Итоговый docs/artifact SHA и внешние checks фиксируются в PR после публикации.

Регистрация маршрутов/инструментов и миграции не нужны: исправлен уже подключённый
модуль. Принятые изменения main сохраняются отдельным merge-коммитом ветки.
Откат — revert только коммита изоляции и при необходимости его тестов/docs;
не откатывать принятый main, не удалять пользовательские файлы. Откат возвращает
описанный дефект aliasing и не рекомендуется без эквивалентной защиты.
Merge PR/deploy/действия на ПК владельца не выполняются.
