# Аудит поставки `reference/gemini-295-20261110` и карта реальной интеграции (`05_GEMINI`)

**Дата аудита:** 2026-11-10  
**Исполнитель:** Gemini (`ops/gemini-browser-research`, ID отчётов: `05_GEMINI`)  
**Проверенная стартовая база (`main`):** `9d972e8ba447f681fbfb49253b73d9f02dd1d325` (локальный снимок дерева до ветки исследования: `09369af22d5799cf30b3388121f8ff3f9ab9a835`)

## 1. Главные выводы аудита пакета `reference/gemini-295-20261110` (621 файл)

Предыдущий накопительный архив содержал 295 модулей, однако аудит фактического исполнения выявил четыре системные проблемы, из-за которых количество файлов не равнялось подключённым продуктовым функциям:

1. **Подмена реального Chromium CDP на `syntheticSites` и регулярные выражения HTML (`engine.cjs`, `document.cjs`)**:
   - Вместо запуска и управления реальным браузером Electron/Chromium через Chrome DevTools Protocol (`CDP`: `Target`, `Page`, `Runtime`, `DOM`, `Input`), прежний `engine.cjs` хранил карту `this.syntheticSites = new Map()` и парсил HTML регулярными выражениями (`stripHtmlTagsPreservingBlocks`).
   - В результате динамический рендеринг JS, реальные клиентские переходы, `getBoundingClientRect()`, живые формы и реальная отмена загрузки (`Page.stopLoading`) не проходили через движок Chromium.
2. **Недостаточная проверка доказательств (`citation-verifier.cjs`, `browser-research-session-store.ts`)**:
   - Прежняя валидация проверяла только непустой `quote`, `startUtf16 < endUtf16` и совпадение SHA-256 хеша.
   - Непустой `quote` и хеш **не доказывают тезис**: если выдержка содержит отрицание («не поддерживает SSO», «тариф $49 устарел в 2025 году») или вообще не содержит заявленного значения критерия, прежний код ошибочно помечал тезис как `confirmed`.
3. **Поведение при ошибке поискового провайдера (`research-adapter.cjs`)**:
   - При недоступности провайдера или ошибке сети требовалось явно возвращать ошибку/недоступность источника без скрытого перенаправления на другой поисковик и без генерации синтетических результатов.
4. **Накопление ~50 автономных файлов-экспортёров без продуктового вертикального среза**:
   - Десятки узкоспециализированных файлов (`ro-crate-research-object-exporter.cjs`, `csl-json-and-ris-bibliography-exporter.cjs`, `asciidoc-and-rst-technical-report-exporter.cjs`, `latex-academic-dossier-exporter.cjs`, `mermaid-knowledge-graph-exporter.cjs`, `json-schema-and-sarif-audit-exporter.cjs`, `junit-and-tap-verification-exporter.cjs` и др.) вызывались только из гигантского `switch` в `shell.cjs` и дублировали существующие адаптеры экспорта Codex в `desktop/windows/workspace/*`.

## 2. Карта классификации модулей из `reference/gemini-295-20261110`

| Категория | Модули из старого пакета | Решение в `ops/gemini-browser-research` (`05_GEMINI`) |
| --- | --- | --- |
| **Базовые модули в `main` (сохранены без дублирования)** | `desktop/windows/browser/{download-verifier,search-pagination-and-bookmarks,shadow-and-frame-piercer,visual-dom-diff-verifier}.cjs`, `desktop/windows/workspace/{workspace-service,word-report-builder,excel-workbook-builder,pdf-report-builder}.cjs` | Используются напрямую как канонические контракты |
| **Ядро браузера (переписано на реальный Chromium CDP)** | `engine.cjs`, `document.cjs`, `policy.cjs`, `recovery.cjs`, `resource-governor.cjs` | Дополнено `chromium-cdp-driver.cjs` (реальный `/usr/bin/chromium` over CDP WebSocket + `Page`/`Runtime`/`DOM`); убрана подмена на `syntheticSites`; добавлены стабильные `elementRef` (`data-koswork-ref`), проверка `STALE_ELEMENT_REFERENCE` при смене `domEpoch`/`pageVersion`, реальный `findInPage` и чтение длинных страниц со скроллом |
| **Поиск и сбор источников (доведено до строгих правил)** | `research-adapter.cjs`, `search.cjs`, `corpus-http-server.cjs` | Реальная пагинация SERP, дедупликация по каноническому URL и контентному отпечатку (шинглы), явная фиксация недоступных источников (`HTTP 503/404/timeout`), запрет скрытого fallback-поиска и выдумывания результатов при сбое провайдера |
| **Верификация выдержек и сопоставление (доведено)** | `claim-comparator.cjs`, `citation-verifier.cjs` → объединено и усилено в `evidence-verifier.cjs` | Проверка семантического и лексического соответствия цитаты заявленному тезису `(subject, criterion, value)`, учёт отрицаний/устаревания в контексте цитаты, фиксация `readingLimitations` (cross-origin frames, неполное чтение длинной страницы) и явная матрица противоречий между источниками |
| **Исследовательский цикл и передача в проект (доведено)** | `research-workflow.cjs`, `research-report-builder.cjs` | Декомпозиция цели на вопросы, жёсткий лимит повторных запросов (`maxQueriesPerQuestion`, `maxTotalQueries`), добор недостающих подтверждений, честный статус «не удалось установить», экспорт настоящего артефакта через существующий Codex адаптер (`workspace-service.cjs` / `word-report-builder.cjs`) и передача через текущий hook `unified-task-coordinator.cjs` |
| **Backend API и Web UI срез (`apps/api/src/research`, `apps/web/src/app/research-workspace`)** | `apps/api/src/browser-research-routes.ts` | Приведено к канонической границе `apps/api/src/research/*` и `apps/web/src/app/research-workspace/*` со сквозным контрактом и scoped-тестами |
| **Отброшенный балласт (~50 файлов)** | `ro-crate-*`, `csl-json-*`, `asciidoc-rst-*`, `latex-academic-*`, `mermaid-knowledge-graph-*`, `json-schema-and-sarif-*`, `junit-and-tap-*`, `rss-atom-*`, `openapi-graphql-*`, `changelog-semver-*`, `hardware-and-benchmark-*`, `pricing-tco-*`, `pricing-tier-*` и др. | **Не переносятся** в `ops/gemini-browser-research`, чтобы не засорять репозиторий неподключёнными обёртками |
