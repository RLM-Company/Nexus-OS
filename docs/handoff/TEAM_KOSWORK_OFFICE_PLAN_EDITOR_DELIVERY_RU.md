# Koswork: изменение и удаление правок Office

10 ноября 2026, Москва. Ветка `developer/koswork-office-workspace`, PR #466.
BASE_SHA: `fc5bd6cd7713f04d345fa5726e747c39829fe29d`.
Main при начале: `5e14b6bb761c4903b49471b75f5eb7e138befb52` после #493.
Принятые активные сроки разрешений Work сохранены отдельным merge main → feature.
Единственный конфликт — добавленные в конец vault-workspace.test.cjs проверки:
сохранены и Office wrapper test, и новые deadline tests; 32/32 в этом файле PASS.
Production main-реализации не заменены старыми версиями. PR в main не сливался.

## Что работает теперь

Раньше план можно было только пополнять или очистить целиком. Теперь в прежнем
разделе «Рабочие документы Koswork» у каждой операции есть «Изменить» и «Удалить».
Изменение заменяет выбранную операцию на том же месте; удаление сохраняет порядок
и значения остальных. Поддержаны все существующие виды: точная DOCX/PPTX замена,
XLSX ячейка, диапазон и добавление/название нового листа.

Черновик открывается отдельной копией. Сохранение/отмена черновика не вызывают
модель, preview или запись. Ошибка оставляет черновик открытым и прежний план
неизменённым. Отмена возвращает прежние операции. Во время редактирования нельзя
подтвердить старый preview, добавлять/удалять другие операции или незаметно
сдвинуть редактируемый индекс. Очистка/смена исходного файла закрывает черновик.

У диапазона редактируются адрес листа, начальная ячейка, тип и значение каждой
ячейки: смешанные string/number/boolean/null/formula не преобразуются в общий
тип столбца. Ведущие нули и многострочный текст сохраняются. Использован общий
officeCellValue, включая отказ от округления чисел и вычисления формул.
Размер диапазона сохраняется; для другого размера можно удалить только эту
операцию и добавить новый диапазон, не очищая остальные правки.

При начале редактирования, сохранении, отмене или удалении сбрасываются preview,
подтверждение и старый download URL; abort/generation fence исключает поздний
ответ прежнего preview. Запись требует нового реального preview и отдельного
подтверждения. В preview видны адрес, before/after, тип будущей XLSX-ячейки и
имя новой копии. Web сохраняет через download: папку определяет браузер,
произвольный абсолютный путь не имитируется. Уже скачанный файл не удаляется.

## Зависимости листов

Удалить создание нового листа с зависимыми ячейками/диапазонами нельзя: сначала
нужно удалить или перенести зависимые правки. Другие операции не удаляются
каскадом. Если удалён более ранний неиспользуемый новый лист, ссылки последующих
новых листов и выбранный адрес для добавления пересчитываются, сохраняя смысловую
привязку. Существующие исходные листы не перенумеровываются. Переименование не
меняет ordinal/ссылки; повторяющиеся новые имена и ссылки на ещё не созданный
лист отказываются до сохранения черновика.

Семантические зависимости текстовых замен проверяются прежним engine при preview:
если удаление предыдущей замены делает поиск невозможным, весь preview отказывается
без записи. Сервер остаётся окончательной проверкой существующих объектов,
схемы Office, допустимых формул, ZIP/XML/CRC, размеров и версий.

## Подключение и файлы

- `apps/web/src/app/office-plan.ts`: чистые изменения плана, ссылки/зависимости,
  изолированные копии и обратимое представление typed cells.
- `office-plan-editor.tsx`: редактор одной операции и действия в прежнем списке.
- `office-plan.test.ts`: сохранность остальных операций, зависимости, remap,
  mixed-type roundtrip, ошибки без мутации оригинала.
- `apps/web/e2e/office-plan.spec.ts`: шесть настоящих UI→API→download/readback сценариев.
- Минимальная интеграция: `office-document-workspace.tsx`, необязательный disabled
  у существующего `office-range-editor.tsx`, Playwright config и scoped tsconfig.

Используется единственный существующий operations state и API document-workspace.
Нет второго планировщика/store, новой копии чата, миграций, новых contracts/tools
или изменений app.ts. Старые capabilities, owner/file grants и source version
сохранены. Provider HY4, тарифы/квоты не менялись. Новые main deadline-ограничения
сохранены, а не ослаблены ради Office. Sidebar/чат/палитра/глобальные стили прежние.

## Реальный бриф и выходы

[input.json](fixtures/koswork-office-plan-edit/input.json) — синтетический бриф.
В подкаталогах [fixtures](fixtures/koswork-office-plan-edit/) для DOCX/XLSX/PPTX
лежат source._, скачанный result._, result.json с source/new version, SHA256,
executed_changes, rejected_changes, changed_parts и настоящим повторным чтением.
Оригиналы побайтно сохранены, model POST=0. Это реальный Office engine, не ответ
модели или mock Office endpoint. Только fault-сценарий задерживает реальный preview.

- DOCX: исправлена компания на «Компания В», другая правка цены сохранена,
  ошибочная правка «кроме доставки» удалена. Изменился только word/document.xml.
  SHA256 `2ff8c8b76132a4938a6318c0f426effa891ed0e0c45b1114622938f306fdd1c6`.
