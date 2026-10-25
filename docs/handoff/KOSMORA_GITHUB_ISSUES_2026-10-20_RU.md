# GitHub Issues → задача Code

База: `RLM-Company/Nexus-OS`, `codex/studio-excel-export-20261017`, commit **1314280a429273ea3f46208c31847eb78efb9491** (PR359). Исходники получены через подключённый GitHub API: все 973 Git blobs проверены по SHA, восстановленный Git tree **a139007dfd8edbaf3f74e77e4ffaabec483d9a7a** совпадает с tree этого commit. Старые b15912d/Code ZIP не использованы как база. Прямой Git relay не предоставил авторизацию; никаких ключей не запрашивали. Remote branch/PR не создавались: результат передаётся интегратору файлами.

## Готовый пользовательский сценарий

В существующем `/code-agent`, внутри текущей секции новой задачи, раскройте «Выбрать задачу из GitHub Issues». Доступны список, буквальный поиск по заголовку/описанию, состояния open/closed/all, ограниченные страницы, просмотр заголовка/описания/даты и каноническая ссылка GitHub. PR из GitHub /issues исключаются. Список и описание читаются настоящим серверным клиентом через существующее подключение GitHub; в продукте нет fixture карточек.

«Подготовить задачу Code» переносит редактируемую задачу и отдельный редактируемый `issue_context`. Действие не создаёт Code run, не резервирует бюджет, не вызывает AI/OCI и не пишет в GitHub. Подтверждение замены текущего черновика защищает уже введённую задачу. Владелец затем отдельно нажимает существующее «Предложить исправление». Подготовка сбрасывает прежнее согласие на автоматическую проверку; дальнейшие snapshot/proposal/check/review/Draft PR используют прежний flow.

Текст issue — недоверенные данные. Заголовок не вставляется в инструкции задачи; описание/заголовок передаются отдельно в `untrusted_github_issue_context`, системная граница явно запрещает трактовать их как полномочия или инструкции для инструментов/внешних URL. UI выводит literal React text/pre/textarea, без HTML/Markdown execution, загрузки изображений или ссылок из описания. Единственная активная ссылка строится самим продуктом для фиксированного repo/issue number.

## Ограничения и безопасность

- GET только для настроенного server-side repository. Нет repo/baseURL/token/URL параметров, комментариев, закрытия issues, новых OAuth scopes или изменения permissions. Authenticated fetch использует существующие token/owner/configuration из `GithubIntegration`. Ошибки доступа показываются честно; 404 может означать отсутствие issue, disabled Issues или отсутствие прав, GitHub не всегда различает это.
- `/api/v1/projects/:projectId/github-issues` и `/:number`: owner actor + configured owner + владение проектом проверяются до и после чтения; чужой проект не вызывает GitHub. Ответы no-store. Контроллеры отменяются при закрытии HTTP соединения и приложения.
- По 20 upstream записей, страницы1–10 (до200 включая PR в исходной list выдаче), без авто-догрузки/следования Link. Поиск ограничен160 символами, весь запрос — quoted literal внутри фиксированного `repo:… is:issue`; кавычки/backslash/controls отклоняются. Search indexing может запаздывать; неполная выдача и cap показаны. Страница может содержать меньше20 issues из-за исключённых PR.
- До4 одновременных upstream чтений, deadline15 секунд на fetch+body, до2MB decompressed response. UTF-8/JSON/shape, число элементов, repository_url/number/state проверяются. Redirect запрещён; URL из issue/Link не читаются. Error payload/token не попадают в ответ.
- Просмотр описания до24 000 UTF-16 characters; полный размер и факт сокращения видны. Контекст до7000, title до512, **task + JSON.stringify(issue_context) вместе до8000 символов**, одинаково UI/API. Локальный preparer использует bounded binary search с учётом JSON escaping, не повреждает surrogate pair. Любой сокращённый фрагмент требует видимого явного подтверждения; редактирование фрагмента сбрасывает подтверждение. Превышение общего лимита блокирует запуск, не обрезает его молча.
- Repo/project входят в UI scope; смена проекта размонтирует picker, отменяет fetch и исключает старый подготовленный контекст. Generation/version/AbortSignal guards гасят late responses. При смене repo API ответ не принимается; Code дополнительно сверяет `issue_context.repository` с текущей конфигурацией.
- Issue context сохраняется в JSON существующего Code run, включён в существующий idempotency digest. Requests без context сохраняют прежний digest и совместимость с durable retry. Новая таблица/миграция не нужна; owner budget, ledger/uncertain reservations, A0–A2, OCI, snapshot/patch/check и публикация не переписаны. Issue обновления после выбора не подтягиваются автоматически: сохраняется просмотренный/отредактированный контекст и его source_updated_at.

