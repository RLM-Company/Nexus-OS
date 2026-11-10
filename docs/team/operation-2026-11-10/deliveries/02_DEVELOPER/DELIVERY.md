# 02_DEVELOPER: Coscode — доказательства проверок и отмена OCI

Исполнитель: Разработчик + GPT Plus. 10 ноября 2026, Москва.
Статус первого среза: **готово к интеграции**; полная сфера не завершена.

- BASE_SHA: `f9eb45285f3473bfd3fe9a73939c1903dc696b3b`.
- Контрольная база `9d972e8ba447f681fbfb49253b73d9f02dd1d325` — предок main.
- HEAD_SHA проверяемого кода: `fcc183d18e9e465e10cbf663636fefa0139028b0`.
- Source: `89ec737afdb35d4446193f51604baefe6388c885`.
- Code tree: `223721a5282c57b9ed65cc6e64bafed89a502fba`.
- Branch: `ops/developer-coscode`. [PR #507](https://github.com/RLM-Company/Nexus-OS/pull/507).
- Итоговый docs/artifacts head указывается в PR и финальной передаче: report commit
  следует за указанным HEAD_SHA кода и не меняет реализацию.

## До и после / действующий entrypoint

`/code-agent` → выбранный проект/task/issue → существующие code-agent routes/service,
store и GithubIntegration → proposal/patch editor → review → текущий HTTP/OCI runner →
сохранённый check → отдельное подтверждение Draft PR. Второго runtime/store нет.

До: `passed` от executor с exitCode=1/null мог получить publication_token;
HTTP проверял digest/cleanup, но недостаточно проверял согласованность результата.
Journal не проверялся/не редактировался так же, как stdout/stderr. UI скрывал exit
и мог разрешить публикацию старого противоречивого proof.

Теперь проверяется полный результат на HTTP/sidecar/service границах. Успех требует
status passed + exitCode 0 + cleanupVerified true + точного snapshot. Невалидный
результат отклоняется; новой успешной проверки и publication_token нет. Journal
ограничен по длине/структуре/событиям/timestamps, redaction применяется к каждому
каналу; лишние response fields не сохраняются. Truncated вывод отмечается отдельно,
он не заменяет exit status. Старые durable rows перепроверяются до reuse/publish;
UI показывает код завершения/cleanup и явно блокирует неподтверждённый успех.
Никаких миграций/автоматических повторов модели или публикации для старых rows.

Настоящий Git/OCI-прогон обнаружил гонку отмены: CLI убивали до ответа daemon create,
поэтому созданный позднее loader мог остаться. Теперь уже отправленный create
ожидается до acknowledgement (не более 8 секунд), stopped запрещает следующий start.
Затем повторяются только ограниченные cleanup/probes по собственным labels.
Отсутствие acknowledgement или подтверждённой очистки — unavailable/quarantine,
даже если ранний probe не видел контейнера. Cleanup backoff использует реальный
таймер отдельно от deadline/fake clock. Новые create/start не повторяются.
Read-only snapshot, non-root, network none, pids/memory/cpu limits не ослаблены.

## Изменённые файлы

- `packages/tool-runtime/src/code-agent-result.ts`: единая валидация/canonical result,
  redaction и predicate для persisted rows.
- `code-agent-http-client.ts`, `code-agent-sidecar.ts`: применяют validator;
  `code-agent-workspace.ts`: export и bounded acknowledgement/cleanup отмены.
- Scoped runtime tests: result, sidecar, workspace и новый Git/OCI scenario.
- `apps/api/src/code-agent/service.ts`, `apps/api/test/code-agent.test.ts`:
  check/proposal-check/reuse/publish, отказ новых и старых недостоверных proofs.
- `apps/web/src/app/code-agent/check-evidence.tsx`, его test и `page.tsx`:
  exit/cleanup/unknown и publication eligibility в прежнем разделе.
- `apps/web/e2e/code-agent.spec.ts`: прежний adapter/UI путь + три legacy отказа.
- Общая интеграция отдельным commit: одна строка `.github/workflows/ci.yml`;
  см. [INTEGRATION.md](INTEGRATION.md).
- Только собственные BACKLOG/CHECKPOINT/DELIVERY/INTEGRATION/fixtures.
  Общая доска, Office, browser/CDP, work runtime, shell/sidebar/styles не менялись.

## Настоящий временный Git и точные выходы

[fixtures/check-evidence](fixtures/check-evidence/) содержит input/output JSON,
changes.patch и receipt настоящего runner (не слова модели).
Source Git commit `7f0afdceca1b063c238a2b792d1633a47d63f9e9` создан в отдельном tmp repo.
Два изменённых файла: `src/sum.mjs` и `src/sum.test.mjs`; README побайтно сохранён.
Git apply --check, Git index readback и список изменённых файлов проверены.
Патч к изменившемуся snapshot получает PATCH_SNAPSHOT, без записи.

- Исходный реальный Node test: failed / exit 1 / cleanup true.
- Исправленный immutable snapshot: passed / exit 0 / cleanup true.
- Отмена на setup boundary: cancelled / exit 0 CLI / cleanup true; отменённый
  CLI exit 0 не выдаётся за выполненную пользовательскую проверку.
- Node image: `sha256:280af3207172947339cc2e8c9d2efac585716fd906af49f57d6fdf0dbb829a73`.
  Registry: `node@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9`,
  официальный Node 24-bookworm-slim, внутри v24.22.2. Это существующий CI image family,
  runtime сам не pull/install. Сторонний source код не переносился.
- Модель не вызывалась; GitHub live publish отсутствовал.

## Фактические проверки и сохранённые неудачи

- Финальный scoped runtime: **61 PASS**, `/tmp/coscode-runtime-verified.log`.
- API code-agent: **57 PASS**, `/tmp/coscode-api-first.log` (real gateway/policy/store,
  provider/GitHub/часть runner — явные transport fixtures, не live модель/публикация).
- Production browser Coscode: **9 PASS**, workers=1/retries=0,
  `/tmp/coscode-browser.log`. API/GitHub ответы этого UI набора — adapter fixtures.
- Первый полный core gate: exit 0, `/tmp/coscode-core-first.log`, до последних уточнений.
- Frozen gate: **exit 0**, `/tmp/coscode-core-frozen.log`. Свежие API **986 PASS**,
  web **290 PASS**, runtime **71 PASS / 5 opt-in OCI SKIP**. Config17/contracts206/
  policy43/gateway151/core387/DB194 — Turbo cache replay, не свежие прогоны.
  Format/secrets/lint/types/build/root guards/vector-scale/privacy/profile PASS.
- Внешний [CI #1753](https://github.com/RLM-Company/Nexus-OS/actions/runs/42878177273)
  для code head `fcc183d18e9e465e10cbf663636fefa0139028b0`: отдельный настоящий
  OCI job **5/5 PASS**, включая новый Git case (2.3 s). Это отдельный стенд;
  он не подменяет локальный failure ниже. Остальные внешние jobs и итоговый
  docs head receipts фиксируются в PR, не выдаются за уже завершённые здесь.
- Последний локальный opt-in OCI набор: **4 PASS / 1 FAIL**,
  `/tmp/coscode-oci-confirmed.log`. Новый temporary-Git scenario PASS; один прежний
  5s тест достиг deadline ещё на setup, получил timed_out/cleanup true.
  Это не объявляется успешным локальным запуском всех пяти OCI-тестов.

Неудачи не удалены: первый OCI run имел 1 failure (неподтверждённая очистка отмены),
следующий — 2 legacy timeout, serial — 4 timeout, warm-up run — снова cleanup
race; после acknowledgement fix новый Git scenario прошёл. Все эти логи в fixtures.
Transport regression run имел 3 timeout из-за fake-clock backoff; после отдельного
cleanup timer scoped набор прошёл. Один lint no-unnecessary-type-assertion исправлен.

Подготовка нового worktree: offline pnpm сначала отказал из-за недоступного default
home, затем из-за отсутствия metadata mirror. Уже установленные pinned packages
подключены локально, workspace ссылки ведут в этот checkout; install scripts не
запускались. Pnpm startup auto-install отключён только для команд стенда, не проверки
приложения. Два прямых web-build не прошли: внешние symlinks Turbopack и ещё не
собранные workspace dist; исправлены локальные ссылки, штатная сборка выполняется
через корневой graph. Логи этих отказов тоже сохранены.

```sh
pnpm --filter @cosmora/tool-runtime exec vitest run test/code-agent-result.test.ts test/code-agent-sidecar.test.ts test/code-agent-workspace.test.ts test/code-agent-diff.test.ts
pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts
# После provision Node OCI image и warm-up, как в существующем CI job:
CODE_AGENT_TEST_IMAGE=<immutable-local-image-id> \
  pnpm --filter @cosmora/tool-runtime exec vitest run --maxWorkers=1 test/code-agent-workspace.oci.test.ts test/code-agent-git.oci.test.ts
# Новый каталог capture обязателен: wx не затирает прежние доказательства.
CODE_AGENT_TEST_IMAGE=<immutable-local-image-id> CODE_AGENT_GIT_REPORT_DIR=/tmp/coscode-new-proof \
  pnpm --filter @cosmora/tool-runtime exec vitest run test/code-agent-git.oci.test.ts
pnpm check:core
KOSMORA_E2E_PRODUCTION=1 KOSMORA_E2E_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  pnpm --filter @cosmora/web exec playwright test -c playwright.acceptance.config.ts e2e/code-agent.spec.ts
git diff --check
```

На этом заранее подготовленном offline стенде к pnpm-командам применялся
`pnpm_config_verify_deps_before_run=''` либо `--config.verify-deps-before-run=false`,
чтобы CLI не запускал повторную установку. Исходные тесты/types/lint/build/gates
не отключались. OCI и browser не запускать одновременно с Next build/core.

## Полномочия, ограничения и следующий шаг

Реальной модели, платного API и live push/PR в целевой чужой репозиторий не было.
GitHub публикация проверяется fixtures/adapter; собственный PR #507 опубликован
по поручению владельца. Owner/project/capability/budget/privacy fences сохранены.
Новых migrations/dependencies/contracts и изменения тарифов/ключей нет.
Merge/deploy/ПК владельца/VPS не выполнялись. Внешние CI результаты фиксируются
отдельно в PR для его точного head. Только Codex подтверждает дальнейшие статусы.

Следующий срез: проверить потерю несохранённых edits и stale async response при
смене задачи/reload patch editor; использовать текущий checkpoint/store. Контекст
больших repo и bounded repair остаются в очереди BACKLOG. Полная автономность Coscode
этим срезом не объявляется завершённой. Откат — в INTEGRATION; durable runs и чужие
файлы откат не удаляет.
