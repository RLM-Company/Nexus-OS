# Coscode: итоговая программная приёмка по ТЗ владельца

13 ноября2026,02_DEVELOPER. Статус: в работе; независимый real API/OCI CI ещё обязателен.
BASE_SHA `798a3079dde9ab70aee7d8b7702af2a18c8c60a9` (предыдущий зелёный CI43459723060), main `43ffee1db331507dfd984f50f42a2f6779e6e780` сохранён.
Ветка ops/developer-coscode-snapshot-order-2026-11-13, [Draft PR581](https://github.com/RLM-Company/Nexus-OS/pull/581).
Source API acceptance commits85183fa30a3bc1eebbade307dc6b271283e31aae и `5ef2f7a7a9b8d254b61a71cf845c35f15a297cd9`;
отдельный integration commit `5f1ed5908596e4fe6594aeab26fbb0ba5dbe19ca`. Source tree894e3efb02951134bfba55f98a0f5cb7b233acaa.
Финальный HEAD с документами будет записан в PR/итоговом receipt: hash не записывается сам в себя.
Семь UI source blobs побайтово совпадают с BASE_SHA; matrix provenance в fixtures.

## Итог первичного обзора

В репозитории уже есть действующие CodeAgent service/store/routes, GitHub adapter,
exact diff engine, immutable snapshot и ограниченный HTTP/OCI executor. Новый
runtime, executor, storage или чат не нужны. Весь пользовательский путь подключён:
/code-agent → существующие project/Code routes → gateway/context/proposal → review →
check/repair → confirmed Draft PR. Последние data-loss исправления входят в BASE_SHA.

Найден пробел непрерывной поставки: обычный API gate пропускал существующий opt-in
real OCI API case; OCI job запускал только runtime/Git tests. Кроме того, API case
заканчивался после fresh review. Он расширен до подтверждённой публикации через
fixture GitHub adapter и отказа повторному publish, теперь проходит существующий
аутентифицированный HTTP executor. CI запускает его на своём pinned image,
требует receipt и сохраняет настоящие inputs/output/diff. Production поведение не дублируется.

## Матрица исходного поручения

| Критерий                                          | Реальный entrypoint/механизм                                                                                               | Проверяемое доказательство                                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Выбранный repo/task/issue и план правок           | Code page/GithubIssuesPicker → routes → CodeAgentService.create/request → immutable context и durable proposal/review plan | code-agent.test: issue literal/context binding, source read, approved selection; свежий scoped API/adapters151PASS                                       |
| Большой repo, выборочное чтение, поиск            | immutable tree/index, negotiated search_files/read_file; base SHA и snapshot digest                                        | bounded path search, truncated tree recovery/refusal, unread source refusal tests входят в151PASS                                                        |
| Secrets и недоверенные данные                     | existing source path/content guards до model/store, owner/project scope                                                    | credential paths/embedded token/legacy feedback и foreign scope tests проходят; настоящие секреты не использованы                                        |
| Точный patch/preview/принятие и отклонение файлов | exact edits/unified diff → preview → выбранные files → review hash; невыбранное не публикуется                             | real diff engine + API selection and stale snapshot tests;76 runtime unitPASS,16 web unitPASS                                                            |
| Изменившийся исходник                             | source base/snapshot, expected parent review/version, durable CAS                                                          | stale editor/repair check/base conflict; старые approval не действуют                                                                                    |
| Реальное изолированное выполнение                 | existing authenticated HTTP client/server → existing OCI runner, только syntax/node-test                                   | runtime/Git OCI5 и полный API OCI1 обязательны в новом CI; локальный real OCI здесь НЕ прошёл из-за ENOSPC                                               |
| Error/stdout/stderr/exit/cleanup                  | validated check result, snapshotDigest/cleanupVerified, unknown/unavailable не являются успехом                            | реальный CI receipt обязан содержать failed1 → passed0; contradictory evidence/late result/cleanup refusal tests входят в151PASS                         |
| Ограниченное исправление                          | repair-v2 с capability/consent/source run version и canonical feedback                                                     | API real OCI case: fixture repair1, два сохранённых файла/00123, fresh review; unit/source repair fences входят в151PASS                                 |
| Отмена/отзыв/timeout                              | existing policy/owner guards, AbortSignal и bounded execution; side-effect uncertainty не повторяется                      | API cancel/revoke/privacy/late proof tests; real Git OCI cancel и descendant-timeout tests в CI                                                          |
| Checkpoint и возобновление                        | existing SQLite store/version/hash/request ID, persisted review и explicit reconciliation                                  | file-backed repaired checkpoint, lost response recovery, partial streamed draft tests входят в151PASS; UI reload paths ранее41PASS на тех же blobs       |
| Branch/commit/Draft PR                            | existing GithubIntegration → tree/commit/ref/PR после explicit confirmation; чужие files сохраняются через base_tree       | extended real Git/API case проверяет4 fixture POST, draft:true, source base tree, repeat409 и0 новых writes; adapter lost-response tests входят в151PASS |
| Проверяемый результат без переноса из ответа      | Code page review/check/proof/PR state, действующие save/check/publish endpoints                                            | Git index readback/README preservation и CI receipt, а не слова model; source и artifact привязаны к SHA                                                 |

План здесь — сохраняемый proposal/review с summary, source version и выбранными
изменениями. Не заявляется новая независимая многоагентная система планирования.
Возобновляются сохранённые состояния и явные действия; прерванная генерация не
перезапускается автоматически под видом безопасного продолжения.

## Свежие команды и результаты

Из checkout с существующими dependencies:

```bash
env -u CODE_AGENT_TEST_IMAGE pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts test/code-agent-github-tree.test.ts test/github-integration.test.ts test/github-issues.test.ts --maxWorkers=1
env -u CODE_AGENT_TEST_IMAGE pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/tool-runtime exec vitest run test/code-agent-workspace.test.ts test/code-agent-diff.test.ts test/code-agent-result.test.ts test/code-agent-sidecar.test.ts --maxWorkers=1
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/web exec vitest run src/app/code-agent/ --maxWorkers=1
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/api exec tsc -p tsconfig.json --noEmit --incremental false
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/api lint
```

Факт: API/adapters151PASS+1real OCI skip, runtime76PASS, web16PASS, types/lint exit0.
Локальный real API OCI: FAIL/unavailable, exit1, cleanupVerified true до исполнения.
Probe подтвердил Docker VFS ENOSPC. Другой диагностический launcher из tool-runtime
не нашёл tsx; применён существующий API launcher, packages не устанавливались.
После удаления только своих .next и игнорируемых dist source maps ENOSPC повторился;
локальный OCI не запускался бесконечно, выбран независимый существующий CI стенд.
Docker daemon/storage/driver/чужие outputs не менялись. Строгие assertions не ослаблялись.
Локальная сборка после удаления .next не повторялась: её обязан проверить финальный CI.

CI OCI job использует существующую provision/warm-up/pinned image последовательность,
без host-shell исполнения repo, network:none/read-only/non-root/cap-drop прежние.
Команды actual acceptance:

```bash
CODE_AGENT_GIT_REPORT_DIR=<new-report-dir> pnpm --filter @cosmora/tool-runtime exec vitest run test/code-agent-workspace.oci.test.ts test/code-agent-git.oci.test.ts --maxWorkers=1
CODE_AGENT_REPAIR_REPORT_DIR=<new-report-dir> pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts -t 'real OCI API repair' --maxWorkers=1
```

Нужны provisioned immutable CODE_AGENT_TEST_IMAGE и существующий Docker/Podman стенд;
для API case Docker. На локальном cloud executable/usr/local/bin/docker задаётся
уже существующим CODE_AGENT_TEST_EXECUTABLE. Отчёты создаются fresh и не перезаписываются.
Artifact `coscode-final-workflow-proof` содержит два настоящих Git/API input/output/diff
набора. Отсутствие API receipt ломает CI, skipped opt-in не считается выполненным.
[Логи, source patch и provenance](fixtures/coscode-final-acceptance-2026-11-13/README.md).

## Реальная модель, историческая внешняя приёмка и границы

Модель/GitHub в свежем программном сценарии — fixtures; Git/HTTP/Node/SQLite/OCI
в итоговом CI должны быть настоящими. Статус published в fixture receipt не означает
новую публикацию на GitHub: поле adapter_fixture явно true, github_published false.
Предыдущий live GitHub/HTTP/OCI сценарий был12 ноября, Draft PR542 на отдельную
синтетическую base branch: [исторический отчёт](LIVE_ACCEPTANCE_2026-11-12_RU.md).
Он не повторялся ради свежих цифр и не выдаётся за CI нового HEAD.

Настоящая модель/HY4 остаётся не проверена после решения владельца подключить API
позднее. Это граница боевой приёмки, не разрешение тратить API или менять провайдера.
Новых key/provider/tariff/quota/grants нет; реальные .env/owner files/DB не читались.
Текущий executor поддерживает Node syntax/node-test; произвольные shell commands
не добавлялись. Exact patch ограничен существующим UTF-8 контрактом, бинарные
операции/rename/delete не выдаются за поддержанные. Unsaved editor — память view,
долговременный checkpoint создаётся существующим explicit review; crash-proof autosave
не добавлялся. Multi-Agent/Jarvis/cloud PC/owner Windows/VPS сюда не входят.

## Передача и откат

На момент freeze документа новый exact HEAD CI ожидается. Его итог и artifact URL
записываются в описание PR581/финальную передачу без нового docs push.
После проверки artifact и зелёного CI программный блок может быть передан как
«готово к интеграции»; интеграция/release требуют независимого подтверждения Codex.
Самостоятельные merge в main/deploy не выполнялись. Предыдущие программные
hardening commits и обе истории отчётов сохранены.
Откат этого audit slice: revert только API acceptance extensions и CI integration,
не удаляя предыдущие product fixes и main43. Миграций/новых dependencies нет.
