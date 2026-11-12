# Продолжение: Code context credentials, 12 ноября 2026

Владелец отложил подключение ИИ API; продолжаем программные срезы с fixtures.
Ветка `ops/developer-coscode-context-secrets-2026-11-12`, Draft PR551.
BASE_SHA a5f6511875ef7ec116e34dd6c35ff445bdea4313; source HEAD
ab53ef4832d3fe79c7441c015fde100edb93a63d; tree585330c92836da90896085eaaccf13b551470b0e.
GitHub/local source tree equality проверена. Независимо от #549 (не stacked).

Реализован content admission guard внутри текущего protected blob read до policy
result/snapshot/model input. Legacy context/drafts и edited review также gated.
Обычный код не маскируется; UI показывает понятный отказ. Новых общих файлов,
прав, зависимостей, маршрутов, схем/миграций или executor нет.
Scoped API144PASS+1opt-inSKIP, web4PASS, API strict types/scoped lint/secrets passed.
Первый root gate упал на TS optional digest в новой fixture; вычисление digest
исправлено отдельным commit. Повтор check:core exit0: API1059PASS+1SKIP, web361PASS,
build/types/lint/secrets/privacy/profile passed. Статус **готово к интеграции**.
Подробности/команды/ограничения:
[CONTEXT_CREDENTIALS_DELIVERY_RU.md](CONTEXT_CREDENTIALS_DELIVERY_RU.md).

Точка продолжения: проверить CI точного финального HEAD PR551 и свежий main.
Исходник ab53ef4/tree585330c9 полностью локально проверен; docs HEAD — в истории PR.
Логи, baseline/failures, exit codes и SHA256SUMS сохранены в fixtures/context-credentials-2026-11-12/.
Source CI identity/isolation уже success; monorepo/browser на момент записи ещё выполнялись.
Новый docs CI не выдавать за завершённый. Не merge/deploy самостоятельно.
Предыдущий PR549 HEAD0d36f8c имеет полный зелёный CI43208031846 + identity43208031683;
его open/Draft статус не считать интеграцией. Office/Drive527 и Coscode519 уже main.
API модели отложен; synthetic PR542 не merge. Не использовать owner-PC/VPS/.env.
Детектор распознаёт перечисленные форматы, не гарантирует DLP неизвестных/encoded
секретов или task/issue/model output. Существующие legacy rows не удаляются.

Историческая точка продолжения ниже.

---

# Coscode: проверено исправление stale-check approval

11 ноября 2026, Москва. Статус **готово к интеграции**, branch ops/developer-coscode,
Draft PR https://github.com/RLM-Company/Nexus-OS/pull/519. Не merge/deploy/release.
BASE c2e093ee0e79d99f8b4c64b1a646728654196de4 сохраняет main0ddb9d0;
входили только6OpenCode preload/test/report paths, общие API/contracts не менялись.
Source HEAD40a3a9ed5ceaec68c46a8e9e904cb7e08d2e5879,
source treea35aa87ea182cd967e473345c22d3d508b7a51b3, guard9877f5b.
GitHub/local source tree equality проверена. Финальный docs SHA — в PR/history.

## Изменение после дополнительного ревью

Другая вкладка могла обновить check, сохранив review hash. Старое согласие принималось
для новой ошибки; baseline реально упал. Теперь repair-v2 требует expected_run_version,
отказывает STALE_CHECK до записи/модели при mismatch. Source version сохраняется в
прежнем run JSON. Точный повтор UUID+исходной версии идемпотентен, изменённый payload
запрещён. UI repair_once:2, checkbox сбрасывается при новой версии, тип Node check
показан. Существующий load checkpoint требует нового согласия на новую проверку.
Отдельный v2 route не позволяет старому handler проигнорировать version field;
legacy /repair404, missing/invalid version400. API+web поставлять вместе.

Прежние context/search/patch/CAS/checkpoint/tree recovery/navigation/publish сохраняются.
Новых runtime/store/dependencies/migrations/provider/quota/permission changes нет.

## Проверки

- API/GitHub/tree117PASS+1opt-inSKIP, baselineFAIL сохранён.
- Полный root check:core40a3a9e exit0: API1031/web290 fresh, остальные cache.
- Real HTTP repair-v2 → OCI → Git1PASS (85filtered skips), failed1→passed0,
  cleanup true,2files/00123/README сохранены. External model/GitHub fixtures.
- Strict E2E types0, production Chromium15630PASS0, workers1/retries0.
- Source40 весь CI43024980295 success: monorepo130537461796,
  browser130537462097, isolation130537462197. Identity43024980309 success.
  Квитанция ci-source.json относится к HEAD40a3a9e; новый docs HEAD проверяется
  отдельно, его CI не выдаётся за завершённый. Предыдущий10f50a1 также был green.
- Новые receipts/logs/patch/fixtures/hashes в fixtures/stale-check; подробности DELIVERY.

## Продолжение интегратора

Проверить актуальный PR519 и full CI на точном HEAD, затем канонические общие контракты
перед объединением. Общий adapterb22b4f3 отдельно описан в INTEGRATION.md. Новых
общих исходников этот fix не меняет. Все найденные в этом ревью программные пробелы
закрыты. Не создавать новый продукт/блок ради продолжения.

Live модель/foreign publish/ownerPC/VPS/merge/deploy не разрешены и не выполнялись.
Node checks по snapshot без сети/install/arbitrary shell; tree budgets и browser
compatibility остаются прежними, см. DELIVERY. Максимальный статус — готово к интеграции.
