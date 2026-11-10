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
