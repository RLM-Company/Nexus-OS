import React, { useState } from "react";
import {
  BUILT_IN_KOSMORA_EVALUATION_SUITES,
  type EvaluationAuditEvent,
  type EvaluationCriterionSeverity,
  type EvaluationGraderType,
  type EvaluationRun,
  type EvaluationRunVerdict,
  type EvaluationSuite,
  type QualityGateCheckResult,
  type QualityGatePolicy
} from "@cosmora/core";

export const KOSMORA_EVALUATIONS_MONOCHROME_PALETTE = {
  background_primary: "#0A0A0A",
  surface_elevated: "#111111",
  border_subtle: "#262626",
  text_primary: "#FAFAFA",
  text_secondary: "#A3A3A3"
} as const;

export const GRADER_TYPE_LABELS_RU: Record<EvaluationGraderType, string> = {
  required_sections: "ОБЯЗАТЕЛЬНЫЕ РАЗДЕЛЫ",
  citation_count: "ЦИТИРОВАНИЕ И ИСТОЧНИКИ",
  forbidden_phrases: "ЗАПРЕЩЁННЫЕ МАРКЕРЫ",
  length_bounds: "ГРАНИЦЫ ОБЪЁМА ТЕКСТА",
  budget_efficiency: "ЭФФЕКТИВНОСТЬ БЮДЖЕТА",
  json_schema_keys: "КЛЮЧИ JSON-СХЕМЫ",
  deterministic_pattern: "РЕГУЛЯРНЫЙ ШАБЛОН",
  task_completion_rate: "ПОЛНОТА ЗАДАЧ МИССИИ"
};

export const VERDICT_LABELS_RU: Record<EvaluationRunVerdict, string> = {
  passed: "ПРОЙДЕНО (PASSED)",
  failed: "НЕ ПРОЙДЕНО (FAILED)",
  blocked_by_critical: "БЛОКИРОВКА: КРИТИЧЕСКИЙ КРИТЕРИЙ",
  error: "ОШИБКА ВЫПОЛНЕНИЯ"
};

export const SEVERITY_LABELS_RU: Record<EvaluationCriterionSeverity, string> = {
  critical: "КРИТИЧЕСКИЙ",
  warning: "ПРЕДУПРЕЖДЕНИЕ",
  info: "ИНФОРМАЦИОННЫЙ"
};

export interface EvaluationsViewModel {
  theme: typeof KOSMORA_EVALUATIONS_MONOCHROME_PALETTE;
  mode: "active" | "empty" | "loading" | "error" | "regression_blocked";
  error_message: string | null;
  filter_tab: "all" | "built_in" | "project" | "runs" | "gates";
  suites: EvaluationSuite[];
  selected_suite: EvaluationSuite | null;
  runs: EvaluationRun[];
  selected_run: EvaluationRun | null;
  quality_gate_policies: QualityGatePolicy[];
  latest_gate_check: QualityGateCheckResult | null;
  audit_events: EvaluationAuditEvent[];
}

