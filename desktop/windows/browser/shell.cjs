"use strict";

const { KosworkBrowserEngine } = require("./engine.cjs");
const { executeMultiSiteResearchWorkflow } = require("./research-workflow.cjs");
const { runPublicUnauthenticatedWebSmoke } = require("./public-web-research-verifier.cjs");
const { KosworkDynamicPageScroller } = require("./dynamic-page-scroller.cjs");
const { KosworkResearchSessionCheckpointManager } = require("./session-checkpoint-recovery.cjs");
const { KosworkCoBrowsingCoordinator } = require("./co-browsing-handback.cjs");
const { reverifyAndRefreshResearchReport } = require("./report-reverifier.cjs");
const {
  executeDecomposedSearchAndDeduplicate,
  navigateWithVerifiedRedirectChain
} = require("./query-decomposer-and-redirect-tracker.cjs");
const { executeMultiStepFormWizard } = require("./multi-step-form-wizard.cjs");
const { KosworkHibernatedTabRevalidator } = require("./hibernated-tab-revalidator.cjs");
const { extractStructuredSpecsFromSnapshot } = require("./structured-matrix-extractor.cjs");
const { KosworkBrowserEvidenceVault } = require("./evidence-vault-index.cjs");
const { buildApiSyncBundleFromDesktopCycle } = require("./work-executor-sqlite-bridge.cjs");
const {
  buildDocumentHeadingOutline,
  jumpToSectionByHeading,
  extractSectionScopedExcerpt
} = require("./heading-outline-navigator.cjs");
const { scoreMultiSourceCorroboration } = require("./corroboration-scorer.cjs");
const { buildBrowserResearchDrawerViewModel } = require("./ui-research-drawer-state.cjs");
const {
  compareResearchReports,
  saveReportDiffViaWorkspace
} = require("./report-diff-analyzer.cjs");
const {
  findAllOccurrencesInSnapshot,
  promoteOccurrenceToVerifiedExcerpt
} = require("./find-in-page-highlighter.cjs");
const { evaluateAccessRestrictionDecision } = require("./rate-limit-and-robots-guard.cjs");
const {
  ingestMultiFormatDownloadedDocument
} = require("./downloaded-archive-and-doc-ingestor.cjs");
const { KosworkResearchPinboardBridge } = require("./research-pinboard-bookmarks.cjs");
const { verifyDeterministicResearchReplay } = require("./research-replay-auditor.cjs");
const { KosworkSpaRouteObserver } = require("./spa-route-observer.cjs");
const { validateExcerptContextAndBoundaries } = require("./context-boundary-validator.cjs");
const {
  extractOutboundCitationLinks,
  followAndVerifyPrimaryCitation
} = require("./hyperlink-citation-graph.cjs");
const {
  evaluateMultiCriteriaDecisionMatrix
} = require("./multi-criteria-decision-matrix.cjs");
const {
  saveOfflineEvidenceBundleToWorkspace,
  restoreSnapshotsFromEvidenceBundle
} = require("./offline-evidence-bundle-archiver.cjs");
const {
  extractCodeBlocksWithUtf16Offsets,
  extractAndVerifyHydrationJsonState
} = require("./hydration-and-codeblock-extractor.cjs");
const {
  KosworkTabWorkspaceSessionRestorer
} = require("./tab-workspace-session-restorer.cjs");
const {
  analyzeResearchCoverageAndBuildFollowUps
} = require("./research-coverage-gap-analyzer.cjs");
const { executeIterativeGapClosingResearch } = require("./iterative-gap-closer.cjs");
const {
  extractFiguresAndSvgCharts
} = require("./chart-and-figure-caption-extractor.cjs");
const {
  redactSensitiveUrlParams,
  redactSensitiveText,
  auditPayloadForZeroSecretLeaks
} = require("./privacy-redaction-guard.cjs");
const {
  extractClaimWithResolvedFootnotes
} = require("./footnote-reference-resolver.cjs");
const {
  KosworkAdaptiveResourceAutotuner
} = require("./adaptive-resource-autotuner.cjs");
const {
  runDesktopToApiHttpRoundtrip
} = require("./fullstack-api-roundtrip-verifier.cjs");
const {
  alignBilingualClaimsForOption
} = require("./bilingual-terminology-mapper.cjs");
const {
  inspectPageSecurityPosture
} = require("./page-security-posture-inspector.cjs");
const {
  buildContradictionResolutionMatrix,
  saveContradictionResolutionMatrixViaWorkspace
} = require("./contradiction-resolution-matrix.cjs");
const {
  extractAriaAccessibilityTree,
  findInteractiveTargetsByAriaRoleAndName
} = require("./dom-aria-a11y-tree-extractor.cjs");
const {
  buildSafeMultipartFormDataPayload,
  executeVerifiedChunkedDownload
} = require("./multipart-upload-and-chunk-downloader.cjs");
const {
  buildExecutiveBriefAndClaimCards,
  saveExecutiveBriefAndClaimCardsViaWorkspace
} = require("./executive-brief-and-claim-cards-exporter.cjs");
const {
  computeVerifiedMultiYearTcoModel,
  saveVerifiedTcoComparisonViaWorkspace
} = require("./pricing-tco-calculator-and-normalizer.cjs");
const {
  KosworkDomMutationBatchObserver
} = require("./dom-mutation-batch-observer.cjs");
const {
  auditResearchSessionHealthAndCompliance,
  saveResearchComplianceCertificateViaWorkspace
} = require("./research-session-health-and-sla-auditor.cjs");
const {
  parseRssAtomOrSitemapFeed,
  ingestFeedAndOpenTopEntries
} = require("./rss-atom-sitemap-feed-ingestor.cjs");
const {
  executeSafeClipboardPasteIntoControl,
  executeSafeWorkspaceFileDrop
} = require("./clipboard-paste-and-dragdrop-guard.cjs");
const {
  renderResearchReportLatexDossier,
  saveLatexAcademicDossierViaWorkspace
} = require("./latex-academic-dossier-exporter.cjs");
const {
  extractApiEndpointsAndGraphqlSchemas,
  verifyApiSpecClaimAgainstEndpointTable
} = require("./openapi-graphql-doc-extractor.cjs");
const {
  KosworkTabNetworkWaterfallProfiler
} = require("./tab-network-waterfall-and-cache-profiler.cjs");
const {
  buildSarif210ResearchAuditReport,
  saveSarifAndJsonSchemaAuditViaWorkspace
} = require("./json-schema-and-sarif-audit-exporter.cjs");
const {
  extractSlaCommitmentsAndLegalClauses,
  compareSlaCommitmentsAcrossVendors
} = require("./sla-compliance-and-legal-clause-extractor.cjs");
const {
  KosworkOriginStorageIsolationGuard
} = require("./cookie-storage-and-origin-isolation-guard.cjs");
const {
  buildResearchKnowledgeGraphAndMermaidReport,
  saveMermaidKnowledgeGraphViaWorkspace
} = require("./mermaid-knowledge-graph-exporter.cjs");
const {
  extractSemverReleaseChangelog,
  verifyBreakingChangesAndDeprecationsAcrossVersions
} = require("./changelog-semver-timeline-analyzer.cjs");
const {
  verifyDownloadContentDispositionAndMagicBytes
} = require("./content-disposition-and-mime-sniff-guard.cjs");
const {
  buildRoCrateMetadataDescriptor,
  saveRoCrateResearchPackageViaWorkspace
} = require("./ro-crate-research-object-exporter.cjs");
const {
  extractTierQuotasAndOverageRates,
  evaluateWorkloadFitAgainstTierQuotas
} = require("./pricing-tier-limit-and-quota-extractor.cjs");
const {
  KosworkOAuthSsoPopupAndRedirectGuard
} = require("./oauth-sso-redirect-and-popup-guard.cjs");
const {
  buildJUnitXmlAndTap14ResearchReport,
  saveJUnitAndTapVerificationReportViaWorkspace
} = require("./junit-and-tap-verification-exporter.cjs");
const {
  extractHardwareAndPerformanceBenchmarks,
  compareBenchmarkThroughputAcrossOptions
} = require("./hardware-and-benchmark-spec-extractor.cjs");
const {
  KosworkLiveStreamFrameObserver
} = require("./websocket-and-sse-live-stream-observer.cjs");
const {
  buildCslJsonAndRisBibliography,
  saveCslJsonAndRisBibliographyViaWorkspace
} = require("./csl-json-and-ris-bibliography-exporter.cjs");
const {
  normalizeKeyboardLayoutAndSearchQuery,
  executeLayoutResilientSearch
} = require("./keyboard-layout-and-search-query-normalizer.cjs");
const {
  evaluateIframeSandboxAndCspDirectives
} = require("./csp-and-iframe-sandbox-policy-enforcer.cjs");
const {
  renderAsciiDocAndReStructuredTextReport,
  saveAsciiDocAndRstReportViaWorkspace
} = require("./asciidoc-and-rst-technical-report-exporter.cjs");

