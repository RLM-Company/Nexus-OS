# Coscode: программная приёмка со свежим main

12 ноября 2026, ID 02_DEVELOPER. **Готово к интеграции**, Draft
[PR551](https://github.com/RLM-Company/Nexus-OS/pull/551).
Ветка `ops/developer-coscode-context-secrets-2026-11-12`.
PREVIOUS_HEAD_SHA `c9625d600e4c97a5bb93df8cbed62b0ba5154d54`.
CURRENT_MAIN_SHA `1c07f8dc291b38d0faf92088c53e704e348d0256`.
TESTED_MERGE_SHA `c3cef4bb79d1e14b4d61979a7010dcc830e94353`.
TESTED_TREE `b455ff73906f2b0a6bc3183deef546ae38a78459`.
Локальный merge0e259e3 и GitHub candidate имеют одинаковое дерево. SHA с финальным
отчётом — в истории PR. Это merge **в свою рабочую ветку**, не в main и не deploy.

## Что сделано в этом продолжении

Закрыта оставшаяся проверка совместимости с actual main после PR538/552/553/554/555/539.
Прочитаны изменения общих contracts/core: scope в ChatSkillSnapshot optional,
новые типы/экспорты и разрешение Skills в ChatService. ManagerService, CodeAgent
request/executor contracts и scoped source paths не менялись. Main сохранён без
конфликтов и без ручного переписывания чужих файлов/выбора ours. Windows/Skills
изменения принадлежат их исходным commits. Затем проверено **объединённое дерево**,
а не только прежний source на старой базе. Нового runtime или нового продукта нет.

## Реально используемый модуль

| Пользовательский сценарий                                       | Действующий путь и результат                                                                                                      | Доказательство                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Выбрать repo/task/issue/context                                 | /code-agent → текущие routes/service → immutable tree/blob; owner/project/base bound                                              | scoped API/tree/GitHub suite                                            |
| Предложить и просмотреть точный patch                           | negotiated tools либо текстовые exact edits → existing diff engine → durable proposal                                             | scoped API + input tests                                                |
| Сохранить review и восстановить задачу                          | текущий store/CAS/version/hash, явный discard, поздние ответы не меняют другую задачу                                             | существующие scoped API/web lifecycle tests                             |
| Проверить исправление                                           | текущий executor; status/exit/digest/cleanup verified до publication token                                                        | свежий API → реальный OCI, root gates                                   |
| Один repair после failed check                                  | отдельное consent+expected_run_version → canonical feedback → fixture model edit → exact patch → repeat same check → fresh review | свежий API/OCI сценарий ниже                                            |
| Отмена/отзыв/повтор/конфликт                                    | existing guarded runtime + owner/project/version fences; неизвестный эффект не повторяется                                        | scoped API/GitHub tests                                                 |
| Блокировать распознаваемые credentials в source/legacy feedback | guard внутри blob read до durable result; reuse canonical redactor до excerpt/new checkpoint                                      | исходные baseline и исправленные regression tests в предыдущих handoffs |
| Подготовить branch/commit/Draft PR                              | текущий GithubIntegration, exact review/proof и reconciliation                                                                    | adapter tests; прежний live GitHub/OCI без модели отдельно в PR546      |

Каждый пункт подключён к существующему entrypoint. Наличие файла или слов модели
не использовалось как подтверждение исполнения. Ограничения ниже остаются явными.

## Свежая приёмка на настоящем временном Git и OCI

Выполнен существующий opt-in тест `real OCI API repair` на объединённом дереве.
Он действительно создаёт временный Git repo и исходные файлы, вызывает service /
Fastify repair-v2 route, исполняет Node внутри pinned Docker, сохраняет состояние,
применяет полученный diff через git apply --check/--index и читает реальные байты.

Первый запуск дал **FAIL**: check был unavailable/exit=null/cleanup=false до исполнения.
Диагностика: default runner path `/usr/bin/docker` отсутствует на этом облачном
стенде, где установлен `/usr/local/bin/docker`. Использован уже предусмотренный
operator-параметр CODE_AGENT_TEST_EXECUTABLE, без установки/symlink/изменения source,
сети, isolation или тестовых ожиданий. Это не исправление задним числом первого run.

Повтор с правильным executable: **1PASS, 101 filtered/not run**.
Actual receipt: первая проверка failed/exit1/cleanup=true, повтор passed/exit0/
cleanup=true. Base временного Git `4bcdf2f7088ef0265703a40debf589e5cdd735ff`.
Изменены ровно src/add.js и src/add.test.js; README «00123» сохранён; итоговые
байты Git index совпали с proposal. Новое review требует свежего hash/token.

Модель и GitHub — fixtures; Docker/Node/Git/SQLite/patch/readback настоящие.
Четыре model fixture calls включают одну repair генерацию, **реальная модель не вызывалась**.
Foreign push/PR не создавался. Старый тестовый PR542 на synthetic base не merge.

В `fixtures/main-1c07-acceptance-2026-11-12/` приложены реальные input/reviewed/output,
changes.patch, OCI receipt и stdout первого неудачного/исправленного запусков.
Данные тестовые, без .env/реальных ключей/БД/личных файлов владельца.

## Команды и результаты

```sh
pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts test/code-proposal-input.test.ts test/code-agent-github-tree.test.ts test/github-integration.test.ts --maxWorkers=2
pnpm check:core
CODE_AGENT_TEST_IMAGE=sha256:280af3207172947339cc2e8c9d2efac585716fd906af49f57d6fdf0dbb829a73 CODE_AGENT_TEST_EXECUTABLE=/usr/local/bin/docker CODE_AGENT_REPAIR_REPORT_DIR=/tmp/coscode-acceptance-new-output pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts -t 'real OCI API repair' --maxWorkers=1
```

В этой managed-сессии pnpm запускался с `pnpm_config_verify_deps_before_run=''`,
чтобы не было auto-install. Для проверки именно managed daemon убирались только
DOCKER_HOST/CONTEXT/TLS/TLS_VERIFY/CERT_PATH selectors по инструкции среды; Docker
config/registry credentials не читались и не менялись. Образ уже установлен,
runtime использует immutable image ID и pull=never.

- Scoped API/context/tree/GitHub:150PASS+1opt-inSKIP.
- Full check:core на combined tree: **exit0**. API1070PASS+1SKIP, web363PASS,
  core406PASS, DB223PASS; формат/secrets/lint/types/build/privacy/profile passed.
  Неизменённые шаги могли использовать valid cache; полный stdout приложен.
- Opt-in real OCI после конфигурации:1PASS; это отдельный прогон, а не скрытый skip.
- Новый main не добавил конфликтов scoped files. Branch/read grants/quotas/provider/
  capability negotiation и модель полномочий не расширялись.

## CI до и после текущей интеграции

Прежний exact HEADc9625d6 имеет успешный CI43215271862 attempt2 и identity43215271857:
monorepo131263513548, browser131263512222, sandbox131263509426 (5OCI tests passed).
Attempt1 sandbox131172929760 упал с124 на30s provisioning warm-up до тестов. После
диагностики выполнен один targeted retry без изменения исходников/сроков/isolation;
первое падение осталось в GitHub history и явно отмечено в PR. Это **не** CI нового
combined tree с main1c07. Для финального нового HEAD CI проверяется отдельно.

## Границы и дальнейшее действие

Программные сценарии согласованной сферы проверены. Следующее действие — CI точного
финального HEAD этого PR и интеграционное review; не начинать новый блок ради
количества файлов. Реальный ИИ API отложен владельцем; автономная работа с настоящей
моделью и качество её правок не объявлены принятой live-функцией. Live foreign publish
требует отдельного разрешения. Текущие проверки ограничены Node syntax/node-test в
существующем sandbox; произвольный shell/install/build другого стека не добавлялся.
Старые браузеры без cancelable Navigation API сохраняют прежнюю ограниченную защиту
несохранённого raw editor. Detector распознаёт перечисленные credential formats,
не является универсальным DLP. Старые незатронутые rows массово не чистились.
Owner-PC/Windows live acceptance/VPS/production не выполнялись.

Миграций/новых зависимостей/схем/маршрутов/прав нет. Все inherited main changes
перечислены в integration notes. Откат scoped guard/feedback — отдельные revert
commits, без reset main/удаления пользовательских данных/повтора неизвестных эффектов.
