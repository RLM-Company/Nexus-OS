# Gemini: продолжение петли 05_GEMINI после проверки поставки

Твоя сфера не меняется: browser + Deep Research. Это исправление результата
твоей автономной петли, а не новая абстрактная задача/отчёт. Следующий результат
должен работать с существующей Kosmora, без параллельной реализации продукта.

## Что получил интегратор

Документ 05_GEMINI-ops-gemini-browser-research содержал 31file patch. Все оригиналы
сохранены в reference/gemini-operation-20261110, commit b992e6397da8a6acd446714e9ef3ff1b188e377d.
Он не применим к действующему main: существующие browser engine/document/policy/
recovery/search/shell и research-workspace/page.tsx объявлены new file.
ci/unified-task-coordinator.cjs отсутствует в продукте.

## Сначала исправь базу

Репозиторий https://github.com/RLM-Company/Nexus-OS . Снимок для этого задания:
f9da6e83c8764949d7a478649b8d680517f1c320; runtime совпадает с 619efe6a.
Получай актуальный main, сохраняй BASE_SHA и merge-base. Не используй прежнюю
локальную 09369af как продуктовую базу, не выдавай написанный рядом sandbox за main.
Если сеть недоступна, используй приложенный CURRENT_BASE_CONTEXT.txt (полные
выбранные исходники на указанномSHA). Честно обозначай, что это subset и полного
checkout/build нет. Для изменений за пределами subset запроси конкретные файлы,
а пока делай независимый первый срез. Не изобретай отсутствующие exports/классы.

## Реальные точки расширения

- desktop/windows/browser/engine.cjs: createBrowserEngine, текущие Electron
  WebContents/CDP и ComputerSession; read_text/find_text/version уже существуют.
- desktop/windows/browser/shell.cjs: createBrowserShell с проверкой identity,
  taskGate, профилем и разрешениями. Не заменять отдельным shell-host.
- apps/api/src/research/research-routes.ts: registerResearchRoutes, Fastify,
  identityFor, projects, policy, emergency и ownerBudget.
- research-store.ts / research-coordinator.ts / research-synthesis.ts /
  research-privacy.ts / page-reader.ts: расширять их, не заводить второй InMemory store.
- apps/web/src/app/research-workspace/page.tsx: существующий рабочий UI.
- Общий Work runtime — work-cycle-driver/computer-session, а не ci-координатор.

## Обязательные исправления доказательств

Чистый helper verifyEvidenceAgainstSnapshotAndClaim из твоего patch реально
вернул verified=true во всех трёх неверных случаях:

1. snapshot='Цена Beta: 5000 рублей.', claimedValue='50', optionName='Alpha'.
2. тот же snapshot, claimedValue='5000', optionName='Alpha' (цитата про Beta).
3. snapshot='Цена Alpha: 50 рублей.', pageVersion='v1', claimedValue='50',
   excerpt.pageVersion='different-version'.
   В excerpt использованы точные quote и startUtf16=0/endUtf16=длина текста.

Добавь отрицательные регрессии. Цифры сопоставлять с границами и единицами,
не includes и не умножением на 1000/1024/12 без известной размерности.
Привязывать цитату к доверенному snapshot ID/версии/URL и исходным UTF16 позициям.
Данные клиента/модели не могут сами себя объявить доверенным снимком.
Отделять source_quote_verified от claim_assessment: matching tokens или вывод
модели не являются доказательством истины. При неоднозначном субъекте, критерии,
отрицании/единице/дате вернуть unknown/unconfirmed, а не invent verified.

## Первый поставляемый срез

Сделай одно полезное улучшение текущего Research: связь утверждения с точной
существующей source/excerpt/version и честное отклонение неподтверждённых ссылок.
Доведи через существующий entrypoint и scoped fixtures; не присылай только helper.
Сохрани restart/cancel/owner-project isolation/privacy lifecycle.
После первого среза продолжай свою очередь snapshots/dedup/bounded research/
contradictions через те же runtime/store и adapter. Не выбирай победившее значение
по большинству дублирующих сайтов, не стирай противоречия, не называй эвристику
семантическим доказательством.

## Границы и сдача

Не менять chat/sidebar/logo/globalCSS, не расширять grants и OS права, не
подключать новые ключи, не выполнять платные/live calls и VPS/owner-PC действия.
Не отправлять root scripts с переписыванием main. Общие hooks — отдельный
маленький integration commit; не ссылаться на несуществующий coordinator.

Сдача: BASE_SHA/HEAD_SHA, реальный branch/PR или git diff --binary относительно
приложенного base, код+тесты+entrypoint, команды с фактическими результатами и
ограничения. git apply --check на base обязан пройти. Если нет checkout, не
объявляй прохождение этой команды: сохрани условие и дай точный delta, не new-file
замены существующих файлов. Owner isolation/unknown outcomes обязательны.
Бенчмарки против реального baseline на одной панели; не рекламировать 7.4→1.2 сек
без воспроизводимого скрипта и проверки Codex. Сохрани checkpoint и продолжай
петлю в рамках сферы; при лимите остановись с точкой продолжения.
