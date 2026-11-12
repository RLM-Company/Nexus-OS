# Продолжение: 12 ноября, chief chat recovery

Владелец временно назначил главным разработчиком; очередь восстановлена по actual
main/ancestry, а не старым open PR. Текущая рабочая ветка
`ops/chief-chat-recovery-2026-11-12`, Draft PR #549. Source HEAD
`05fc4936cda966bf27a6d5f1d0d7c2fa58f5054f`, tree
`49b6efb393fdbf69e42d01e2dd1f6ea563e26d9b`. BASE checkout03cd454,
новый maina5f6511 сохранён. GitHub/local tree equality проверена.

Срез: #539/#541 + canonical browser draft actions persistence закрывают потерю
действия после lost ACK/reload и сохраняют точный повтор запроса.
Baseline 1FAIL; новый production browser suite18PASS; unit22PASS; contracts206PASS;
build/strict E2E types/source lint passed. Полный check:core exit0; отдельные composer races12PASS.
Статус **готово к интеграции**, без merge/deploy. Scoped evidence/receipt/hashes
сохранены в fixtures/chat-action-recovery-2026-11-12/.
Подробности/команды/неудачные подготовительные проверки —
[CHIEF_CHAT_RECOVERY_DELIVERY_RU.md](CHIEF_CHAT_RECOVERY_DELIVERY_RU.md).

Следующее действие: проверить CI точного финального HEAD PR549 и свежий main;
сохранён source tree49b6efb3, итоговый docs HEAD указан в истории PR.
Source CI identity/isolation/monorepo уже success; browser job на момент записи выполняется.
Новый docs CI не выдавать за завершённый. Не выдавать Draft PR за merged/release. Чужие branch/BOARD не менять.
Office/Drive527 и Coscode519 уже предки main; повторно не реализовывать.
Coscode live receipt source PR546 — отдельный Draft; модель не вызывалась.
Тестовый PR542 на synthetic base не объединять в main. Native Windows actions
после restart и live HY4 — реальные непроверенные границы; owner-PC/VPS/deploy
не выполнять. Новую значительную функцию без согласованного объёма не начинать.

Предыдущий checkpoint ниже сохраняется как историческая запись 11 ноября.

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
