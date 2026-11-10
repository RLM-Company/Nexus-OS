# Koswork: восстановление сохранённого плана Office

10 ноября 2026, Москва. Ветка `developer/koswork-office-workspace`, PR #466.
BASE_SHA: `ae0c5d1f8e40cf24e737c28595a4aa707d341855`.
Main при начале: `5bedaa59f11c4576f07de61aabf5fc428983bf5a` после #494.
Он принят отдельным merge, без конфликтов; подтверждённые поправки Work и изменения
browser, принадлежащие main, сохранены. Merge main → feature:
`fca4e24361a1cce1846051f73656380270184176`. PR в main не сливался.
Владелец явно согласовал этот следующий блок после предложения восстановления.

## Что было и что работает

Ранее весь Office-план терялся при перезагрузке. В существующей области файлов
появились «Сохранить черновик плана», «Восстановить черновик плана»,
«Удалить сохранённый черновик» и «Проверить сохранённый черновик».

Открыть DOCX/XLSX/PPTX → добавить/исправить операции → явно сохранить черновик →
перезагрузить → заново выбрать тот же файл → получить реальный inspect/version →
явно восстановить → запросить новый preview → отдельно подтвердить → скачать
проверенную копию. Автоматического восстановления или записи документа нет.
Восстановление использует прежний `applyPlan`: abort/generation fence, очистка
preview/подтверждения/ссылки результата, тот же operations state и те же API.

В localStorage сохраняется один атомарный ограниченный JSON на точное имя файла:
schema/revision/savedAt/name/source_version/existingSheets/operations. Байты файла,
preview token, download URL, ответ модели и подтверждение не сохраняются.
Восстановление разрешено только для того же имени, SHA256-версии и числа листов.
Другая версия отклоняется; старый черновик не затирается до явного удаления.
Незавершённые поля/редактируемая операция не сохраняются. Автосохранения на unload
нет; изменения после кнопки требуют нового явного сохранения. Очистка текущего
плана не удаляет сохранённый снимок; удаление снимка не очищает текущий план.

## Проверки и границы хранилища

Данные считаются недоверенными: точная схема без лишних полей, допустимые виды
операций по формату, общие лимиты плана, зависимости листов, прямоугольные диапазоны,
типы/точность значений проверяются до восстановления. Серверный Office engine
по-прежнему окончательно проверяет targets, формулы, ZIP/XML/CRC и expected_version.
Формулы не исполняются и внешние ресурсы не загружаются.

Срок восстановления — 7 дней, максимум 20 записей, 400 000 UTF-16 символов суммарно,
24 000 символов на запись. Старые/повреждённые записи остаются до отдельного удаления;
срок не означает фоновое физическое стирание. Квота/запрет localStorage не уничтожают
прежний снимок или текущий план. Другие Office-черновики и черновики чата не вытесняются.

Web Locks сериализует действия всего Office namespace, включая проверку общего
лимита. Занятая блокировка отказывается сразу, без отложенной записи/восстановления
после смены источника. Сравнение полного ранее прочитанного record и уникальная
revision отклоняют устаревшие save/restore/delete, в том числе A-B-A с теми же правками.
Storage event предупреждает об изменении, но не подменяет текущий план/снимок молча;
пользователь явно проверяет и восстанавливает новое состояние. Это координация
вкладок приложения; скрипты с доступом к тому же origin также имеют доступ к storage.

Нужны Web Locks и secure context (HTTPS/localhost); при отсутствии действие
отклоняется с сообщением, обычный редактор продолжает работать. Снимок локален
профилю браузера, без синхронизации/шифрования/автоочистки аккаунта; интерфейс прямо
сообщает о текстах правок и доступе пользователей профиля до кнопки сохранения.
Исходник нужно выбрать заново: хранение плана не даёт доступа к файлам/папкам.
Desktop file grants, capability negotiation и отзыв папки не ослаблены.

## Файлы и интеграция

- `apps/web/src/app/office-draft-storage.ts`: ограниченный codec, проверка версии,
  CAS snapshot и лимиты. Использует существующие Office validators; composer store
  хранит сообщения/вложения и не подменяется офисными операциями.
- `office-plan-draft.tsx`: явные действия в прежнем редакторе, storage notices,
  Web Locks и fence при unmount/редактировании.
- `office-draft-storage.test.ts`: восемь unit-сценариев.
- `apps/web/e2e/office-draft.spec.ts`: девять UI/API/download сценариев.
- Отдельная минимальная интеграция: `office-document-workspace.tsx` (8 строк),
  `playwright.office-composer.config.ts` и `tsconfig.office-e2e.json` (по строке).
- Этот handoff, fixtures `fixtures/koswork-office-draft/`, верхнее дополнение
  `TEAM_KOSWORK_FULL_INTEGRATION_DELIVERY_RU.md`.

Новых routes/migrations/contracts/tools/app.ts и зависимостей нет. Sidebar/чат,
логотип/палитра/глобальные стили прежние. HY4, модель прав, тарифы и квоты не менялись.

## Воспроизводимые выходы и рендер