/**
 * Shared Tool & Execution Boundary for Koswork Browser (`desktop/windows/browser/shell.cjs`).
 *
 * Kept minimal and isolated in a dedicated integration commit (`browser/shell.cjs` boundary with Codex).
 */

const BROWSER_RESEARCH_TOOL_DEFINITIONS = Object.freeze([
  {
    name: "browser.search",
    description:
      "Выполнить поиск через подключённый поисковый адаптер и сохранить результаты с явным указанием провайдера.",
    requiredParams: ["query"]
  },
  {
    name: "browser.decomposed_search",
    description:
      "Декомпозировать исследовательский вопрос на подзапросы, выполнить поиск и дедуплицировать SERP по каноническому URL с сохранением происхождения.",
    requiredParams: ["question"]
  },
  {
    name: "browser.open_result",
    description:
      "Открыть результат поиска в браузере Koswork, сохранить URL, заголовок, время получения и связь с выдержкой.",
    requiredParams: ["searchId", "rank"]
  },
  {
    name: "browser.navigate_with_redirects",
    description:
      "Открыть URL с отслеживанием цепочки редиректов (HTTP/meta-refresh) и проверкой политики безопасности на каждом шаге.",
    requiredParams: ["initialUrl"]
  },
  {
    name: "browser.record_spa_route",
    description:
      "Зафиксировать клиентский переход SPA (pushState, replaceState, hashchange) с обновлением версионного снимка и стека истории вкладки.",
    requiredParams: ["tabId", "nextUrl"]
  },
  {
    name: "browser.extract_citation_links",
    description:
      "Извлечь исходящие гиперссылки <a href> на открытой странице с точными смещениями UTF-16 текста ссылки.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.follow_primary_citation",
    description:
      "Перейти по цитируемой гиперссылке из обзорной статьи в первоисточник и проверить подтверждение утверждения UTF-16 выдержкой.",
    requiredParams: ["sourceTabId", "anchorOrUrlQuery"]
  },
  {
    name: "browser.extract_code_blocks",
    description:
      "Извлечь технические блоки <pre>/<code> на открытой странице с точными смещениями UTF-16.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.extract_hydration_state",
    description:
      "Извлечь JSON-блоки гидратации (__NEXT_DATA__) и сверить их значения с видимым текстом DOM.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.extract_figures_and_charts",
    description:
      "Извлечь подписи графиков <figure>/<figcaption> и доступные метки <svg> с точными смещениями UTF-16.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.extract_claim_with_footnotes",
    description:
      "Извлечь утверждение вместе с привязанными сносками ([1], [*]) и их точными UTF-16 выдержками.",
    requiredParams: ["tabId", "searchTerm"]
  },
  {
    name: "browser.align_bilingual_claims",
    description:
      "Сопоставить русскоязычные и англоязычные критерии сравнения с сохранением оригинальных UTF-16 выдержек.",
    requiredParams: ["claims"]
  },
  {
    name: "browser.inspect_security_posture",
    description:
      "Проверить заголовки/мета-теги CSP, Subresource Integrity (SRI) и понижение HTTPS->HTTP в формах на открытой странице.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.extract_aria_tree",
    description:
      "Извлечь дерево доступности WAI-ARIA (landmarks, роли, доступные имена, смещения UTF-16) и при необходимости отфильтровать интерактивные элементы по роли и имени.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.build_multipart_form_payload",
    description:
      "Собрать безопасный RFC 7578 multipart/form-data пакет с проверкой вложений через политику рабочей папки и вычислением SHA-256.",
    requiredParams: ["fields"]
  },
  {
    name: "browser.execute_chunked_download",
    description:
      "Выполнить потоковую загрузку по чанкам в разрешённую рабочую папку с .part-стейджингом, контролем лимита байт, AbortSignal и проверкой SHA-256.",
    requiredParams: ["fileName", "chunks"]
  },
  {
    name: "browser.compute_tco_model",
    description:
      "Рассчитать многолетнюю совокупную стоимость владения (TCO 1 / 12 / 36 мес.) по верифицированным UTF-16 ценовым выдержкам с отсевом голых ссылок.",
    requiredParams: ["pricingClaims"]
  },
  {
    name: "browser.observe_dom_mutation_batch",
    description:
      "Применить пакет живых DOM-мутаций на открытой вкладке, увеличить версию снимка, перепривязать UTF-16 оффсеты цитат и выявить пост-наблюдательную подмену текста.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.ingest_feed_sources",
    description:
      "Распарсить ленту RSS 2.0 / Atom 1.0 / XML Sitemap с раздельными pageDate и eventDate, проверить URL по политике безопасности и открыть релевантные материалы в браузере.",
    requiredParams: ["rawXml"]
  },
  {
    name: "browser.paste_clipboard_into_control",
    description:
      "Безопасно вставить текст из буфера обмена в поле формы с очисткой невидимых символов, защитой от секретов и проверкой невалидности наблюдения при вмешательстве пользователя.",
    requiredParams: ["tabId", "selector", "clipboardText"]
  },
  {
    name: "browser.drop_workspace_files",
    description:
      "Выполнить безопасный drag-and-drop выбор файлов из разрешённой рабочей папки в input[type=file] с отсевом запрещённых типов (.env, .exe).",
    requiredParams: ["tabId", "selector", "candidateFilePaths"]
  },
  {
    name: "browser.extract_api_and_graphql_specs",
    description:
      "Извлечь REST/OpenAPI эндпоинты, лимиты запросов и GraphQL SDL типы из документации с точными смещениями UTF-16 и датами источника.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.verify_api_spec_claim",
    description:
      "Проверить утверждение о наличии API эндпоинта по дословной UTF-16 выдержке из страницы документации с отклонением голых ссылок.",
    requiredParams: ["tabId", "requiredMethod", "requiredRouteSubstring"]
  },
  {
    name: "browser.profile_tab_network_waterfall",
    description:
      "Записать и агрегировать сетевой водопад вкладок (DNS/TCP/TLS/TTFB/Download) и экономию трафика от повторного использования валидных снимков.",
    requiredParams: ["events"]
  },
  {
    name: "browser.extract_sla_and_compliance",
    description:
      "Извлечь обязательства SLA аптайма, целевые показатели RTO/RPO и сертификаты безопасности (SOC 2 Type II, ISO/IEC 27001, GDPR, HIPAA, ФЗ-152) с точными смещениями UTF-16.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.compare_vendor_slas",
    description:
      "Сравнить обязательства SLA и сертификаты между поставщиками по верифицированным снимкам с отклонением голых ссылок.",
    requiredParams: ["vendorSubmissions"]
  },
  {
    name: "browser.analyze_semver_changelog",
    description:
      "Извлечь блоки релизов SemVer из истории изменений (changelog) с датой релиза eventDate, CVE и точными смещениями UTF-16.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.verify_semver_feature_status",
    description:
      "Проверить актуальность функции или API по цепочке релизов SemVer и выявить перекрытие более новым релизом (SUPERSEDED_BY_NEWER_SEMVER_RELEASE).",
    requiredParams: ["tabId", "featureKeyword"]
  },
  {
    name: "browser.verify_download_magic_bytes",
    description:
      "Проверить заголовок Content-Disposition и магические байты скачиваемого файла для блокировки замаскированных исполняемых файлов (MZ/ELF/#!).",
    requiredParams: ["contentDispositionHeader"]
  },
  {
    name: "browser.extract_tier_quotas",
    description:
      "Извлечь квоты хранилища, месячные лимиты запросов и ставки сверхлимитного потребления (overage) с точными смещениями UTF-16.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.evaluate_workload_quotas",
    description:
      "Рассчитать эффективную месячную стоимость с учётом сверхлимитного потребления (overage) под заданную нагрузку по верифицированным снимкам.",
    requiredParams: ["vendorTiers"]
  },
  {
    name: "browser.inspect_oauth_sso_redirect",
    description:
      "Проверить OAuth 2.0 / OIDC / SAML SSO редирект или popup-окно, заблокировать open-redirect и перевести вкладку в paused_for_user.",
    requiredParams: ["targetUrl"]
  },
  {
    name: "browser.extract_hardware_benchmarks",
    description:
      "Извлечь метрики пропускной способности (RPS), перцентили задержек (p50/p95/p99) и аппаратные характеристики (vCPU, ГБ ОЗУ) с точными смещениями UTF-16.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.compare_benchmark_throughput",
    description:
      "Сравнить пропускную способность (RPS) и задержку p95 между вариантами по верифицированным снимкам с отклонением голых ссылок.",
    requiredParams: ["submissions"]
  },
  {
    name: "browser.observe_live_stream_batch",
    description:
      "Принять пакет кадров Server-Sent Events (SSE) или WebSocket на вкладке, обновить версионный снимок и вернуть UTF-16 оффсеты кадров.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.normalize_search_query_layout",
    description:
      "Автоматически исправить ошибочную раскладку клавиатуры QWERTY <-> ЙЦУКЕН в поисковом запросе или команде (например, ghjljk;ftv -> продолжаем) с сохранением латинских технических терминов.",
    requiredParams: ["query"]
  },
  {
    name: "browser.search_layout_resilient",
    description:
      "Нормализовать раскладку запроса и выполнить поиск через подключённый поисковый адаптер с сохранением исходного и нормализованного запроса.",
    requiredParams: ["query"]
  },
  {
    name: "browser.evaluate_iframe_sandbox_and_csp",
    description:
      "Проверить директивы Content-Security-Policy и атрибуты песочницы <iframe sandbox> на странице на предмет рисков выхода из песочницы или перехвата навигации.",
    requiredParams: ["pageUrl"]
  },
  {
    name: "browser.export_asciidoc_rst_report",
    description:
      "Экспортировать отчёт многосайтового исследования в инженерные форматы AsciiDoc (.adoc) и reStructuredText (.rst) через workspace-service.",
    requiredParams: ["report"]
  },
  {
    name: "browser.export_csl_ris_bibliography",
    description:
      "Экспортировать библиографию исследования в форматы CSL-JSON (.json) и RIS (.ris) с UTF-16 выдержками и триадой дат через workspace-service.",
    requiredParams: ["report"]
  },
  {
    name: "browser.export_junit_tap_report",
    description:
      "Экспортировать верификационный отчёт исследования в форматы JUnit XML (.xml) и TAP v14 (.tap) через workspace-service.",
    requiredParams: ["report"]
  },
  {
    name: "browser.export_ro_crate",
    description:
      "Экспортировать исследовательский пакет в стандарт W3C RO-Crate 1.1 JSON-LD (ro-crate-metadata.json) с UTF-16 Quotation и триадой дат через workspace-service.",
    requiredParams: ["report"]
  },
  {
    name: "browser.export_mermaid_knowledge_graph",
    description:
      "Построить граф знаний происхождения утверждений и визуальные диаграммы Mermaid (flowchart LR + timeline дат источников) и сохранить через workspace-service.",
    requiredParams: ["report"]
  },
  {
    name: "browser.export_sarif_audit",
    description:
      "Экспортировать эпистемический аудит исследования в формат OASIS SARIF 2.1.0 (.sarif.json) и отчёт валидации JSON Schema с UTF-16 charOffset/charLength.",
    requiredParams: ["report"]
  },
  {
    name: "browser.export_latex_dossier",
    description:
      "Экспортировать академическое досье исследования в формат LaTeX (.tex) и синхронизированный BibTeX (.bib) с UTF-16 выдержками через workspace-service.",
    requiredParams: ["report"]
  },
  {
    name: "browser.audit_session_compliance",
    description:
      "Провести аудит исследовательской сессии по всем требованиям спецификации и выпустить подписанный SHA-256 сертификат соответствия.",
    requiredParams: ["report"]
  },
  {
    name: "browser.export_executive_brief",
    description:
      "Построить и сохранить исполнительное резюме и атомарные карточки верифицированных утверждений (Atomic Claim Cards) с UTF-16 выдержками.",
    requiredParams: ["report"]
  },
  {
    name: "browser.build_contradiction_matrix",
    description:
      "Построить и сохранить матрицу разрешения противоречий по приоритету eventDate > pageDate > fetchedAt.",
    requiredParams: ["claims"]
  },
  {
    name: "browser.read_long_page",
    description:
      "Прочитать окно длинной или динамической страницы по смещениям UTF-16 с сохранением версионности и границ.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.read_dynamic_page",
    description:
      "Пошагово раскрыть динамическую страницу или бесконечную прокрутку с проверкой сохранности смещений UTF-16.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.build_heading_outline",
    description:
      "Построить оглавление заголовков (h1..h6 / разделов) длинной страницы с точными границами смещений UTF-16.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.jump_to_section",
    description:
      "Перейти непосредственно к нужному разделу длинной страницы по заголовку и получить его текст и границы UTF-16.",
    requiredParams: ["tabId", "headingQuery"]
  },
  {
    name: "browser.extract_section_excerpt",
    description:
      "Извлечь верифицированную UTF-16 выдержку строго внутри выбранного раздела длинной страницы.",
    requiredParams: ["tabId", "headingQuery", "searchTerm"]
  },
  {
    name: "browser.find_in_page",
    description:
      "Найти все вхождения фразы на странице с точными смещениями UTF-16 и контекстным окном.",
    requiredParams: ["tabId", "query"]
  },
  {
    name: "browser.promote_find_occurrence",
    description:
      "Преобразовать выбранное вхождение поиска по странице в верифицированную UTF-16 выдержку.",
    requiredParams: ["tabId", "query", "occurrenceIndex"]
  },
  {
    name: "browser.validate_excerpt_context",
    description:
      "Проверить целостность численных/словесных границ UTF-16 выдержки и отсутствие маркеров устаревания или отрицания в окружающем контексте.",
    requiredParams: ["tabId", "excerpt"]
  },
  {
    name: "browser.extract_structured_matrix",
    description:
      "Извлечь структурированные ячейки сравнения (вариант, критерий, значение) из HTML таблиц <table> и списков <dl>/<dt>/<dd> с точными смещениями UTF-16.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.evaluate_decision_matrix",
    description:
      "Вычислить многокритериальную матрицу выбора и границу Парето только по подтверждённым UTF-16 выдержкам.",
    requiredParams: ["criteriaSpecs", "confirmedClaims"]
  },
  {
    name: "browser.analyze_coverage_gaps",
    description:
      "Проанализировать полноту покрытия матрицы (варианты x критерии) и сформировать целевые дозапросы по неизвестным или конфликтным ячейкам.",
    requiredParams: ["options", "criteria"]
  },
  {
    name: "browser.close_coverage_gaps",
    description:
      "Выполнить итеративный добор недостающих ячеек сравнения через поисковый адаптер и обновить отчёт.",
    requiredParams: ["options", "criteria"]
  },
  {
    name: "browser.archive_offline_evidence",
    description:
      "Сохранить автономный архив доказательств (RFC 2557 MHTML и JSON-пакет снимков) в рабочую папку.",
    requiredParams: ["snapshots"]
  },
  {
    name: "browser.close_and_record_tab",
    description:
      "Закрыть вкладку с сохранением её состояния и истории переходов в буфер восстановления.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.reopen_last_closed_tab",
    description:
      "Восстановить последнюю закрытую вкладку (Ctrl+Shift+T) со снимком и историей переходов.",
    requiredParams: []
  },
  {
    name: "browser.save_tab_session",
    description:
      "Сохранить состояние всех вкладок браузера в рабочую папку.",
    requiredParams: []
  },
  {
    name: "browser.restore_tab_session",
    description:
      "Восстановить сессию вкладок браузера с соблюдением лимита живых вкладок maxLiveTabs.",
    requiredParams: []
  },
  {
    name: "browser.autotune_resources",
    description:
      "Скорректировать лимит живых вкладок и окно чтения по фактическим замерам RAM RSS и латентности p95.",
    requiredParams: []
  },
  {
    name: "browser.redact_privacy_secrets",
    description:
      "Очистить URL и текст от токенов, ключей API и секретов .env перед сохранением отчётов или трасс.",
    requiredParams: []
  },
  {
    name: "browser.verify_api_http_roundtrip",
    description:
      "Выполнить сквозную HTTP-синхронизацию десктопного цикла с маршрутами /api/koswork/browser-research/sessions.",
    requiredParams: ["cycleResult"]
  },
  {
    name: "browser.run_form_wizard",
    description:
      "Выполнить многошаговую форму (wizard) с проверкой ошибок валидации, выбором файлов из разрешённой папки и скачиванием итогового артефакта.",
    requiredParams: ["url", "steps"]
  },
  {
    name: "browser.ingest_downloaded_document",
    description:
      "Преобразовать скачанный документ (.docx, .xlsx, .pdf, .pptx, .csv, .txt) из разрешённой папки в версионный исследовательский снимок с UTF-16 смещениями.",
    requiredParams: ["downloadResult"]
  },
  {
    name: "browser.pin_tab_bookmark",
    description:
      "Закрепить открытую вкладку и верифицированную UTF-16 выдержку в закладках исследования.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.list_pinned_bookmarks",
    description:
      "Получить список закреплённых закладок исследования по категории или тегу.",
    requiredParams: []
  },
  {
    name: "browser.build_plan_from_bookmarks",
    description:
      "Сформировать план многосайтового исследования на основе закреплённых пользователем закладок.",
    requiredParams: []
  },
  {
    name: "browser.research_cycle",
    description:
      "Выполнить многосайтовую исследовательскую процедуру (поиск, открытие, извлечение выдержек, сверка противоречий, сохранение отчёта MD/HTML/таблицы).",
    requiredParams: ["question"]
  },
  {
    name: "browser.research_public_smoke",
    description:
      "Выполнить проверку исследовательского цикла на доступных публичных страницах без входа (отдельно от полной приёмки модели).",
    requiredParams: []
  },
  {
    name: "browser.resume_checkpoint",
    description:
      "Возобновить приостановленный исследовательский цикл из контрольной точки в рабочей папке.",
    requiredParams: ["sessionId"]
  },
  {
    name: "browser.user_highlight_excerpt",
    description:
      "Сохранить выделенный пользователем фрагмент страницы как верифицированную UTF-16 выдержку.",
    requiredParams: ["tabId", "selectedText"]
  },
  {
    name: "browser.reobserve_after_handback",
    description:
      "Обновить наблюдение страницы после возврата управления от пользователя агенту.",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.reverify_report",
    description:
      "Перепроверить и обновить исследовательский отчёт по актуальному состоянию источников.",
    requiredParams: ["previousReportData"]
  },
  {
    name: "browser.diff_reports",
    description:
      "Сравнить две ревизии исследовательского отчёта и сохранить MD/JSON отчёт об изменениях в рабочую папку.",
    requiredParams: ["baselineReport", "currentReport"]
  },
  {
    name: "browser.wake_hibernated_tab",
    description:
      "Восстановить выгруженную фоновую вкладку с условной проверкой свежести снимка (ETag / 304 Not Modified).",
    requiredParams: ["tabId"]
  },
  {
    name: "browser.evidence_vault_ingest",
    description:
      "Сохранить верифицированные утверждения и UTF-16 выдержки в межсессионное хранилище доказательств рабочей папки.",
    requiredParams: ["claims"]
  },
  {
    name: "browser.evidence_vault_query",
    description:
      "Запросить ранее верифицированные утверждения и выдержки из межсессионного хранилища с контролем TTL.",
    requiredParams: []
  },
  {
    name: "browser.export_api_sync_bundle",
    description:
      "Сформировать пакет синхронизации десктопного исследовательского цикла для сохранения в SQLite 0064 / API.",
    requiredParams: ["cycleResult"]
  },
  {
    name: "browser.score_corroboration",
    description:
      "Оценить многосайтовую перекрёстную подтверждённость утверждений (multi-source corroboration) и отсеять голые ссылки без выдержки.",
    requiredParams: ["claims"]
  },
  {
    name: "browser.evaluate_access_restriction",
    description:
      "Оценить статус ограничения доступа (401/403 без обхода, 429 Retry-After, meta-robots).",
    requiredParams: ["httpStatus"]
  },
  {
    name: "browser.verify_replay_audit",
    description:
      "Выполнить детерминированный аудит согласованности отчёта, графа W3C PROV-JSON, трассы HAR 1.2 и UTF-16 снимков страниц.",
    requiredParams: ["savedReports"]
  },
  {
    name: "browser.get_drawer_view_model",
    description:
      "Получить функциональную модель состояния панели исследования браузера (живые/спящие вкладки, пауза CAPTCHA, телеметрия ОЗУ/задержки).",
    requiredParams: []
  }
]);