export function buildEvaluationsViewModel(options?: {
  mode?: EvaluationsViewModel["mode"];
  error_message?: string;
  filter_tab?: EvaluationsViewModel["filter_tab"];
  suites?: EvaluationSuite[];
  selected_suite_id?: string;
  runs?: EvaluationRun[];
  selected_run_id?: string;
  quality_gate_policies?: QualityGatePolicy[];
  latest_gate_check?: QualityGateCheckResult | null;
  audit_events?: EvaluationAuditEvent[];
}): EvaluationsViewModel {
  const mode = options?.mode ?? "active";
  const nowIso = "2026-10-27T09:30:00.000Z";

  const defaultSuites: EvaluationSuite[] =
    mode === "empty" || mode === "loading"
      ? []
      : BUILT_IN_KOSMORA_EVALUATION_SUITES.map((s) => ({
          ...s,
          tenant_id: "tenant_default",
          project_id: null,
          owner_id: "system_kosmora",
          visibility: "built_in" as const,
          status: "active" as const,
          version: 1,
          created_at: nowIso,
          updated_at: nowIso,
          archived_at: null
        }));

  const suites = options?.suites ?? defaultSuites;
  const selectedSuite =
    suites.find((s) => s.id === options?.selected_suite_id) ??
    suites[0] ??
    null;

  const defaultRuns: EvaluationRun[] =
    mode === "empty" || mode === "loading"
      ? []
      : mode === "regression_blocked"
        ? [
            {
              id: "evr_benchmark_v2_regressed",
              suite_id: "evl_builtin_analytical_report",
              suite_version: 1,
              tenant_id: "tenant_default",
              project_id: "proj_default",
              target_kind: "playbook",
              mission_id: "msn_bench_edtech_v2",
              playbook_id: "pbk_builtin_market_research",
              playbook_version_id: "pbv_v2",
              playbook_version_number: 2,
              baseline_run_id: "evr_benchmark_v1_baseline",
              overall_score: 62.5,
              passing_score_threshold: 82,
              verdict: "blocked_by_critical",
              critical_failures_count: 1,
              criteria_results: [
                {
                  criterion_key: "exec_summary_sections",
                  label: "Полнота обязательных разделов",
                  grader_type: "required_sections",
                  severity: "critical",
                  weight: 30,
                  passed: true,
                  raw_score: 100,
                  weighted_score: 30,
                  reason: "Присутствуют все обязательные разделы (5/5)",
                  evidence_snippets: ["Найден раздел: «Методология»"]
                },
                {
                  criterion_key: "no_placeholder_markers",
                  label: "Отсутствие черновых заглушек",
                  grader_type: "forbidden_phrases",
                  severity: "critical",
                  weight: 20,
                  passed: false,
                  raw_score: 0,
                  weighted_score: 0,
                  reason: "Обнаружены запрещённые фразы/заглушки: TODO",
                  evidence_snippets: ["Запрещённый маркер: «TODO»"]
                }
              ],
              test_case_results: [
                {
                  test_case_id: "tc_edtech_cis",
                  test_case_title: "Рынок EdTech в СНГ",
                  resulting_mission_id: "msn_bench_edtech_v2",
                  passed: false,
                  score: 62.5,
                  critical_failures_count: 1,
                  budget_spent: 16.0,
                  criteria_results: [],
                  missing_expected_substrings: [],
                  found_forbidden_substrings: ["TODO"]
                }
              ],
              score_delta: -33.5,
              regression_detected: true,
              regression_summary:
                "Регрессия относительно базового прогона 'evr_benchmark_v1_baseline': балл изменился с 96 до 62.5 (-33.5), вердикт 'passed' -> 'blocked_by_critical'",
              total_budget_spent: 16.0,
              initiated_by: "usr_owner",
              initiated_at: nowIso,
              completed_at: nowIso
            }
          ]
        : [
            {
              id: "evr_benchmark_v1_baseline",
              suite_id: "evl_builtin_analytical_report",
              suite_version: 1,
              tenant_id: "tenant_default",
              project_id: "proj_default",
              target_kind: "playbook",
              mission_id: "msn_bench_edtech_v1",
              playbook_id: "pbk_builtin_market_research",
              playbook_version_id: "pbv_v1",
              playbook_version_number: 1,
              baseline_run_id: null,
              overall_score: 96.0,
              passing_score_threshold: 82,
              verdict: "passed",
              critical_failures_count: 0,
              criteria_results: [
                {
                  criterion_key: "exec_summary_sections",
                  label: "Полнота обязательных разделов",
                  grader_type: "required_sections",
                  severity: "critical",
                  weight: 30,
                  passed: true,
                  raw_score: 100,
                  weighted_score: 30,
                  reason: "Присутствуют все обязательные разделы (5/5)",
                  evidence_snippets: [
                    "Найден раздел: «Методология»",
                    "Найден раздел: «Анализ рынка»"
                  ]
                },
                {
                  criterion_key: "verified_citations",
                  label: "Плотность цитирования источников",
                  grader_type: "citation_count",
                  severity: "warning",
                  weight: 25,
                  passed: true,
                  raw_score: 100,
                  weighted_score: 25,
                  reason: "Найдено источников/ссылок: 3 (минимум 2)",
                  evidence_snippets: [
                    "https://research.kosmora.ai/reports/benchmark-2025"
                  ]
                },
                {
                  criterion_key: "no_placeholder_markers",
                  label: "Отсутствие черновых заглушек",
                  grader_type: "forbidden_phrases",
                  severity: "critical",
                  weight: 20,
                  passed: true,
                  raw_score: 100,
                  weighted_score: 20,
                  reason: "Запрещённые черновые маркеры и заглушки отсутствуют",
                  evidence_snippets: []
                }
              ],
              test_case_results: [
                {
                  test_case_id: "tc_edtech_cis",
                  test_case_title: "Рынок EdTech в СНГ",
                  resulting_mission_id: "msn_bench_edtech_v1",
                  passed: true,
                  score: 96.0,
                  critical_failures_count: 0,
                  budget_spent: 16.0,
                  criteria_results: [],
                  missing_expected_substrings: [],
                  found_forbidden_substrings: []
                }
              ],
              score_delta: 4.5,
              regression_detected: false,
              regression_summary:
                "Сравнение с базовым прогоном: дельта +4.5 п. (без регрессии)",
              total_budget_spent: 16.0,
              initiated_by: "usr_owner",
              initiated_at: nowIso,
              completed_at: nowIso
            }
          ];

  const runs = options?.runs ?? defaultRuns;
  const selectedRun =
    runs.find((r) => r.id === options?.selected_run_id) ?? runs[0] ?? null;

  const defaultPolicies: QualityGatePolicy[] =
    mode === "empty" || mode === "loading"
      ? []
      : [
          {
            id: "qgp_market_research_release",
            tenant_id: "tenant_default",
            project_id: "proj_default",
            playbook_id: "pbk_builtin_market_research",
            required_suite_ids: ["evl_builtin_analytical_report"],
            min_overall_score: 85,
            allow_critical_failures: false,
            max_regression_drop: 5,
            enforce_on_publish: true,
            enforce_on_schedule_activation: true,
            status: "active",
            version: 1,
            created_by: "usr_owner",
            created_at: nowIso,
            updated_at: nowIso
          }
        ];

  const defaultGateCheck: QualityGateCheckResult | null =
    mode === "empty" || mode === "loading"
      ? null
      : mode === "regression_blocked"
        ? {
            playbook_id: "pbk_builtin_market_research",
            playbook_version_number: 2,
            policy_id: "qgp_market_research_release",
            allowed: false,
            blocking_reasons: [
              "Балл по набору «Эталон качества аналитического исследования» (62.5) ниже минимального порога Quality Gate (85)",
              "Обнаружены критические нарушения (1) в наборе «Эталон качества аналитического исследования»",
              "Обнаружена регрессия качества (-33.5 п.) в наборе «Эталон качества аналитического исследования», превышающая допустимое падение (-5 п.)"
            ],
            suite_summaries: [
              {
                suite_id: "evl_builtin_analytical_report",
                suite_title: "Эталон качества аналитического исследования",
                latest_run_id: "evr_benchmark_v2_regressed",
                overall_score: 62.5,
                verdict: "blocked_by_critical",
                passed_gate: false
              }
            ],
            checked_at: nowIso
          }
        : {
            playbook_id: "pbk_builtin_market_research",
            playbook_version_number: 1,
            policy_id: "qgp_market_research_release",
            allowed: true,
            blocking_reasons: [],
            suite_summaries: [
              {
                suite_id: "evl_builtin_analytical_report",
                suite_title: "Эталон качества аналитического исследования",
                latest_run_id: "evr_benchmark_v1_baseline",
                overall_score: 96.0,
                verdict: "passed",
                passed_gate: true
              }
            ],
            checked_at: nowIso
          };

  return {
    theme: KOSMORA_EVALUATIONS_MONOCHROME_PALETTE,
    mode,
    error_message:
      options?.error_message ??
      (mode === "error"
        ? "Не удалось загрузить результаты оценки качества. Проверьте подключение к БД."
        : null),
    filter_tab: options?.filter_tab ?? "all",
    suites,
    selected_suite: selectedSuite,
    runs,
    selected_run: selectedRun,
    quality_gate_policies: options?.quality_gate_policies ?? defaultPolicies,
    latest_gate_check:
      options?.latest_gate_check !== undefined
        ? options.latest_gate_check
        : defaultGateCheck,
    audit_events: options?.audit_events ?? []
  };
}