- XLSX: удалён лишний новый лист, другой переименован, его диапазон rebased к
  sheet:2; число исправлено на 19800, одна boolean-ячейка стала текстом «нет»,
  дата отдельной исходной ячейки изменена на 09.11.2026. В diff остаются только
  согласованные операции. SHA256
  `1764cda68d6cdf92d3c95ac689746c93729565eac00dcae5af76ee2055175002`.
- PPTX: незавершённый DOCX-черновик не перешёл в новый источник, исправлен только
  выбранный title shape, ошибочная правка условия удалена, slide2 сохранён.
  SHA256 `7ace6897c64f59917e6deea3e2f4cb788931c2adb5ad847cd21ea6c57ebfd9a6`.

## Открытие/рендер

LibreOfficeDev 26.8.0.0.alpha0 commit
`2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`, отдельные временные profiles.
Все три файла открылись, PDF export exit 0, DOCX 1 / XLSX 2 / PPTX 2 страницы.
Все пять страниц просмотрены изображениями и проверены pdftotext; исходные
Office SHA до/после рендера совпали. Реальные PDF, текст, команда, stderr и
receipt находятся в соответствующих `render/`. Fontconfig cache warnings
сохранены, не объявляются проверкой всех шрифтов.

Прежняя узкая колонка C исходного XLSX по-прежнему обрезает условие при печати;
полный текст остаётся в XLSX/readback. Модуль не исправляет нетронутое оформление.
Calc вычисляет формулы только для отдельного PDF; engine/API вычисление и
visual acceptance не заявляют. Microsoft Office/ПК владельца, HY4 и production
не использовались. Native fake drivers не означают живую приёмку устройства.

## Проверки, команды, интеграция и откат

- Unit plan + range: 11/11 PASS. Первый standalone lint — exit 1,
  один no-useless-escape в проверке имени. Регулярное выражение заменено на
  проверку явного списка символов; правило не отключалось.
  Лог `first-lint-failure.log` в fixtures, исходник `/tmp/koswork-plan-edit-lint.log`.
- Первые шесть browser-сценариев: 6/6 PASS, retries=0,
  `/tmp/koswork-plan-edit-first-browser.log`. Общий production набор до явного
  показа after-type также прошёл 70/70, `/tmp/koswork-plan-edit-final-browser.log`.
- Native: 395 PASS / 1 Windows-only SKIP / 0 FAIL, 396 всего,
  `/tmp/koswork-plan-edit-native.log`, exit 0; включает принятый новый main.
- Окончательный production browser после показа after-type: **70/70 PASS**,
  workers=1, retries=0, `/tmp/koswork-plan-edit-publish-browser.log`, exit 0.
  Capture этого прогона скопирован в fixtures и совпал с отрендеренными байтами.
- Первый общий core gate — exit 0, `/tmp/koswork-plan-edit-core.log`.
  Финальный gate после показа after-type — **exit 0**,
  `/tmp/koswork-plan-edit-core-final.log`: web **281 PASS** заново, API **952 PASS**
  из Turbo cache, DB 173, contracts 206, config 17, core 386, gateway 151, policy 43,
  tool runtime 64 PASS / 4 local OCI SKIP. Format/secrets/lint, app/Office/composer
  typecheck, build, root guards/privacy/profile PASS.

```sh
pnpm --filter @cosmora/web exec vitest run src/app/office-plan.test.ts src/app/office-range.test.ts
KOSMORA_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  KOSWORK_PLAN_REPORT_DIR=/tmp/koswork-new-plan-proof \
  pnpm --filter @cosmora/web exec playwright test --config=playwright.office-composer.config.ts office-plan.spec.ts
pnpm --filter @cosmora/web typecheck
pnpm --dir desktop/windows check
pnpm check:core
git diff --check
```

Для повторного Linux-рендера сохранённых выходов, если LibreOffice уже установлен:

```sh
for format in docx xlsx pptx; do
  mkdir -p "/tmp/koswork-plan-render-review/$format"
  soffice "-env:UserInstallation=file:///tmp/koswork-plan-render-review-profile-$format" \
    --headless --convert-to pdf --outdir "/tmp/koswork-plan-render-review/$format" \
    "docs/handoff/fixtures/koswork-office-plan-edit/$format/result.$format"
done
```

Capture требует новый каталог (`wx` защищает предыдущие файлы). Общий 70-прогон
добавляет work-progress-refresh.spec.ts к тому же config, workers=1/retries=0;
способ временного расширения показан в предыдущем XLSX ranges handoff. Browser
и Next build/gate в одной `.next` запускать последовательно.

Применять source и минимальную integration вместе, сохраняя отдельный merge main.
Merge main commit `24175bcbe1905d90f1602b86332ce907b6c949e6`; source
`09469d8732c2a111c9e6002b6e4077e4676532f6`. Проверенное объединённое дерево
`81ddb4a245f6460358b044db319325b764416adb`; integration
`4df938fa1a91bff581740fe6fa6f547779768b8e`. Итоговый docs/artifact SHA и внешние
checks фиксируются в PR. Откат — revert интеграции, затем новых
модулей/docs, без отката принятых deadline-защит main и удаления скачанных файлов.
План остаётся временным состоянием выбранного файла в текущем редакторе; новое
постоянное хранилище/история undo/reorder не вводились. Все прежние пределы
40 операций, 100 изменений, 16 000 байт плана и 10 000 байт diff сохранены.
Merge PR/deploy исполнителем не выполнялись.
