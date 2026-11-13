# Coscode: сохранность несохранённых правок при обновлении

Inputs находятся в `apps/web/e2e/code-agent.spec.ts`, helper scenario и шести
новых Code refresh tests. Настоящий production Next/React/Chromium UI получает
intercepted Code API responses; model/API provider/GitHub side effects фиктивные.
Backend/executor в этих UI tests не выдаётся за живой модельный прогон.

- baseline.log и baseline-*.json: реальные3FAIL+1PASS до исправления, вывод DOM потерял локальный текст.
- targeted5-passed.log: пять целевых сценариев после исправления, exit0.
- full41-passed.log: полные41PASS/retries0, включая35 существующих сценариев и6 новых.
- passed-*-preservation.json: фактическое значение editor после конфликтующего ответа.
- passed-*-recovery.json: фактическое значение после cancel, stale/403 и разрешённой загрузки; writes=[] в этих фазах.
- raw-readback-hashes.json: hashes JSON до форматирования; SHA256SUMS — hashes приложенных файлов.
- final-core-passed.log: root gate после main14a exit0, raw hash и cache disclosure.
- main-sync-source-blobs.json: семь фактически неизменившихся source blobs после merge.
- FINAL_MAIN_SHA.txt: main14a, сохранённый перед передачей.
- source.patch: настоящий diff двух source files против BASE_SHA (предыдущего проверенного HEAD PR581).

Fixture text содержит19 700,00123,2026-11-13 и «кроме доставки»;
проверяется точное inputValue, не обещание модели. BASE_SHA включает предыдущий
slice порядка снимков; MAIN_SHA — фактически сохранённая версия main.
[Поставка и команды](../../COSCODE_UNSAVED_REFRESH_DELIVERY_RU.md).

Первый общий CI43455694958 остался красным:529PASS+1flaky в unrelated draft seed.
`ci43455694958-*` сохраняют failure excerpt, оригинальный terminal seed status,
actual CodeAgent CI readbacks и receipt; artifact14053609515/digest указан в trace JSON.
`seed-selection-no-tests.log` — диагностический grep без выбранных tests, не PASS.
`seed-repeat5-passed.log` —5 независимых повторов с явным cancel seed, retries0.
`integration-types-passed.log` и `integration-lint-passed.log` — exit0.