## Применение

В ZIP19 изменённых/новых исходников с путями репозитория, все патчи, manifest/hashes и журналы. Общие файлы не заменять целиком поверх параллельной работы интегратора. Выберите один вариант:

```bash
# На точной базе1314280a — всё одним unified patch, включая новые файлы:
git apply --check kosmora-github-issues-1314280a-full.patch
git apply kosmora-github-issues-1314280a-full.patch

# Либо отдельные части для root integration:
git apply kosmora-github-issues-1314280a-feature.patch
git apply kosmora-github-issues-1314280a-integration.patch
git apply kosmora-github-issues-1314280a-app-wiring.patch
```

Feature patch: новые серверные/client/UI модули и проверки, включая дополнения существующего Code test. Integration patch: пять файлов — `github-integration.ts`, `code-agent/routes.ts`, `service.ts`, `store.ts`, web `code-agent/page.tsx`. Отдельный app-wiring patch: только import/register новых read-only маршрутов в `apps/api/src/app.ts`. Не применять full и split одновременно. При изменившемся checkout переносить только соответствующие hunks; все варианты проверены git apply и побайтным сравнением результата с ZIP. CSS/global nav, Windows, migrations, package.json/lockfile и provider registry не менялись.

## Реально выполнено

| Проверка | Результат |
|---|---|
| API focused + существующий GitHub/Code regression |77/77 PASS, из них14 новых Issues HTTP cases и3 новых Code context cases |
| Web Code unit regression |10/10 PASS, из них4 новых preparation/client cases |
| Chromium UI на настоящих локальных API/SQLite/GitHub HTTP fixture |3/3 PASS: literal/no remote resources/no AI before separate Code action; state/search/denied/cancel/project switch; bounded truncation/edit approval/input cap |
| Typecheck |9/9 пакетов PASS; финальный API повтор PASS; web также проверен финальным Next build |
| Lint |9/9 пакетов PASS; финальный API/Web повтор PASS |
| Production build |9/9 пакетов PASS; финальный повтор после UI сверки PASS |
| Prettier, git diff --check, secret scan |PASS для всех19 исходников |
| Exact baseline / patches / ZIP |973 blobs и Git tree сверены с GitHub; full/split apply и SHA256 исходников проверены |

Итого90 focused/regression checks (77+10+3), не утверждение о полном monorepo test suite. В существующем тесте historical funded registry фиксирован fixture clock в момент его recorded verification: иначе17 октября он падает по истёкшей evidence. Production registry, evidence/capabilities и проверка expiry не изменены/не отключены.

Штатная загрузка Playwright Chromium в этой среде вернула повреждённый архив. UI реально выполнен на Chromium153.0.8010.0 из отдельного npm test-tool пакета вне репозитория; никаких новых product dependencies. Test config поддерживает optional `KOSMORA_TEST_CHROMIUM_EXECUTABLE`; без него использует обычный установленный Playwright Chromium. Browser fixture регистрирует настоящие Issues routes и GitHub HTTP transport; сам Code POST там намеренно блокируется503 после учёта запроса, чтобы UI тест не запускал модель. Реальную передачу context в существующий gateway/snapshot/proposal проверяют API tests с deterministic provider transport. Это не live проверка GitHub issue permissions или платной модели.

```bash
NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1   pnpm --filter @cosmora/api exec vitest run test/github-issues.test.ts test/github-integration.test.ts test/code-agent.test.ts
NEXT_TELEMETRY_DISABLED=1   pnpm --filter @cosmora/web exec vitest run src/app/code-agent
NEXT_TELEMETRY_DISABLED=1   pnpm --filter @cosmora/web exec playwright test --config=playwright.github-issues.config.ts
# При собственном Chromium добавить KOSMORA_TEST_CHROMIUM_EXECUTABLE=/absolute/path.
```

Один ранний общий typecheck/lint был остановлен автоматической проверкой среды из-за возможной telemetry; повтор с `NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1` завершился успешно. Внешних approval блокеров не осталось.

## Главному интегратору

Перенести feature, пять local integration hunks и отдельный app.ts wiring, затем запустить приведённые проверки. В своей согласованной среде проверить доступность Issues текущего подключения и обычную owner сессию. Если token не даёт Issues read, оставить честный отказ; этот пакет не расширяет доступ и не требует ключей. Никаких VPS действий, paid AI requests, закрытия issues/комментариев, GitHub writes/PR/merge не выполнялось. Существующий Code executor и публикация продолжают требовать своих прежних подтверждений.
