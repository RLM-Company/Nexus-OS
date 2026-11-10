# Контрольная точка 05_GEMINI (`CHECKPOINT.md`)

- **Исполнитель:** Gemini (`05_GEMINI`)
- **Ветка:** `ops/gemini-browser-research`
- **Базовый коммит:** `09369af22d5799cf30b3388121f8ff3f9ab9a835` (соответствует проверенной стартовой базе `9d972e8ba447f681fbfb49253b73d9f02dd1d325` от 10 ноября до наложения старого накопительного архива)
- **Статус очереди больших результатов (1–6):** все 6 пунктов очереди реализованы, интегрированы и проверены тестами на реальном Chromium CDP.

## 1. Команды проверки (выполнены и зелёные)

1. **Приёмочные тесты реального Chromium CDP и полного цикла Deep Research (`6/6 pass`):**
   ```bash
   node --test desktop/windows/test/browser-research-cdp-acceptance.test.cjs
   ```
2. **Интеграционный тест вертикального среза `apps/api/src/research` + `apps/web/src/app/research-workspace` (`1/1 pass`):**
   ```bash
   NODE_PATH=/usr/share/nodejs node -e '
   require("@babel/register")({
     extensions: [".ts", ".tsx", ".js"],
     presets: [["@babel/preset-env", { targets: { node: "current" } }], "@babel/preset-typescript"]
   });
   require("./apps/api/test/research-vertical-slice.test.ts");
   '
   ```

## 2. Точка продолжения для следующего запуска / интеграции с Codex

- Все изменения строго локализованы в разрешённых границах (`desktop/windows/browser/*`, `apps/api/src/research/*`, `apps/web/src/app/research-workspace/*`, scoped tests, `docs/research/*` и `docs/team/operation-2026-11-10/deliveries/05_GEMINI/*`).
- Интеграционный коммит для `desktop/windows/browser/shell.cjs` и `desktop/windows/ci/unified-task-coordinator.cjs` выделен отдельно (`607d848`) и описан в `INTEGRATION.md`.
- При запуске на машине с внешним доступом в Интернет достаточно передать URL боевого поискового эндпоинта в `searchAdapterOptions.searchEndpoint` конструктора `KosworkBrowserEngine`.