function createKosworkBrowserShell(options = {}) {
  const engine =
    options.engine ||
    new KosworkBrowserEngine({
      allowedWorkspaceRoot: options.workspaceRoot,
      allowedDownloadDir: options.downloadDir,
      maxLiveTabs: options.maxLiveTabs ?? 3
    });

  const coBrowsing = new KosworkCoBrowsingCoordinator({ engine });
  const tabRevalidator = new KosworkHibernatedTabRevalidator({ engine });
  const pinboard = new KosworkResearchPinboardBridge({ engine });
  const spaObserver = new KosworkSpaRouteObserver({ engine });
  const tabSessionRestorer = new KosworkTabWorkspaceSessionRestorer({
    engine,
    workspaceRoot: options.workspaceRoot || engine.allowedWorkspaceRoot
  });
  const resourceAutotuner = new KosworkAdaptiveResourceAutotuner({
    engine,
    softRssBudgetMb: options.softRssBudgetMb ?? 250,
    softLatencyP95BudgetMs: options.softLatencyP95BudgetMs ?? 120
  });

  async function dispatchToolCall(toolName, args = {}, context = {}) {
    const signal = context.signal || null;
    const resolvedWorkspaceRoot = context.workspaceRoot || engine.allowedWorkspaceRoot;

    switch (toolName) {
      case "browser.search":
        return await engine.searchService.search({
          query: args.query,
          actor: args.actor || "agent",
          page: args.page ?? 1,
          pageSize: args.pageSize ?? 5,
          signal,
          mockOrAdapterResults: args.results || null
        });

      case "browser.decomposed_search":
        return await executeDecomposedSearchAndDeduplicate({
          engine,
          question: args.question,
          options: args.options || [],
          criteria: args.criteria || [],
          actor: args.actor || "agent",
          signal
        });

      case "browser.open_result":
        return await engine.searchService.openSearchResult({
          searchId: args.searchId,
          rank: args.rank,
          url: args.url,
          tabId: args.tabId,
          actor: args.actor || "agent",
          extractQuery: args.extractQuery || null,
          signal
        });

      case "browser.navigate":
        return await engine.navigate({
          tabId: args.tabId,
          url: args.url,
          actor: args.actor || "agent",
          signal
        });

      case "browser.navigate_with_redirects":
        return await navigateWithVerifiedRedirectChain({
          engine,
          tabId: args.tabId,
          initialUrl: args.initialUrl,
          actor: args.actor || "agent",
          maxRedirects: args.maxRedirects ?? 5,
          signal
        });

      case "browser.record_spa_route":
        return spaObserver.recordSpaRouteTransition({
          tabId: args.tabId,
          nextUrl: args.nextUrl,
          transitionKind: args.transitionKind || "pushState",
          nextTitle: args.nextTitle || null,
          nextText: args.nextText ?? null,
          nextHtml: args.nextHtml || null,
          pageDate: args.pageDate,
          eventDate: args.eventDate
        });

      case "browser.extract_citation_links": {
        const obs = engine.observePage(args.tabId);
        const tab = engine.tabs.get(String(args.tabId));
        return extractOutboundCitationLinks(
          obs.snapshot,
          args.rawHtml || tab?.rawSiteDef?.html || ""
        );
      }

      case "browser.follow_primary_citation":
        return await followAndVerifyPrimaryCitation({
          engine,
          sourceTabId: args.sourceTabId,
          rawHtml: args.rawHtml || "",
          anchorOrUrlQuery: args.anchorOrUrlQuery,
          expectedPrimaryPhrase: args.expectedPrimaryPhrase || null,
          primaryTabId: args.primaryTabId || "tab-primary-citation",
          signal
        });

      case "browser.extract_code_blocks": {
        const obs = engine.observePage(args.tabId);
        const tab = engine.tabs.get(String(args.tabId));
        return extractCodeBlocksWithUtf16Offsets(
          obs.snapshot,
          args.rawHtml || tab?.rawSiteDef?.html || ""
        );
      }

      case "browser.extract_hydration_state": {
        const obs = engine.observePage(args.tabId);
        const tab = engine.tabs.get(String(args.tabId));
        return extractAndVerifyHydrationJsonState(
          obs.snapshot,
          args.rawHtml || tab?.rawSiteDef?.html || ""
        );
      }

      case "browser.extract_figures_and_charts": {
        const obs = engine.observePage(args.tabId);
        const tab = engine.tabs.get(String(args.tabId));
        return extractFiguresAndSvgCharts(
          obs.snapshot,
          args.rawHtml || tab?.rawSiteDef?.html || ""
        );
      }

      case "browser.extract_claim_with_footnotes": {
        const obs = engine.observePage(args.tabId);
        return extractClaimWithResolvedFootnotes(obs.snapshot, {
          searchTerm: args.searchTerm
        });
      }

      case "browser.align_bilingual_claims":
        return alignBilingualClaimsForOption(args.claims || []);

      case "browser.inspect_security_posture": {
        const obs = engine.observePage(args.tabId);
        const tab = engine.tabs.get(String(args.tabId));
        return inspectPageSecurityPosture({
          pageUrl: obs.snapshot.url,
          rawHtml: args.rawHtml || tab?.rawSiteDef?.html || ""
        });
      }

      case "browser.extract_aria_tree": {
        const obs = engine.observePage(args.tabId);
        const tab = engine.tabs.get(String(args.tabId));
        const tree = extractAriaAccessibilityTree({
          html: args.rawHtml || tab?.rawSiteDef?.html || "",
          visibleText: obs.snapshot.text || ""
        });
        if (args.role || args.nameQuery) {
          return {
            tree,
            matchedTargets: findInteractiveTargetsByAriaRoleAndName(tree, {
              role: args.role || null,
              nameQuery: args.nameQuery || null,
              includeDisabled: Boolean(args.includeDisabled)
            })
          };
        }
        return { tree, matchedTargets: tree.interactiveControls };
      }

      case "browser.build_multipart_form_payload":
        return buildSafeMultipartFormDataPayload({
          workspaceRoot: resolvedWorkspaceRoot,
          fields: args.fields || {},
          fileAttachments: args.fileAttachments || [],
          boundary: args.boundary
        });

      case "browser.execute_chunked_download":
        return await executeVerifiedChunkedDownload({
          workspaceRoot: resolvedWorkspaceRoot,
          fileName: args.fileName,
          subDir: args.subDir || "downloads",
          chunks: args.chunks || [],
          expectedSha256: args.expectedSha256 || null,
          maxBytes: args.maxBytes ?? 10 * 1024 * 1024,
          signal
        });

      case "browser.compute_tco_model":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveVerifiedTcoComparisonViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            slug: args.slug || "verified-tco-comparison",
            pricingClaims: args.pricingClaims || [],
            seats: args.seats ?? 10,
            annualDiscountPct: args.annualDiscountPct ?? 0,
            signal
          });
        }
        return computeVerifiedMultiYearTcoModel({
          pricingClaims: args.pricingClaims || [],
          seats: args.seats ?? 10,
          annualDiscountPct: args.annualDiscountPct ?? 0
        });

      case "browser.observe_dom_mutation_batch": {
        const domMutationObserver = new KosworkDomMutationBatchObserver({ engine });
        return domMutationObserver.applyMutationBatchAndReanchor({
          tabId: args.tabId,
          mutations: args.mutations || [],
          nextText: args.nextText ?? null,
          nextHtml: args.nextHtml ?? null,
          trackedExcerpts: args.trackedExcerpts || []
        });
      }

      case "browser.ingest_feed_sources":
        if (args.openEntries) {
          return await ingestFeedAndOpenTopEntries({
            engine,
            rawXml: args.rawXml || "",
            queryFilter: args.queryFilter || "",
            maxEntriesToOpen: args.maxEntriesToOpen ?? 3,
            extractSearchTerm: args.extractSearchTerm || null,
            signal
          });
        }
        return parseRssAtomOrSitemapFeed(args.rawXml || "", {
          allowLocalLoopback: engine.allowLocalLoopback !== false
        });

      case "browser.paste_clipboard_into_control":
        return executeSafeClipboardPasteIntoControl({
          engine,
          tabId: args.tabId,
          selector: args.selector,
          clipboardText: args.clipboardText || "",
          observedPageVersion: args.observedPageVersion ?? null,
          observedUserEpoch: args.observedUserEpoch ?? null,
          redactSecrets: Boolean(args.redactSecrets)
        });

      case "browser.drop_workspace_files":
        return executeSafeWorkspaceFileDrop({
          engine,
          tabId: args.tabId,
          selector: args.selector,
          candidateFilePaths: args.candidateFilePaths || [],
          observedPageVersion: args.observedPageVersion ?? null,
          observedUserEpoch: args.observedUserEpoch ?? null
        });

      case "browser.extract_api_and_graphql_specs": {
        const obs = engine.observePage(args.tabId);
        return extractApiEndpointsAndGraphqlSchemas(obs.snapshot);
      }

      case "browser.verify_api_spec_claim": {
        if (args.bareLinkOnly) {
          return verifyApiSpecClaimAgainstEndpointTable({
            bareLinkOnly: true
          });
        }
        const obs = engine.observePage(args.tabId);
        return verifyApiSpecClaimAgainstEndpointTable({
          snapshot: obs.snapshot,
          requiredMethod: args.requiredMethod || "GET",
          requiredRouteSubstring: args.requiredRouteSubstring || "",
          bareLinkOnly: false
        });
      }

      case "browser.profile_tab_network_waterfall": {
        const profiler = new KosworkTabNetworkWaterfallProfiler();
        for (const ev of args.events || []) {
          profiler.recordNavigationWaterfall(ev);
        }
        return profiler.buildWaterfallSummary({
          slowOriginThresholdMs: args.slowOriginThresholdMs ?? 80
        });
      }

      case "browser.extract_sla_and_compliance": {
        const obs = engine.observePage(args.tabId);
        return extractSlaCommitmentsAndLegalClauses(obs.snapshot);
      }

      case "browser.compare_vendor_slas":
        return compareSlaCommitmentsAcrossVendors(args.vendorSubmissions || []);

      case "browser.analyze_semver_changelog": {
        const obs = engine.observePage(args.tabId);
        return extractSemverReleaseChangelog(obs.snapshot);
      }

      case "browser.verify_semver_feature_status": {
        const obs = engine.observePage(args.tabId);
        return verifyBreakingChangesAndDeprecationsAcrossVersions({
          snapshot: obs.snapshot,
          featureKeyword: args.featureKeyword || ""
        });
      }

      case "browser.verify_download_magic_bytes":
        return verifyDownloadContentDispositionAndMagicBytes({
          workspaceRoot: resolvedWorkspaceRoot,
          subDir: args.subDir || "downloads",
          contentDispositionHeader: args.contentDispositionHeader || "",
          fallbackFilename: args.fallbackFilename || "download.txt",
          declaredMimeType: args.declaredMimeType || "text/plain",
          contentBuffer: args.contentBuffer || Buffer.alloc(0)
        });

      case "browser.extract_tier_quotas": {
        const obs = engine.observePage(args.tabId);
        return extractTierQuotasAndOverageRates(obs.snapshot);
      }

      case "browser.evaluate_workload_quotas":
        return evaluateWorkloadFitAgainstTierQuotas({
          vendorTiers: args.vendorTiers || [],
          requiredStorageGb: args.requiredStorageGb ?? 600
        });

      case "browser.inspect_oauth_sso_redirect": {
        const ssoGuard = new KosworkOAuthSsoPopupAndRedirectGuard({
          engine,
          trustedCallbackOrigins: args.trustedCallbackOrigins || []
        });
        return ssoGuard.inspectRedirectOrPopup({
          tabId: args.tabId || "tab-1",
          currentOriginUrl: args.currentOriginUrl || null,
          targetUrl: args.targetUrl,
          isPopupWindow: Boolean(args.isPopupWindow)
        });
      }

      case "browser.extract_hardware_benchmarks": {
        const obs = engine.observePage(args.tabId);
        return extractHardwareAndPerformanceBenchmarks(obs.snapshot);
      }

      case "browser.compare_benchmark_throughput":
        return compareBenchmarkThroughputAcrossOptions(args.submissions || []);

      case "browser.observe_live_stream_batch": {
        const streamObserver = new KosworkLiveStreamFrameObserver({
          engine,
          maxFramesPerBatch: args.maxFramesPerBatch ?? 50,
          maxStreamBytes: args.maxStreamBytes ?? 256 * 1024
        });
        return streamObserver.ingestStreamBatchIntoTabSnapshot({
          tabId: args.tabId,
          protocol: args.protocol || "sse",
          rawSseWireText: args.rawSseWireText || "",
          frames: args.frames || [],
          signal
        });
      }

      case "browser.normalize_search_query_layout":
        return normalizeKeyboardLayoutAndSearchQuery(args.query || "");

      case "browser.search_layout_resilient":
        return await executeLayoutResilientSearch({
          engine,
          query: args.query || "",
          topK: args.topK ?? 5,
          signal
        });

      case "browser.evaluate_iframe_sandbox_and_csp":
        return evaluateIframeSandboxAndCspDirectives({
          pageUrl: args.pageUrl || "https://corpus.local",
          cspHeader: args.cspHeader || "",
          html: args.html || ""
        });

      case "browser.export_asciidoc_rst_report":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveAsciiDocAndRstReportViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            slug: args.slug || "research-technical-docs",
            report: args.report || {},
            signal
          });
        }
        return renderAsciiDocAndReStructuredTextReport(args.report || {});

      case "browser.export_csl_ris_bibliography":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveCslJsonAndRisBibliographyViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            slug: args.slug || "research-bibliography",
            report: args.report || {},
            signal
          });
        }
        return buildCslJsonAndRisBibliography(args.report || {});

      case "browser.export_junit_tap_report":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveJUnitAndTapVerificationReportViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            slug: args.slug || "research-verification",
            report: args.report || {},
            signal
          });
        }
        return buildJUnitXmlAndTap14ResearchReport(args.report || {});

      case "browser.export_ro_crate":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveRoCrateResearchPackageViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            slug: args.slug || "research-ro-crate",
            report: args.report || {},
            searchAdapterId: args.searchAdapterId,
            searchAdapterName: args.searchAdapterName,
            signal
          });
        }
        return buildRoCrateMetadataDescriptor({
          report: args.report || {},
          searchAdapterId: args.searchAdapterId,
          searchAdapterName: args.searchAdapterName
        });

      case "browser.export_mermaid_knowledge_graph":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveMermaidKnowledgeGraphViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            slug: args.slug || "research-knowledge-graph",
            report: args.report || {},
            signal
          });
        }
        return buildResearchKnowledgeGraphAndMermaidReport(args.report || {});

      case "browser.export_sarif_audit":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveSarifAndJsonSchemaAuditViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            slug: args.slug || "research-epistemic-audit",
            report: args.report || {},
            signal
          });
        }
        return buildSarif210ResearchAuditReport(args.report || {});

      case "browser.export_latex_dossier":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveLatexAcademicDossierViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            slug: args.slug || "research-academic-dossier",
            report: args.report || {},
            signal
          });
        }
        return renderResearchReportLatexDossier(args.report || {});

      case "browser.audit_session_compliance":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveResearchComplianceCertificateViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            slug: args.slug || "research-compliance-certificate",
            searchReceipts: args.searchReceipts || [],
            report: args.report || {},
            resourceMetrics: args.resourceMetrics || {},
            maxLiveTabsLimit: args.maxLiveTabsLimit ?? 3,
            signal
          });
        }
        return auditResearchSessionHealthAndCompliance({
          searchReceipts: args.searchReceipts || [],
          report: args.report || {},
          resourceMetrics: args.resourceMetrics || {},
          maxLiveTabsLimit: args.maxLiveTabsLimit ?? 3
        });

      case "browser.export_executive_brief":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveExecutiveBriefAndClaimCardsViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            slug: args.slug || "research-executive-brief",
            report: args.report || {},
            signal
          });
        }
        return buildExecutiveBriefAndClaimCards(args.report || {});

      case "browser.build_contradiction_matrix":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveContradictionResolutionMatrixViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            slug: args.slug || "contradiction-resolution-matrix",
            claims: args.claims || [],
            signal
          });
        }
        return buildContradictionResolutionMatrix(args.claims || []);

      case "browser.observe":
        return engine.observePage(args.tabId, {
          reuseSnapshot: args.reuseSnapshot !== false
        });

      case "browser.read_long_page":
        return await engine.readLongPage({
          tabId: args.tabId,
          cursorUtf16: args.cursorUtf16 ?? 0,
          windowChars: args.windowChars ?? 4000,
          overlapChars: args.overlapChars ?? 120,
          triggerDynamicScroll: Boolean(args.triggerDynamicScroll),
          signal
        });

      case "browser.read_dynamic_page": {
        const scroller = new KosworkDynamicPageScroller({
          engine,
          maxScrollSteps: args.maxScrollSteps ?? 8
        });
        return await scroller.readIncrementalDynamicPage({
          tabId: args.tabId,
          stepLoaders: args.stepLoaders || [],
          extractTerms: args.extractTerms || [],
          signal
        });
      }

      case "browser.build_heading_outline": {
        const obs = engine.observePage(args.tabId);
        const tab = engine.tabs.get(String(args.tabId));
        return buildDocumentHeadingOutline(obs.snapshot, args.rawHtml || tab?.rawSiteDef?.html || "");
      }

      case "browser.jump_to_section": {
        const obs = engine.observePage(args.tabId);
        const tab = engine.tabs.get(String(args.tabId));
        return jumpToSectionByHeading({
          snapshot: obs.snapshot,
          rawHtml: args.rawHtml || tab?.rawSiteDef?.html || "",
          headingQuery: args.headingQuery
        });
      }

      case "browser.extract_section_excerpt": {
        const obs = engine.observePage(args.tabId);
        const tab = engine.tabs.get(String(args.tabId));
        return extractSectionScopedExcerpt({
          snapshot: obs.snapshot,
          rawHtml: args.rawHtml || tab?.rawSiteDef?.html || "",
          headingQuery: args.headingQuery,
          searchTerm: args.searchTerm
        });
      }

      case "browser.find_in_page": {
        const obs = engine.observePage(args.tabId);
        return findAllOccurrencesInSnapshot(obs.snapshot, {
          query: args.query,
          contextWindowChars: args.contextWindowChars ?? 60,
          maxMatches: args.maxMatches ?? 100
        });
      }

      case "browser.promote_find_occurrence": {
        const obs = engine.observePage(args.tabId);
        return promoteOccurrenceToVerifiedExcerpt(obs.snapshot, {
          query: args.query,
          occurrenceIndex: args.occurrenceIndex ?? 1,
          expandToBlock: args.expandToBlock !== false
        });
      }

      case "browser.validate_excerpt_context": {
        const obs = engine.observePage(args.tabId);
        return validateExcerptContextAndBoundaries(obs.snapshot, args.excerpt, {
          contextWindowChars: args.contextWindowChars ?? 90
        });
      }

      case "browser.extract_structured_matrix": {
        const obs = engine.observePage(args.tabId);
        const tab = engine.tabs.get(String(args.tabId));
        return extractStructuredSpecsFromSnapshot({
          snapshot: obs.snapshot,
          rawHtml: args.rawHtml || tab?.rawSiteDef?.html || "",
          defaultOptionName: args.defaultOptionName || "Option",
          targetOptions: args.targetOptions || [],
          targetCriteria: args.targetCriteria || []
        });
      }

      case "browser.evaluate_decision_matrix":
        return evaluateMultiCriteriaDecisionMatrix({
          options: args.options || [],
          criteriaSpecs: args.criteriaSpecs || [],
          confirmedClaims: args.confirmedClaims || []
        });

      case "browser.analyze_coverage_gaps":
        return analyzeResearchCoverageAndBuildFollowUps({
          question: args.question || "",
          options: args.options || [],
          criteria: args.criteria || [],
          confirmedClaims: args.confirmedClaims || [],
          contradictions: args.contradictions || []
        });

      case "browser.close_coverage_gaps":
        return await executeIterativeGapClosingResearch({
          engine,
          workspaceRoot: resolvedWorkspaceRoot,
          reportSlug: args.reportSlug || "gap-closed-report",
          question: args.question || "",
          options: args.options || [],
          criteria: args.criteria || [],
          initialSources: args.initialSources || [],
          initialClaims: args.initialClaims || [],
          gapExtractionHints: args.gapExtractionHints || [],
          maxFollowUpQueries: args.maxFollowUpQueries ?? 4,
          signal
        });

      case "browser.archive_offline_evidence":
        return await saveOfflineEvidenceBundleToWorkspace({
          workspaceRoot: resolvedWorkspaceRoot,
          bundleSlug: args.bundleSlug || "research-evidence",
          question: args.question || "",
          snapshots: args.snapshots || [],
          confirmedClaims: args.confirmedClaims || [],
          signal
        });

      case "browser.restore_offline_evidence":
        return restoreSnapshotsFromEvidenceBundle(args.bundle || {});

      case "browser.close_and_record_tab":
        return tabSessionRestorer.closeAndRecordTab(
          args.tabId,
          args.reason || "user_or_crash_close"
        );

      case "browser.reopen_last_closed_tab":
        return await tabSessionRestorer.reopenLastClosedTab();

      case "browser.save_tab_session":
        return tabSessionRestorer.saveBrowserSessionToDisk();

      case "browser.restore_tab_session":
        return await tabSessionRestorer.restoreBrowserSessionFromDisk(
          args.targetEngine || engine
        );

      case "browser.autotune_resources":
        return resourceAutotuner.evaluateAndTuneResources({
          simulatedRssMb: args.simulatedRssMb ?? null,
          simulatedP95Ms: args.simulatedP95Ms ?? null
        });

      case "browser.redact_privacy_secrets": {
        const urlRes = args.url ? redactSensitiveUrlParams(args.url) : null;
        const textRes = args.text ? redactSensitiveText(args.text) : null;
        const auditRes = args.payload ? auditPayloadForZeroSecretLeaks(args.payload) : null;
        return {
          urlRedaction: urlRes,
          textRedaction: textRes,
          payloadAudit: auditRes
        };
      }

      case "browser.verify_api_http_roundtrip":
        return await runDesktopToApiHttpRoundtrip({
          cycleResult: args.cycleResult,
          sessionId: args.sessionId || "brs-http-e2e-01"
        });

      case "browser.fill_form":
        return engine.fillForm({
          tabId: args.tabId,
          observedSnapshot: args.observedSnapshot || null,
          tabReceipt: args.tabReceipt || null,
          fields: args.fields || {}
        });

      case "browser.select_files":
        return engine.selectFiles({
          tabId: args.tabId,
          controlId: args.controlId,
          filePaths: args.filePaths || [],
          observedSnapshot: args.observedSnapshot || null
        });

      case "browser.submit_form":
        return await engine.submitForm({
          tabId: args.tabId,
          submitControlId: args.submitControlId || null,
          observedSnapshot: args.observedSnapshot || null
        });

      case "browser.run_form_wizard":
        return await executeMultiStepFormWizard({
          engine,
          tabId: args.tabId || "wizard-tab-1",
          url: args.url,
          steps: args.steps || [],
          finalDownload: args.finalDownload || null,
          signal
        });

      case "browser.download":
        return await engine.downloadFromPage({
          tabId: args.tabId,
          downloadControlId: args.downloadControlId || null,
          filename: args.filename || "download.txt",
          content: args.content
        });

      case "browser.ingest_downloaded_document":
        return ingestMultiFormatDownloadedDocument(args.downloadResult, {
          allowedWorkspaceRoot: resolvedWorkspaceRoot,
          pageDate: args.pageDate || null,
          eventDate: args.eventDate || null,
          sourceUrl: args.sourceUrl || null
        });

      case "browser.pin_tab_bookmark":
        return pinboard.pinTabToResearchBookmarks({
          tabId: args.tabId,
          category: args.category || "research",
          tags: args.tags || [],
          optionName: args.optionName || null,
          criterion: args.criterion || null,
          searchTerm: args.searchTerm || null
        });

      case "browser.list_pinned_bookmarks":
        return pinboard.listPinnedResearchSources({
          category: args.category || null,
          tag: args.tag || null
        });

      case "browser.build_plan_from_bookmarks":
        return pinboard.buildResearchPlanFromPinnedBookmarks({
          question: args.question || "Сравнение по закладкам исследования",
          category: args.category || "research",
          tag: args.tag || null,
          defaultCriteria: args.defaultCriteria || ["Спецификация"]
        });

      case "browser.research_cycle":
        return await executeMultiSiteResearchWorkflow({
          engine,
          workspaceRoot: resolvedWorkspaceRoot,
          workspaceService: context.workspaceService || null,
          workExecutor: context.workExecutor || null,
          plan: args,
          signal
        });

      case "browser.research_public_smoke":
        return await runPublicUnauthenticatedWebSmoke({
          engine,
          workspaceRoot: resolvedWorkspaceRoot,
          publicPages: args.publicPages || null,
          reportSlug: args.reportSlug || "public-unauthenticated-web-smoke"
        });

      case "browser.resume_checkpoint": {
        const cpManager = new KosworkResearchSessionCheckpointManager({
          workspaceRoot: resolvedWorkspaceRoot
        });
        return await cpManager.resumeResearchFromCheckpoint({
          sessionId: args.sessionId,
          engine,
          signal
        });
      }

      case "browser.user_highlight_excerpt":
        return coBrowsing.captureUserHighlightedExcerpt({
          tabId: args.tabId,
          selectedText: args.selectedText
        });

      case "browser.reobserve_after_handback":
        return coBrowsing.reobserveAfterUserHandback(args.tabId);

      case "browser.reverify_report":
        return await reverifyAndRefreshResearchReport({
          engine,
          workspaceRoot: resolvedWorkspaceRoot,
          reportSlug: args.reportSlug || "reverified-research-report",
          previousReportData: args.previousReportData,
          recoveryProbes: args.recoveryProbes || [],
          signal
        });

      case "browser.diff_reports":
        if (args.saveToWorkspace && resolvedWorkspaceRoot) {
          return await saveReportDiffViaWorkspace({
            workspaceRoot: resolvedWorkspaceRoot,
            diffSlug: args.diffSlug || "research-report-diff",
            baselineReport: args.baselineReport,
            currentReport: args.currentReport,
            signal
          });
        }
        return compareResearchReports(args.baselineReport, args.currentReport);

      case "browser.wake_hibernated_tab":
        return await tabRevalidator.wakeAndRevalidateTab(args.tabId, {
          forceUpstreamCheck: args.forceUpstreamCheck !== false
        });

      case "browser.evidence_vault_ingest": {
        const vault = new KosworkBrowserEvidenceVault({
          workspaceRoot: resolvedWorkspaceRoot
        });
        return vault.ingestVerifiedClaims(args.claims || [], {
          sessionId: args.sessionId || null,
          nowMs: args.nowMs ?? Date.now()
        });
      }

      case "browser.evidence_vault_query": {
        const vault = new KosworkBrowserEvidenceVault({
          workspaceRoot: resolvedWorkspaceRoot
        });
        return vault.queryVerifiedEvidence({
          optionName: args.optionName || null,
          criterion: args.criterion || null,
          url: args.url || null,
          maxAgeMs: args.maxAgeMs ?? 300_000,
          nowMs: args.nowMs ?? Date.now()
        });
      }

      case "browser.export_api_sync_bundle":
        return buildApiSyncBundleFromDesktopCycle(args.cycleResult, {
          sessionId: args.sessionId || null,
          question: args.question || null,
          criteria: args.criteria || null
        });

      case "browser.score_corroboration":
        return scoreMultiSourceCorroboration(args.claims || []);

      case "browser.evaluate_access_restriction":
        return evaluateAccessRestrictionDecision({
          httpStatus: args.httpStatus,
          html: args.html || "",
          headers: args.headers || {}
        });

      case "browser.verify_replay_audit":
        return verifyDeterministicResearchReplay({
          savedReports: args.savedReports,
          provJsonObject: args.provJsonObject || null,
          harLog: args.harLog || null,
          snapshotsByUrl: args.snapshotsByUrl || {}
        });

      case "browser.get_drawer_view_model":
        return buildBrowserResearchDrawerViewModel(engine);

      case "browser.cancel":
        return engine.resourceGovernor.cancelAllTasks(args.reason || "cancelled_via_shell");

      default: {
        const err = new Error(`UNKNOWN_BROWSER_TOOL: ${toolName}`);
        err.code = "UNKNOWN_BROWSER_TOOL";
        throw err;
      }
    }
  }

  return {
    engine,
    coBrowsing,
    tabRevalidator,
    pinboard,
    spaObserver,
    tabSessionRestorer,
    resourceAutotuner,
    toolDefinitions: BROWSER_RESEARCH_TOOL_DEFINITIONS,
    dispatchToolCall
  };
}

module.exports = {
  BROWSER_RESEARCH_TOOL_DEFINITIONS,
  createKosworkBrowserShell
};
