# Flaky chat: доказанный дефект gate и сохранение диагностики

12 ноября 2026, ID 02_DEVELOPER. Статус: подготовлено к проверке CI.
BASE_SHA `33f43b8825756d60c67db306783fed9e3de717ee`.
Source `33f601479a82e1cd471274db1b1ff3ba98be7623`,
CI integration `49876e6da50d874a459ae169efef2d1f32a99c75`.
Ветка `fix/chat-draft-e2e-diagnosis-2026-11-12`; final HEAD/PR — в описании PR.

## Факты и предел вывода

В CI43262386490/browser131336988797 исходный тест chat-reliability.spec.ts:87
показал «Ошибка запуска» вместо «Ответ получен», затем прошёл встроенный retry.
Результат был 489passed +1flaky и job SUCCESS. Артефакты этого run проверены:
только два preview, trace/terminal error_code не сохранились. Workflow загружал
browser diagnostics только при failure(), поэтому восстановленное падение потеряло
диагностику. Это подтверждённые дефекты контроля проверки, не доказательство причины
ошибки пользовательского чата.

На отдельном production fixture HTTP/SQLite/Chromium стенде исходный сценарий
прошёл10/10 с retries0. В mixed run с двумя workers он также прошёл. Mixed run
завершился на чужом Games file://: managed Chromium вернул ERR_BLOCKED_BY_ADMINISTRATOR.
160PASS,1FAIL,1interrupted,328not run и1outside-test error; полный suite не принят.
Политика браузера не обходилась. Гипотеза взаимного влияния owner settings не подтверждена.
Реальная причина исторического chat-сбоя остаётся неизвестной; не называем её исправленной.

## Что изменено

- apps/web/playwright.config.ts: failOnFlakyTests в CI, retry остаётся1 для диагностики.
- apps/web/src/app/e2e-flaky-policy.test.ts: реальный Playwright child runner с
  искусственным первым FAIL и успешным retry. С исходным config exit0 — тест падает;
  с исправленным config exit1 — тест проходит. Браузер и API в этом probe не запускаются.
- apps/web/e2e/chat-reliability.spec.ts: отдельная проверка HTTP acknowledgement;
  при terminal failure bounded GET сохраняет только role/status/error_code.
  Исходная ошибка сохраняется, даже если diagnostic GET/attach не удался.
- .github/workflows/ci.yml: одна строка условия artifact upload, отдельный integration
  commit49876e6. Теперь загружается после завершённого job независимо от recovery.
- Собственные отчёты и fixtures/chat-flake-2026-11-12/; без изменений оболочки/дизайна.

Не менялись production runtime, маршруты, схема/DB, HY4, цены/квоты, разрешения,
изоляция, default network или файловая политика браузера. Новых зависимостей проекта нет.

## Проверки и воспроизведение

После fix: policy regression1PASS; chat-reliability16PASS без retry; web363PASS
и10/10 studio checks; web types и lint прошли. Production build исполнен в Playwright
webServer. Сквозной chat использует настоящий локальный HTTP/API/SQLite и Chromium;
провайдер — fixture, реального ИИ API не было. Node24.22.1, pnpm11.25.0,
зависимости по frozen lockfile установлены с ignore-scripts в отдельной cloud worktree.
Это не установка на ПК владельца. Игнорируемые synthetic databases не включены в поставку.

```sh
pnpm --filter @cosmora/web exec vitest run src/app/e2e-flaky-policy.test.ts
pnpm --filter @cosmora/web typecheck
pnpm --filter @cosmora/web lint
pnpm --filter @cosmora/web test
KOSMORA_E2E_PRODUCTION=1 pnpm --filter @cosmora/web exec playwright test e2e/chat-reliability.spec.ts --retries=0
```

На managed стенде использован временный config, наследующий основной с cwd/testDir
и launchOptions.executablePath=/usr/bin/chromium; он не ослабляет browser policy.
Все pnpm run здесь запускались с pnpm_config_verify_deps_before_run='', чтобы не
вызывать неявную установку зависимостей. Логи нормализованы только по LF/хвостовым
пробелам; JSON — Prettier. Неудачные исходные прогоны сохранены.

## Интеграция, откат и следующая точка

Сначала exact final HEAD CI. Если снова будет flaky — job должен завершиться FAIL,
после чего читать trace и draft-chat-terminal-state, а не повторять до зелёного.
Если suite пройдёт, это подтверждает gate/диагностику и текущий сценарий;
исторический root cause всё равно не восстановлен. Для дальнейшего исправления
chat runtime нужен конкретный код отказа/trace, а не предположение.

Откат source и отдельного integration commit через revert в рабочей ветке;
не reset main и не удалять данные. Текущий PR551 и независимый PR549 не сливались.
Merge/deploy не выполняются; запрос разрешения не подменяет исправление кода.

Первый diff check упаковки указал лишнюю пустую строку в конце policy-after-passed.log;
она убрана только при нормализации логов, результаты тестов не менялись.
