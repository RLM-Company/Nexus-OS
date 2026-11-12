# Coscode: продолжение после живой GitHub/OCI приёмки

12 ноября2026, Москва. User разрешил интеграцию/live model/test PR/release verification,
позднее попросил работать с текущими правами. Не спрашивать то же разрешение снова.
BASE ea2f4aafe8e9609b678f8743a08c43d43f911f9f; branch ops/developer-coscode-live-2026-11-12.

1. PR519 уже merged c702c0f, delivery c36bee4 — ancestor main. Relevant Code/common
   entrypoints/registry не изменились после merge. Main CI43192292131 все3jobs success.
2. CreateRepository denied. После steering создан isolated branch workspace в Nexus,
   base ops/coscode-live-base-2026-11-12 SHAe03ba58f95189e72d8da5658808f1e845250e128.
   Через нынешний Code API+real HTTP executor+OCI+GitHubIntegration создан Draft PR542,
   head a58b7314c967d33331dfd48b337d8f88f3cca5ab. Два synthetic files, README/00123
   сохранены. Failed1→manual review→passed0 cleanup true; stale-check409; replay publish409
   без новыхPOST, command replayEEXIST до network. GitHub POST4, PR1, main unchanged.
3. Full release acceptance НЕ подтверждена: real model/HY4 не вызывалась, adapters0.
   MODEL_API_KEY/BASE_URL/NAME отсутствуют; URL настроенного стенда не получен.
   Не превращать доказанный GitHub/OCI/manual-diff case в утверждение об AI-autonomy.

Новый CLI apps/api/test/code-agent-live-github.acceptance.ts opt-in: требует точный
repository:base, GH auth, pinned OCI image, fresh report directory. На uncertain
записи НЕ перезапускать publisher: persistent synthetic DB в /tmp/coscode-github-live-2026-11-12,
сначала existing read/reconcile. DB/секреты не включать в артефакты. Test PR542 и base
не объединять в main, это synthetic root tree. Target/API scopes не расширялись.

Новые lint/types/build0, scoped117+1skip, real live0, guard expected1. First dependency
state errors сохранились; native tools выполнили реальные проверки после fix.
Команды/outputs/receipt/check hashes в LIVE_ACCEPTANCE_2026-11-12_RU.md и fixtures/live-2026-11-12.
Runtime/app/contracts/DB/grants/provider/quotas не менялись. Production/tag/deploy нет.

Продолжить с real-model acceptance только когда существующее подключение HY4 доступно.
Нужен доступ к настроенному стенду или защищённые runtime bindings; ключи в чат не
запрашивать, .env/owner DB не читать. Техническая конфигурация — единственная причина
не выполнить модельный этап, а не отсутствие пользовательского разрешения.
