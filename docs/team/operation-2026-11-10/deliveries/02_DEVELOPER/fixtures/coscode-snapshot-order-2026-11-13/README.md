# Coscode snapshot order: воспроизводимые свидетельства

Входы заданы в `apps/web/e2e/code-agent.spec.ts`, helper `scenario` и пять новых
тестов в конце. Intercepted API fixtures возвращают задержанные/ошибочные ответы;
настоящий React/Next UI обрабатывает их и создаёт DOM readback JSON.
В `baseline-*.json` видно прежнее состояние; `passed-*.json` — реальные итоговые
чтения пяти новых сценариев. Никакой модели/paid API/GitHub side effect не было.

- `baseline.log`: первоначальные3FAIL+1PASS.
- `initial-types-failure.log`: TS2379 до исправления optional undefined.
- `production-locator-failure.log`: полный34-case33PASS+1selectorFAIL.
- `targeted-production-passed.log`: исправленный selector,4PASS.
- `final-five-production-passed.log`: финальный review,5PASS и actual late403.
- `final-full-production-passed.log`: полные35PASS, retries0, включая предыдущие30.
- `full-suite-readback-comparison.json`: все пять readbacks совпали между targeted и full.
- `final-core-passed.log`: итоговый root gate exit0, raw SHA256 и сведения о Turbo cache.
- `source.patch`: настоящий binary-capable diff семи source files против сохранённого main.
- `dev-stand-cancelled.log`: сокращённый повторяющийся compiler log, отмена130.
- `production-port-failure.log`: EADDRINUSE3412, assertions не запускались.
- `stand-failures.json`: точные отдельные отказы, unverified dev listener cleanup.
- `raw-readback-hashes.json`: hashes original browser JSON до Prettier.
- `SHA256SUMS`: hashes окончательных приложенных файлов, включая нормализованные логи.

Команды и ограничение полноты — в [поставке](../../COSCODE_SNAPSHOT_ORDER_DELIVERY_RU.md).
BASE_SHA — начало ветки; SYNCED_BASE_SHA — промежуточный main1b73;
FINAL_SYNCED_BASE_SHA — сохранённый финальный main4477.
`main-sync.json` содержит фактические SHA семи неизменившихся source blobs,
`synced-core-passed.log` — повторный root gate exit0.
