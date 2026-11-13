# Исправление повторного открытия завершённого запуска, 13 ноября 2026

Статус текущего среза: **готово к интеграции**, новый HEAD CI проверяется отдельно. Самостоятельных merge/deploy нет.
BASE_SHA `7c2abadfe7d0e42ee9b72bc77608290584023996` (актуальный main).
Ветка `ops/developer-postmerge-acceptance-2026-11-13`; [Draft PR этой ветки](https://github.com/RLM-Company/Nexus-OS/pulls?q=is%3Apr+head%3Aops%2Fdeveloper-postmerge-acceptance-2026-11-13).
SOURCE_HEAD `04c4b2eb03dc0fa8541041d593352ad9ce84a8f6`, source tree
`78443d831e1c9ca3c7d0fa879039e751776dee15`. Финальный HEAD — в PR/history.
Локальные проверенные source commits: `1219a48b43d3a3d2d352514fb7bc5c2e027f727f`
и `3b27dbda129db0655970ace0e511bf79d7699c15`. Публикация через GitHub adapter:
`3a08c3f8ff026a308c2d30335219c37cdfd5cf83` и `04c4b2e...`; оба дерева
сверены с локальными. Коммиты различаются метаданными автора/времени.

## Что обнаружено и изменено

Предыдущие #549/#551/#558 включены другим интегратором RLM-Company через
[PR563](https://github.com/RLM-Company/Nexus-OS/pull/563). Main CI43393188091
SUCCESS (495 основных браузерных сценариев). В этом сеансе main не обновлялся.
Собственный объединённый кандидат не публиковался поверх закрытых PR.

Trace предшествующего failed CI43389934875, artifact14020214341, содержит
повторные `run.cancelled` для одного ID, а GET истории возвращает только user.
`restoredRunState` ошибочно выводил queued, снова открывался EventSource,
повторялся terminal → refresh → queued. Поле постоянно меняло disabled.
Trace **не доказывает**, что React принял текст, а затем стёр его; причина самой
отмены также не установлена. Исторический отказ «Ошибка запуска» от 12 ноября
остаётся отдельным наблюдением с отсутствующим trace.

Теперь существующие observers сохраняют последнее авторитетное terminal-событие
в одном ограниченном ref; успешный ответ cancel API также учитывается. Текущий
history loader применяет его только к совпадающему последнему run ID. Завершённый
запуск не воскресает из запаздывающей истории; другой run ID нормально восстанавливается.
Ref не записывается на диск. После reload статус один раз заново читается из
существующего SSE endpoint. Повторной отправки/исполнения запроса нет.

Entrypoint: открытие чата/проекта → существующий loader → существующий SSE observer
→ terminal-событие/cancel acknowledgement → refresh истории → доступный composer.
Текст, вложение и черновик после reload проверены в настоящем Chromium.
Дизайн, API/contracts/DB, исполнитель, grants, провайдер и квоты не менялись.

## Файлы и интеграция

- `apps/web/src/app/restored-run-state.ts`: прежний resolver, вынесенный из page,
  с приоритетом подтверждённого terminal для того же ID.
- `apps/web/src/app/restored-run-state.test.ts`: семь tests, в том числе stale
  pending/streaming и независимость нового run.
- `apps/web/e2e/terminal-run-recovery.spec.ts`: три регрессии completed/failed/cancelled,
  один observer вместо loop, текст/вложение/reload.
- Отдельный integration commit: `apps/web/src/app/page.tsx` и
  `apps/web/tsconfig.composer-e2e.json`; минимальные подключения, без форматирования page.
- Этот отчёт, BACKLOG/CHECKPOINT/DELIVERY/INTEGRATION и fixtures в своём каталоге.

## Воспроизведение и фактические результаты

Окружение: Node24.22.1, pnpm11.25.0, Next16.3.1, Chromium `/usr/bin/chromium`.
Зависимости взяты из lockfile с `--frozen-lockfile --ignore-scripts`;
lock/dependencies не менялись. pnpm CI использует репозиторную закреплённую версию.

```sh
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/web exec vitest run src/app/restored-run-state.test.ts
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/web typecheck
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/web lint
KOSMORA_E2E_PRODUCTION=1 pnpm --filter @cosmora/web exec playwright test terminal-run-recovery.spec.ts chat-reliability.spec.ts composer-draft-races.spec.ts code-agent.spec.ts pwa.spec.ts --workers=1 --retries=0
pnpm_config_verify_deps_before_run='' pnpm check:core
```

В managed environment использован внешний `/tmp/nexus-postmerge-browser.config.ts`:
наследует tracked playwright.config, указывает абсолютный testDir/cwd/outputDir,
`launchOptions.executablePath=/usr/bin/chromium`, retries0; production build/start
и API fixture остаются штатными. Системная browser policy не ослаблялась.

- Первый запуск новой E2E имел ошибочное ожидание HTTP202 вместо контракта201:
  3FAIL, это ошибка подготовки теста, не baseline продукта.
- После исправления предусловия **на старом продукте**: 3FAIL — вместо1 observer
  получено12/15/17. Лог сохранён; этот отказ не объявлен прошедшим.
- Первая unit fixture содержала пропущенную скобку: transformFAIL, исправлена;
  затем **7PASS**.
- Новый production Chromium: **69PASS**, retries0/workers1, включая3 регрессии.
- Scoped typecheck/lint/format: exit0. Финальный diff-check сначала отклонил
  пробелы в захваченных логах; ANSI/концевые пробелы нормализованы, исходные
  SHA256 сохранены в log-normalization.json; повторный diff-check exit0.
- Полный `pnpm check:core`: **exit0**; API1077PASS+1opt-inSKIP, web385PASS,
  core425PASS/DB223PASS (эти workspace результаты из cache); format/secrets,
  monorepo types/lint/tests/build/deploy-fixtures/privacy/profile gates прошли.
  Tool-runtime86PASS+5opt-inSKIP; пропуски не объявлены выполненными.

Входные сообщения/terminal stream и проверки находятся в исполнимой E2E fixture;
используется настоящий Next/browser/storage, HTTP history и SSE заменены фикстурой.
Настоящая модель не вызывалась. Оригинальный ZIP не вложен в репозиторий: в
`original-trace-findings.json` сохранены необходимые role/status/timing и SHA256
artifact. Полные source snapshots и временные signed URLs не публикуются.

Дополнительная приёмка фактического BASE main: существующий API → настоящий
временный Git → Docker OCI → fixture repair → повторный node-test: **1PASS**,
105 unrelated filtered; failed exit1 → passed exit0, cleanupVerified true,
README/00123 сохранены. Image ID
`sha256:5ba3c1ded6eada2ea16582327a87c672fb3889fca362ee3ac0d78ed742b583c0`,
container Node24.22.3. Модель/GitHub fixtures, live publish нет. Поле base_sha в
`api-oci-base-main/receipt.json` относится к временному fixture Git, не Nexus-OS.
Этот OCI receipt относится к BASE7c2, не выдаётся за новый HEAD CI.

Команда отдельного OCI сценария на разрешённом Docker-стенде:

```sh
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH CODE_AGENT_TEST_IMAGE=sha256:5ba3c1ded6eada2ea16582327a87c672fb3889fca362ee3ac0d78ed742b583c0 CODE_AGENT_TEST_EXECUTABLE=/usr/local/bin/docker CODE_AGENT_REPAIR_REPORT_DIR=/tmp/nexus-postmerge-real-oci-2026-11-13 pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts -t 'real OCI API repair' --maxWorkers=1
```

## Границы и откат

Новый HEAD CI проверяется отдельно; зелёный main не заменяет его. Ввод во время
действительно активного запуска остаётся отключён прежним правилом. Запоминается
только последнее наблюдение в текущем mount; на reload допускается один read-only
SSE observer для восстановления server status. Нет нового долговременного статуса,
автоматического resend, shell/runtime, сети в OCI или новых полномочий.
Live ИИ API, owner Windows/VPS и foreign GitHub publish отложены/не выполнялись.

Миграций, новых зависимостей и несовместимых контрактов нет. Для интеграции нужны
оба source commit: helper/tests и отдельное подключение page/tsconfig. Откат:
revert integration commit, затем helper commit (обычным новым commit, без reset main).
Данные пользователя не мигрируются и не удаляются. Далее: точный HEAD CI и ревью;
последующие merge/deploy выполняет уполномоченный интегратор.
