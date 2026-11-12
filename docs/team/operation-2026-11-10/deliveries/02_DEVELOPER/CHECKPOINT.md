# Программная приёмка на актуальном main, 12 ноября 2026

Ветка ops/developer-coscode-context-secrets-2026-11-12, Draft PR551.
Прежнийc9625d6: CI43215271862 attempt2 SUCCESS, identity43215271857 SUCCESS;
первый OCI warm-up timeout124 сохранён, один targeted retry прошёл5/5.
Это проверка прежнего head, не нового combined tree.

Current main1c07f8dc291b38d0faf92088c53e704e348d0256 сохранён без conflicts.
Candidate mergec3cef4bb79d1e14b4d61979a7010dcc830e94353,
treeb455ff73906f2b0a6bc3183deef546ae38a78459 (равен local0e259e3).
Новые общие контракты Skills просмотрены; CodeAgent/Manager/executor не менялись.
На combined tree scoped150PASS+1SKIP, full coreexit0 (API1070/web363/core406/DB223),
и свежий реальный tmpGit→API→OCI→repair→readback1PASS. Первое локальное OCI unavailable
было из-за отсутствия /usr/bin/docker; исправлена только конфигурация existing flag
на /usr/local/bin/docker. Оба результата сохранены, model/GitHub fixtures явные.

Итог: **готово к интеграции**. Отчёт SOFTWARE_ACCEPTANCE_RU.md и fixtures/main-1c07-acceptance-2026-11-12/.
Финальный docs SHA — в PR history. Следующее действие: CI точного финального HEAD,
затем интеграционное review. До этого не сбрасывать длинный browser job новым push.
Новый runtime/продукт ради продолжения не создавать. Live ИИ API отложен владельцем;
foreign publish/ownerPC/VPS/deploy не выполнять без отдельного поручения.
PR542 synthetic base никогда не merge. Ранее рабочие Office/Drive527 и Coscode519
уже в main; не реализовывать их повторно. PR549 — самостоятельный chat candidate.

Предыдущие checkpoints ниже — история срезов, не текущая очередь.

---

# Продолжение PR551: legacy check feedback, 12 ноября

Ветка ops/developer-coscode-context-secrets-2026-11-12; source HEAD
78e516ca4d7a45bf6e7356624b3673649580d2fd, tree93a4bbbf28e3732b936de03d8c4f491066fc40ac.
Follow-up BASE f7a67f0928fa18c0cf00e8a76c255b869cfdb64b, исходный maina5f6511 сохранён.
GitHub/local source tree equality verified. Тот же Draft PR551, новых PR не создавали.

Найден и исправлен discarded validator result в repair: prompt/excerpt/current check/
source_check теперь получают канонический redacted result. Invalid legacy journal
даёт REPAIR_CHECK_REQUIRED409 до резервирования попытки. Version/consent/one-attempt
fences прежние, исходники не переписываются. API150PASS+1SKIP, validator4PASS;
baseline2FAIL и два fixture-counter failures сохранены. Новый полный core exit0:
API1065PASS+1SKIP fresh, web361PASS/unchanged packages cached, остальные gates passed.
Статус **готово к интеграции**, без merge/deploy.

Точка продолжения: проверить CI точного финального HEAD PR551 и актуальный main.
Сначала завершить приёмку этого CI; до результата не начинать новый срез и не
перезапускать длинный browser job очередным попутным push. При failure сохранить
его причину и исправлять конкретный сбой. После всех зелёных gates закончить
программную приёмку; live модель остаётся отложенной владельцем.
Итоговый docs SHA — в истории PR; source78e516c проверен, финальный code идентичен ему.
Main5b6013d сохранён merge8de00758 (только документация; common contracts не менялись).
Receipt/logs/SHA256SUMS сохранены в fixtures/repair-feedback-2026-11-12/.
CI source78e516c на момент записи ещё выполнялся; новые статусы проверять по GitHub,
а не считать предыдущие сообщения/отчёты подтверждением финального CI. Никаких merge/deploy/owner-PC/VPS.
Описание и команды: [REPAIR_FEEDBACK_DELIVERY_RU.md](REPAIR_FEEDBACK_DELIVERY_RU.md).
Модель отложена владельцем; все model/GitHub/runner calls здесь fixtures.
Старые непереиспользованные rows массово не чистились, универсальный DLP не заявляется.

Предыдущая точка продолжения ниже.

---

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