В каждом подкаталоге DOCX/XLSX/PPTX лежат настоящий source, скачанный result,
неизменённый `draft.txt`, его форматированное представление `draft.json`,
`result.json` с версиями/SHA/diff/readback и отдельный renderer receipt/PDF/text.
Все входы синтетические из существующего `fixtures/koswork-office/offer.*`.
Модель не вызывалась (model POST=0 в трёх export-сценариях); провайдер стенда mock.
Office API и ZIP/XML обработка настоящие. Исходники побайтно сохранены; каждый
выход проверен hash/version и отдельным inspect. Различия частей архива ограничены
явными allowlists. DOCX/PPTX: компания В, 19 700, 00123, дата и «кроме доставки».
XLSX: новый лист с mixed types, 00123/00456, 19700/-12.5, true/false и формулами
без вычисленного cache; исходный лист побайтно сохранён.

SHA256 результатов:

- DOCX `014c4e83b84afb67e814aa6e964e42b22b660624b6f744fdb067ea7deb13ea81`.
- XLSX `a7fbfe7d861b3b80dcba880c8991e1e5dcff804bb5bb59d37e38f115ace89b00`.
- PPTX `7ace6897c64f59917e6deea3e2f4cb788931c2adb5ad847cd21ea6c57ebfd9a6`.

Standalone LibreOfficeDev 26.8.0.0.alpha0,
commit `2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`: export exit 0 для всех трёх,
DOCX 1 / XLSX 2 / PPTX 2 страницы, все пять просмотрены PNG + pdftotext.
Рендер выполнен для первых реальных выходов; побайтное равенство финальным
выходам проверено. SHA исходников не изменился. Fontconfig cache warnings
сохранены в receipt; проверка всех шрифтов не заявляется. Прежняя узкая колонка C
исходного XLSX по-прежнему обрезает условие на печати, полный текст сохранён в
XML/readback. Calc вычисляет формулы только в отдельном PDF; это не вычисление
engine/API. Microsoft Office/ПК владельца, production и HY4 не проверялись.

## Фактические проверки

- Unit draft/plan/range: **19/19 PASS**, включает 8 новых тестов.
- Первый lint — exit 1: шесть замечаний (unsafe JSON argument/member access и
  control character regex). JSON сужен из unknown, NUL проверяется строковым
  методом. Следующий scoped lint — exit 0, правила не отключались.
- Первый production draft run — **7 PASS / 1 FAIL**, retries=0. Тест удаления
  прочитал storage до асинхронного Web Lock callback; исправлено ожидание
  пользовательского сообщения об удалении. Исходный лог `first-browser-failure.log`
  сохранён в fixtures (удалены только хвостовые пробелы строк). Новая проверка занятой блокировки добавлена до финального run.
- Общий финальный production run — **79/79 PASS**, workers=1/retries=0,
  `/tmp/koswork-draft-final-browser.log`, exit 0. Включает 72 Office/composer/file
  и 7 Work progress сценариев; все девять новых прошли.
- Office/app/composer typecheck — exit 0; scoped lint — exit 0.
- Desktop после принятого main: **404 PASS / 1 Windows-only SKIP / 0 FAIL**, 405 всего,
  `/tmp/koswork-draft-native.log`, exit 0. Это fixtures/fake drivers, не приёмка ПК.
- `pnpm check:core` — **exit 0**, `/tmp/koswork-draft-core.log`.
  Свежие web **289 PASS**, API **957 PASS**, DB 173, contracts 206, core 386,
  gateway 151, policy 43; tool runtime 64 PASS / 4 local OCI SKIP. Config 17
  восстановлены из Turbo cache; это не свежий запуск этих 17 тестов.
  Format/secrets/lint, app/Office/composer typecheck, production build,
  root guards/privacy/profile PASS. Staged secret scan и diff --check PASS.
  При импорте исходного failure log diff --check нашёл два хвостовых пробела;
  удалены только они, повторная проверка прошла.

```sh
pnpm --filter @cosmora/web exec vitest run src/app/office-draft-storage.test.ts src/app/office-plan.test.ts src/app/office-range.test.ts
KOSMORA_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  KOSWORK_DRAFT_REPORT_DIR=/tmp/koswork-draft-new-capture \
  pnpm --filter @cosmora/web exec playwright test -c playwright.office-composer.config.ts office-draft.spec.ts
pnpm --filter @cosmora/web typecheck
pnpm --dir desktop/windows check
pnpm check:core
git diff --check
# Отдельный рендер, если LibreOffice уже установлен:
soffice -env:UserInstallation=file:///tmp/koswork-review-docx-profile --headless \
  --convert-to pdf --outdir /tmp/koswork-review-docx \
  docs/handoff/fixtures/koswork-office-draft/docx/result.docx
```

Capture требует нового каталога (`wx` не позволяет затереть прошлые выходы).
Для общего 79-прогона временный config импортирует office-composer config и
добавляет `**/work-progress-refresh.spec.ts` к testMatch; временный файл удалён
после прогона. Не запускать Next build/core gate одновременно с browser на одной `.next`.

## Передача и откат

Source и минимальную integration применять вместе после merge актуального main.
Source commit `47bb072b384a535618b9b34718f59020ac054dc7`;
минимальный integration `8ebcc8cb66746facb53dabf37fad0ab11d79610a`.
Объединённое проверенное code tree `209402b3be1cc5cb29d6dda70db16be259cf9a9b`.
Итоговый docs/artifacts head фиксируется в PR.
Внешние CI receipts фиксируются в PR отдельно для конкретного head.
Откат: revert integration, затем новые source/tests/docs. Для удаления снимка
в UI служит отдельная кнопка; revert кода сам не стирает localStorage. При ручной
очистке удалять только ключи с точным prefix `koswork:office-plan:v1:`, не черновики
чата/материалы. Скачанные файлы/исходники откат не меняет. Merge/deploy не выполнялись.
