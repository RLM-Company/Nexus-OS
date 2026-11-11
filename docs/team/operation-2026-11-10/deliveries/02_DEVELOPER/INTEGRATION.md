# Интеграция Coscode: доказательства проверок

Статус первого среза: готово к интеграции. Integration commit
`fcc183d18e9e465e10cbf663636fefa0139028b0`; source
`89ec737afdb35d4446193f51604baefe6388c885`. Проверки см. DELIVERY.

Единственный общий файл — `.github/workflows/ci.yml`: в существующем job
Code sandbox isolation к прежним четырём OCI-тестам добавлен
`test/code-agent-git.oci.test.ts`, тот же image provisioning и `--maxWorkers=1`.
Отдельный integration commit; не менять его на host execution или снятие изоляции.

Contracts/DB/migrations/app registration/gateway/auth/work runtime не меняются.
`validateCodeAgentCheckResult` и `isVerifiedCodeAgentCheck` экспортируются существующим
`export *` code-agent-workspace, без нового API контракта. Код service проверяет
не только новые ответы, но и старые rows перед reuse/publish. Старый `passed`
без exitCode=0/cleanupVerified=true требует новой проверки; это намеренный отказ,
а не миграция или автоматический повтор side effect.

Применить source и integration вместе. Откат — revert integration, затем source;
сохранённые runs/checks/чужие репозитории не удалять. Live publish в целевой репозиторий
по-прежнему требует отдельного разрешения. Сама интеграция его не предоставляет.

## Последующие UI срезы и main

Source5a5e2e4 и30e1944 меняют только Coscode UI/scoped E2E. Дополнительных
общих contracts/регистрации/DB нет. Новый mainf9da6e8 принят в feature-ветку
merge589eb311 после обзора manager-work-store / cloud snapshot acceptance:
требование целостности полного набора checkpoint/artifacts сохранено, legacy
не расширен. Чужие Games/desktop/reports в этом merge не редактировались.
Итоговый tree870f2aaeb5c7c882e2b919ac5a767c0a7afe6963.

## Контекст большого репозитория, 11 ноября

Main5e01c4f принят merge2bbb4aa. Source d467fdb + fixture0591ed1 меняют только
code-agent/API tests, code-agent-diff/runtime tests и локальные сообщения Coscode.
Общий GitHub client (включая response limit8MB), contracts/DB/registration/navigation
не менялись. ПутьTREE_LIMIT для truncated tree сохранён. Новых полномочий нет.

## Поиск путей, 11 ноября

Source4eb1b83: только Code service/helper/scoped tests. search_files — definition
в прежнем gateway-negotiated tools array и обработчик в прежнем6-turn cycle;
не новый public API/tool-runtime registry. Tools-free route не получает definition.
Metadata read использует уже разрешённый immutable index; policy/owner/project
fences, лимиты и budget не расширены. Общие файлы не менялись. Main4b74f26
(канонические отчёты) сохранён mergeb457cf9 без авторских правок.