export function KosmoraEvaluationsPanel(props: {
  viewModel?: EvaluationsViewModel;
}): React.ReactElement {
  const vm = props.viewModel ?? buildEvaluationsViewModel({ mode: "active" });
  const [activeTab, setActiveTab] = useState<EvaluationsViewModel["filter_tab"]>(
    vm.filter_tab
  );
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>(
    vm.selected_suite?.id ?? ""
  );

  const activeSuite =
    vm.suites.find((s) => s.id === selectedSuiteId) ?? vm.selected_suite;

  return (
    <section
      aria-label="Kosmora Оценка качества и Quality Gates"
      style={{
        backgroundColor: vm.theme.background_primary,
        color: vm.theme.text_primary,
        border: `1px solid ${vm.theme.border_subtle}`,
        borderRadius: "10px",
        padding: "24px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "16px",
          borderBottom: `1px solid ${vm.theme.border_subtle}`,
          paddingBottom: "18px",
          marginBottom: "20px"
        }}
      >
        <div>
          <div
            style={{
              fontSize: "11px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: vm.theme.text_secondary,
              marginBottom: "6px"
            }}
          >
            KOSMORA EVALUATIONS & QUALITY GATES
          </div>
          <h2 style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}>
            Оценка качества миссий, эталонные бенчмарки и релизные Quality Gates
          </h2>
          <p
            style={{
              color: vm.theme.text_secondary,
              fontSize: "13px",
              marginTop: "6px",
              marginBottom: 0
            }}
          >
            Многокритериальные рубрики проверки артефактов, тестирование версий
            плейбуков на эталонных кейсах (Golden Dataset) и автоматическая
            блокировка регрессий.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {(
            [
              { key: "all", label: "Все наборы" },
              { key: "built_in", label: "Встроенные эталоны" },
              { key: "runs", label: "Журнал прогонов" },
              { key: "gates", label: "Quality Gates" }
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                backgroundColor:
                  activeTab === tab.key
                    ? vm.theme.text_primary
                    : vm.theme.surface_elevated,
                color:
                  activeTab === tab.key
                    ? vm.theme.background_primary
                    : vm.theme.text_primary,
                border: `1px solid ${vm.theme.border_subtle}`,
                borderRadius: "6px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {vm.mode === "loading" && (
        <div
          style={{
            backgroundColor: vm.theme.surface_elevated,
            border: `1px solid ${vm.theme.border_subtle}`,
            borderRadius: "8px",
            padding: "24px",
            color: vm.theme.text_secondary,
            fontSize: "14px"
          }}
        >
          Загрузка наборов оценки, рубрик и истории бенчмарков...
        </div>
      )}

      {vm.mode === "error" && (
        <div
          role="alert"
          style={{
            backgroundColor: vm.theme.surface_elevated,
            border: `1px solid ${vm.theme.text_primary}`,
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "20px"
          }}
        >
          <strong style={{ display: "block", marginBottom: "6px" }}>
            Ошибка подсистемы оценки качества
          </strong>
          <span style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            {vm.error_message}
          </span>
        </div>
      )}

      {vm.mode === "empty" && (
        <div
          style={{
            backgroundColor: vm.theme.surface_elevated,
            border: `1px solid ${vm.theme.border_subtle}`,
            borderRadius: "8px",
            padding: "28px",
            textAlign: "center"
          }}
        >
          <h3 style={{ fontSize: "16px", marginTop: 0 }}>
            Наборы оценки качества пока не созданы
          </h3>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Создайте первый набор критериев (Rubric Suite) или выберите
            встроенный шаблон для проверки артефактов миссий и плейбуков.
          </p>
        </div>
      )}

      {vm.latest_gate_check && !vm.latest_gate_check.allowed && (
        <div
          role="alert"
          style={{
            backgroundColor: vm.theme.surface_elevated,
            border: `1px solid ${vm.theme.text_primary}`,
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "20px"
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "6px"
            }}
          >
            БЛОКИРОВКА РЕЛИЗА QUALITY GATE — ПЛЕЙБУК{" "}
            {vm.latest_gate_check.playbook_id} (v
            {vm.latest_gate_check.playbook_version_number ?? "latest"})
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: "18px",
              color: vm.theme.text_secondary,
              fontSize: "13px"
            }}
          >
            {vm.latest_gate_check.blocking_reasons.map((reason, idx) => (
              <li key={idx} style={{ marginBottom: "4px" }}>
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {vm.suites.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(260px, 1fr) minmax(380px, 2fr)",
            gap: "20px"
          }}
        >
          {/* Левая колонка: Каталог наборов оценки */}
          <div
            style={{
              backgroundColor: vm.theme.surface_elevated,
              border: `1px solid ${vm.theme.border_subtle}`,
              borderRadius: "8px",
              padding: "16px"
            }}
          >
            <h3
              style={{
                fontSize: "14px",
                fontWeight: 600,
                marginTop: 0,
                marginBottom: "12px"
              }}
            >
              Наборы критериев ({vm.suites.length})
            </h3>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "10px" }}
            >
              {vm.suites.map((suite) => {
                const isSelected = activeSuite?.id === suite.id;
                return (
                  <div
                    key={suite.id}
                    onClick={() => setSelectedSuiteId(suite.id)}
                    style={{
                      border: `1px solid ${
                        isSelected
                          ? vm.theme.text_primary
                          : vm.theme.border_subtle
                      }`,
                      borderRadius: "6px",
                      padding: "12px",
                      cursor: "pointer",
                      backgroundColor: vm.theme.background_primary
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "4px"
                      }}
                    >
                      <strong style={{ fontSize: "13px" }}>{suite.title}</strong>
                      <span
                        style={{
                          fontSize: "10px",
                          padding: "2px 6px",
                          border: `1px solid ${vm.theme.border_subtle}`,
                          borderRadius: "4px",
                          color: vm.theme.text_secondary
                        }}
                      >
                        {suite.visibility === "built_in"
                          ? "BUILT-IN"
                          : "PROJECT"}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: vm.theme.text_secondary,
                        marginBottom: "8px"
                      }}
                    >
                      {suite.description}
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        color: vm.theme.text_secondary,
                        display: "flex",
                        gap: "12px"
                      }}
                    >
                      <span>Порог: {suite.passing_score_threshold}/100</span>
                      <span>Критериев: {suite.criteria.length}</span>
                      <span>Эталонов: {suite.golden_test_cases.length}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Правая колонка: Рубрика выбранного набора, эталонные кейсы и результаты прогона */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {activeSuite && (
              <div
                style={{
                  backgroundColor: vm.theme.surface_elevated,
                  border: `1px solid ${vm.theme.border_subtle}`,
                  borderRadius: "8px",
                  padding: "18px"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "12px"
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>
                      Рубрика: {activeSuite.title}
                    </h3>
                    <div
                      style={{
                        fontSize: "12px",
                        color: vm.theme.text_secondary,
                        marginTop: "4px"
                      }}
                    >
                      Slug: <code>{activeSuite.slug}</code> | Проходной балл:{" "}
                      <strong>{activeSuite.passing_score_threshold}</strong> из
                      100 | Блокировка при провале Critical:{" "}
                      <strong>
                        {activeSuite.block_on_critical_criteria ? "Да" : "Нет"}
                      </strong>
                    </div>
                  </div>
                </div>

                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "12px"
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: `1px solid ${vm.theme.border_subtle}`,
                        textAlign: "left",
                        color: vm.theme.text_secondary
                      }}
                    >
                      <th style={{ padding: "8px 6px" }}>Критерий</th>
                      <th style={{ padding: "8px 6px" }}>Грейдер</th>
                      <th style={{ padding: "8px 6px" }}>Критичность</th>
                      <th style={{ padding: "8px 6px" }}>Вес</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSuite.criteria.map((c) => (
                      <tr
                        key={c.key}
                        style={{
                          borderBottom: `1px solid ${vm.theme.border_subtle}`
                        }}
                      >
                        <td style={{ padding: "8px 6px" }}>
                          <strong>{c.label}</strong>
                          <div
                            style={{
                              color: vm.theme.text_secondary,
                              fontSize: "11px"
                            }}
                          >
                            {c.description}
                          </div>
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {GRADER_TYPE_LABELS_RU[c.grader_type]}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {SEVERITY_LABELS_RU[c.severity]}
                        </td>
                        <td style={{ padding: "8px 6px" }}>{c.weight}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {vm.selected_run && (
              <div
                style={{
                  backgroundColor: vm.theme.surface_elevated,
                  border: `1px solid ${vm.theme.border_subtle}`,
                  borderRadius: "8px",
                  padding: "18px"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "12px",
                    marginBottom: "12px"
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: "15px", fontWeight: 600, margin: 0 }}>
                      Результат прогона оценки: {vm.selected_run.id}
                    </h3>
                    <div
                      style={{
                        fontSize: "12px",
                        color: vm.theme.text_secondary,
                        marginTop: "4px"
                      }}
                    >
                      Вердикт:{" "}
                      <strong>
                        {VERDICT_LABELS_RU[vm.selected_run.verdict]}
                      </strong>{" "}
                      | Итоговый балл:{" "}
                      <strong>
                        {vm.selected_run.overall_score} / 100
                      </strong>{" "}
                      (порог {vm.selected_run.passing_score_threshold}) |
                      Критических сбоев:{" "}
                      <strong>{vm.selected_run.critical_failures_count}</strong>
                    </div>
                  </div>
                  {vm.selected_run.score_delta !== null && (
                    <div
                      style={{
                        padding: "6px 10px",
                        border: `1px solid ${vm.theme.border_subtle}`,
                        borderRadius: "6px",
                        fontSize: "12px"
                      }}
                    >
                      Дельта к baseline:{" "}
                      <strong>
                        {vm.selected_run.score_delta > 0
                          ? `+${vm.selected_run.score_delta}`
                          : vm.selected_run.score_delta}{" "}
                        п.
                      </strong>{" "}
                      {vm.selected_run.regression_detected
                        ? "— ОБНАРУЖЕНА РЕГРЕССИЯ"
                        : "— СТАБИЛЬНО"}
                    </div>
                  )}
                </div>

                {vm.selected_run.regression_summary && (
                  <p
                    style={{
                      fontSize: "12px",
                      color: vm.theme.text_secondary,
                      marginTop: 0,
                      marginBottom: "12px"
                    }}
                  >
                    {vm.selected_run.regression_summary}
                  </p>
                )}

                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px"
                  }}
                >
                  {vm.selected_run.criteria_results.map((cr) => (
                    <li
                      key={cr.criterion_key}
                      style={{
                        border: `1px solid ${vm.theme.border_subtle}`,
                        borderRadius: "6px",
                        padding: "10px",
                        fontSize: "12px",
                        backgroundColor: vm.theme.background_primary
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: "4px"
                        }}
                      >
                        <strong>
                          [{cr.passed ? "OK" : "FAIL"}] {cr.label}
                        </strong>
                        <span>
                          Балл: {cr.raw_score}/100 (взвеш. {cr.weighted_score})
                        </span>
                      </div>
                      <div style={{ color: vm.theme.text_secondary }}>
                        {cr.reason}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
