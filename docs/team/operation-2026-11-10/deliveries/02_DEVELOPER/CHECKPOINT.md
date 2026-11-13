# Продолжение приёмки, 13 ноября 2026

Ветка `fix/chat-draft-e2e-diagnosis-2026-11-12`, Draft PR558.
Main9f79c6d сохранён отдельным merge ff51c4f, tree191159c5.
Контракты chat/CodeAgent/executor не изменились; чужие изменения не переписывались.
Предыдущий HEAD289dce7 имеет CI43272293412 SUCCESS; это не CI нового кандидата.

Проверена конкретная гипотеза влияния настроек: пять свежих fixture-баз,
два workers, три сценария в каждом прогоне,15PASS/retries0. Research13PASS,
CI-gate regression1PASS. Исходная ошибка чата не воспроизвелась;
причина по-прежнему не установлена, в runtime предположительных правок нет.

Детали: [CHAT_FLAKE_FOLLOWUP_2026_11_13_RU.md](CHAT_FLAKE_FOLLOWUP_2026_11_13_RU.md).
Следующий шаг — exact final HEAD CI, затем каноническая интеграция по разрешению.
Не создавать новые функции ради продолжения и не повторять неизменённые прогоны:
для дальнейшего runtime-исправления нужен воспроизводимый отказ/error_code/trace.
Без merge/deploy, живой модели, новых разрешений или изменения квот владельца.

Предыдущая история ниже.

---

# Анализ flaky chat и исправление контроля CI, 12 ноября 2026

Ветка `fix/chat-draft-e2e-diagnosis-2026-11-12`, база main33f43b8.
Source33f6014, отдельный CI integration49876e6. Подробности:
[CHAT_FLAKE_DIAGNOSIS_RU.md](CHAT_FLAKE_DIAGNOSIS_RU.md).

Подтверждено и исправлено: flaky после retry больше не даёт зелёный CI;
trace/diagnostics сохраняются и при recovered outcome; тест отправки пишет
HTTP/error_code и безопасные terminal metadata. Таймауты и assertions не ослаблены.

Первопричина исторического «Ошибка запуска» пока не подтверждена: отдельно10/10,
в mixed run целевой тест тоже прошёл. Mixed run остановлен на Games file:// policy:
160PASS,1FAIL,1interrupted,328not run; полный успех не заявляется.
После fix chat16/16 без retry, web363 +10 studio checks, types/lint passed.
Дальше: проверить exact final HEAD CI; при повторе читать сохранённый trace/error_code.
Даже при полном PASS не объявлять первопричину исторического chat сбоя исправленной.
Без merge/deploy, живой модели, изменения тарифов/квот/прав/браузерной политики.

Предыдущая история ниже.

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
