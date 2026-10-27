/**
 * @cosmora/contracts — Kosmora Evaluations & Quality Gates Contracts
 * Automated quality evaluation suites, multi-criterion rubric graders,
 * golden test-case regression benchmarks for Playbooks and Mission Control artifacts,
 * and release Quality Gate enforcement.
 */

export const EVALUATION_TARGET_KINDS = [
  "mission",
  "playbook",
  "both"
] as const;

export type EvaluationTargetKind = (typeof EVALUATION_TARGET_KINDS)[number];

export const EVALUATION_SUITE_VISIBILITIES = [
  "private",
  "project",
  "organization",
  "built_in"
] as const;

export type EvaluationSuiteVisibility =
  (typeof EVALUATION_SUITE_VISIBILITIES)[number];

export const EVALUATION_SUITE_STATUSES = [
  "draft",
  "active",
  "archived"
] as const;

export type EvaluationSuiteStatus = (typeof EVALUATION_SUITE_STATUSES)[number];

export const EVALUATION_GRADER_TYPES = [
  "required_sections",
  "citation_count",
  "forbidden_phrases",
  "length_bounds",
  "budget_efficiency",
  "json_schema_keys",
  "deterministic_pattern",
  "task_completion_rate"
] as const;

export type EvaluationGraderType = (typeof EVALUATION_GRADER_TYPES)[number];

export const EVALUATION_CRITERION_SEVERITIES = [
  "info",
  "warning",
  "critical"
] as const;

export type EvaluationCriterionSeverity =
  (typeof EVALUATION_CRITERION_SEVERITIES)[number];

export const EVALUATION_RUN_VERDICTS = [
  "passed",
  "failed",
  "blocked_by_critical",
  "error"
] as const;

export type EvaluationRunVerdict = (typeof EVALUATION_RUN_VERDICTS)[number];

export const QUALITY_GATE_STATUSES = ["active", "disabled"] as const;

export type QualityGateStatus = (typeof QUALITY_GATE_STATUSES)[number];

export const EVALUATION_AUDIT_EVENT_TYPES = [
  "suite_created",
  "suite_updated",
  "suite_archived",
  "mission_evaluated",
  "playbook_benchmark_completed",
  "regression_detected",
  "quality_gate_upserted",
  "quality_gate_checked",
  "quality_gate_blocked"
] as const;

export type EvaluationAuditEventType =
  (typeof EVALUATION_AUDIT_EVENT_TYPES)[number];

export interface EvaluationCriterionConfig {
  required_sections?: string[];
  min_citations?: number;
  forbidden_phrases?: string[];
  min_chars?: number;
  max_chars?: number;
  max_budget_usd?: number;
  required_json_keys?: string[];
  regex_pattern?: string;
  regex_flags?: string;
  min_task_completion_pct?: number;
}

export interface EvaluationCriterion {
  key: string;
  label: string;
  description: string;
  grader_type: EvaluationGraderType;
  severity: EvaluationCriterionSeverity;
  weight: number;
  config: EvaluationCriterionConfig;
}

export interface EvaluationGoldenTestCase {
  id: string;
  title: string;
  description: string;
  variables: Record<string, string | number | boolean>;
  expected_substrings: string[];
  forbidden_substrings: string[];
  max_allowed_budget: number;
}

export interface EvaluationSuite {
  id: string;
  tenant_id: string;
  project_id: string | null;
  owner_id: string;
  slug: string;
  title: string;
  description: string;
  target_kind: EvaluationTargetKind;
  visibility: EvaluationSuiteVisibility;
  status: EvaluationSuiteStatus;
  passing_score_threshold: number;
  block_on_critical_criteria: boolean;
  criteria: EvaluationCriterion[];
  golden_test_cases: EvaluationGoldenTestCase[];
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CriterionEvaluationResult {
  criterion_key: string;
  label: string;
  grader_type: EvaluationGraderType;
  severity: EvaluationCriterionSeverity;
  weight: number;
  passed: boolean;
  raw_score: number;
  weighted_score: number;
  reason: string;
  evidence_snippets: string[];
}

export interface TestCaseEvaluationResult {
  test_case_id: string;
  test_case_title: string;
  resulting_mission_id: string;
  passed: boolean;
  score: number;
  critical_failures_count: number;
  budget_spent: number;
  criteria_results: CriterionEvaluationResult[];
  missing_expected_substrings: string[];
  found_forbidden_substrings: string[];
}

export interface EvaluationRun {
  id: string;
  suite_id: string;
  suite_version: number;
  tenant_id: string;
  project_id: string;
  target_kind: "mission" | "playbook";
  mission_id: string | null;
  playbook_id: string | null;
  playbook_version_id: string | null;
  playbook_version_number: number | null;
  baseline_run_id: string | null;
  overall_score: number;
  passing_score_threshold: number;
  verdict: EvaluationRunVerdict;
  critical_failures_count: number;
  criteria_results: CriterionEvaluationResult[];
  test_case_results: TestCaseEvaluationResult[];
  score_delta: number | null;
  regression_detected: boolean;
  regression_summary: string | null;
  total_budget_spent: number;
  initiated_by: string;
  initiated_at: string;
  completed_at: string;
}

export interface QualityGatePolicy {
  id: string;
  tenant_id: string;
  project_id: string;
  playbook_id: string;
  required_suite_ids: string[];
  min_overall_score: number;
  allow_critical_failures: boolean;
  max_regression_drop: number;
  enforce_on_publish: boolean;
  enforce_on_schedule_activation: boolean;
  status: QualityGateStatus;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface QualityGateCheckResult {
  playbook_id: string;
  playbook_version_number: number | null;
  policy_id: string | null;
  allowed: boolean;
  blocking_reasons: string[];
  suite_summaries: Array<{
    suite_id: string;
    suite_title: string;
    latest_run_id: string | null;
    overall_score: number | null;
    verdict: EvaluationRunVerdict | null;
    passed_gate: boolean;
  }>;
  checked_at: string;
}

export interface EvaluationAuditEvent {
  id: string;
  suite_id: string;
  run_id: string | null;
  tenant_id: string;
  project_id: string;
  actor_id: string;
  event_type: EvaluationAuditEventType;
  details: Record<string, unknown>;
  created_at: string;
}

export interface CreateEvaluationSuiteInput {
  project_id: string;
  slug: string;
  title: string;
  description?: string;
  target_kind?: EvaluationTargetKind;
  visibility?: Exclude<EvaluationSuiteVisibility, "built_in">;
  passing_score_threshold?: number;
  block_on_critical_criteria?: boolean;
  criteria: EvaluationCriterion[];
  golden_test_cases?: EvaluationGoldenTestCase[];
}

export interface UpdateEvaluationSuiteInput {
  expected_version?: number;
  title?: string;
  description?: string;
  passing_score_threshold?: number;
  block_on_critical_criteria?: boolean;
  criteria?: EvaluationCriterion[];
  golden_test_cases?: EvaluationGoldenTestCase[];
  status?: EvaluationSuiteStatus;
}

export interface EvaluateMissionInput {
  suite_id: string;
  mission_id: string;
  baseline_run_id?: string;
}

export interface RunPlaybookBenchmarkInput {
  suite_id: string;
  playbook_id: string;
  playbook_version_number?: number;
  project_id: string;
  execute_missions?: boolean;
  baseline_run_id?: string;
}

export interface UpsertQualityGatePolicyInput {
  project_id: string;
  playbook_id: string;
  required_suite_ids: string[];
  min_overall_score?: number;
  allow_critical_failures?: boolean;
  max_regression_drop?: number;
  enforce_on_publish?: boolean;
  enforce_on_schedule_activation?: boolean;
  status?: QualityGateStatus;
}

export const BUILT_IN_KOSMORA_EVALUATION_SUITES: ReadonlyArray<{
  id: string;
  slug: string;
  title: string;
  description: string;
  target_kind: EvaluationTargetKind;
  passing_score_threshold: number;
  block_on_critical_criteria: boolean;
  criteria: EvaluationCriterion[];
  golden_test_cases: EvaluationGoldenTestCase[];
}> = [
  {
    id: "evl_builtin_analytical_report",
    slug: "analytical-report-quality",
    title: "Эталон качества аналитического исследования",
    description:
      "Проверяет полноту разделов исследования рынка, плотность цитирования источников, отсутствие черновых заглушек (TODO/TBD) и соблюдение бюджета.",
    target_kind: "both",
    passing_score_threshold: 82,
    block_on_critical_criteria: true,
    criteria: [
      {
        key: "exec_summary_sections",
        label: "Полнота обязательных разделов",
        description:
          "Наличие ключевых секций аналитического отчёта: методология, анализ рынка, конкуренты, риски и выводы",
        grader_type: "required_sections",
        severity: "critical",
        weight: 30,
        config: {
          required_sections: [
            "Методология",
            "Анализ рынка",
            "Конкуренты",
            "Риски",
            "Выводы"
          ]
        }
      },
      {
        key: "verified_citations",
        label: "Плотность цитирования источников",
        description: "Наличие минимум 2 верифицированных ссылок или цитат источников",
        grader_type: "citation_count",
        severity: "warning",
        weight: 25,
        config: {
          min_citations: 2
        }
      },
      {
        key: "no_placeholder_markers",
        label: "Отсутствие черновых заглушек",
        description:
          "Запрет незавершённых маркеров TODO, TBD, FIXME, [insert, lorem ipsum",
        grader_type: "forbidden_phrases",
        severity: "critical",
        weight: 20,
        config: {
          forbidden_phrases: ["TODO", "TBD", "FIXME", "[insert", "lorem ipsum"]
        }
      },
      {
        key: "substantial_length",
        label: "Достаточный объём аналитики",
        description: "Объём финального отчёта не менее 120 символов",
        grader_type: "length_bounds",
        severity: "info",
        weight: 10,
        config: {
          min_chars: 120,
          max_chars: 250000
        }
      },
      {
        key: "budget_guard",
        label: "Соблюдение бюджетного лимита",
        description: "Расход миссии не превышает выделенный потолок бюджета",
        grader_type: "budget_efficiency",
        severity: "warning",
        weight: 15,
        config: {
          max_budget_usd: 150
        }
      }
    ],
    golden_test_cases: [
      {
        id: "tc_edtech_cis",
        title: "Рынок EdTech в СНГ",
        description: "Эталонный кейс оценки исследования рынка EdTech",
        variables: {
          project_name: "Kosmora EdTech Radar",
          market: "EdTech",
          country: "СНГ",
          deadline: "2026-12-31",
          budget: 40
        },
        expected_substrings: ["Методология", "Анализ рынка", "Риски"],
        forbidden_substrings: ["TODO", "TBD"],
        max_allowed_budget: 45
      },
      {
        id: "tc_cloud_fintech",
        title: "Рынок FinTech B2B-платежей",
        description: "Эталонный кейс оценки исследования B2B-финтеха",
        variables: {
          project_name: "Kosmora FinTech Pulse",
          market: "FinTech",
          country: "ЕС и СНГ",
          deadline: "2026-11-30",
          budget: 45
        },
        expected_substrings: ["Конкуренты", "Выводы"],
        forbidden_substrings: ["TODO", "FIXME"],
        max_allowed_budget: 50
      }
    ]
  },
  {
    id: "evl_builtin_security_code_audit",
    slug: "repository-security-audit-gate",
    title: "Контроль качества аудита репозитория и ИБ",
    description:
      "Проверяет наличие матрицы уязвимостей, рекомендаций по устранению, отсутствие утечек секретов и 100% завершение задач ревью.",
    target_kind: "both",
    passing_score_threshold: 85,
    block_on_critical_criteria: true,
    criteria: [
      {
        key: "security_sections",
        label: "Разделы аудита безопасности",
        description: "Наличие разделов уязвимостей, архитектуры и рекомендаций",
        grader_type: "required_sections",
        severity: "critical",
        weight: 35,
        config: {
          required_sections: [
            "Уязвимости",
            "Архитектура",
            "Рекомендации по исправлению",
            "Статус проверки"
          ]
        }
      },
      {
        key: "no_unredacted_secrets",
        label: "Отсутствие открытых секретов и заглушек",
        description: "Отсутствие маркеров BEGIN PRIVATE KEY и TODO",
        grader_type: "forbidden_phrases",
        severity: "critical",
        weight: 30,
        config: {
          forbidden_phrases: ["BEGIN RSA PRIVATE KEY", "TODO", "TBD"]
        }
      },
      {
        key: "task_completion_full",
        label: "Завершение всех задач миссии",
        description: "100% задач миссии должны быть доведены до статуса completed",
        grader_type: "task_completion_rate",
        severity: "critical",
        weight: 20,
        config: {
          min_task_completion_pct: 100
        }
      },
      {
        key: "audit_citations",
        label: "Ссылки на проверенные модули и стандарты",
        description: "Минимум 1 ссылка или источник",
        grader_type: "citation_count",
        severity: "info",
        weight: 15,
        config: {
          min_citations: 1
        }
      }
    ],
    golden_test_cases: [
      {
        id: "tc_repo_sec_core",
        title: "Аудит ядра монорепозитория",
        description: "Эталонный прогон аудита безопасности репозитория",
        variables: {
          repo_url: "https://github.com/kosmora-org/nexus-os",
          branch: "main",
          focus_area: "security",
          run_deep_security_scan: true,
          scanner_api_token: "sec_token_demo_12345"
        },
        expected_substrings: ["Уязвимости", "Рекомендации по исправлению"],
        forbidden_substrings: ["BEGIN RSA PRIVATE KEY", "TODO"],
        max_allowed_budget: 60
      }
    ]
  },
  {
    id: "evl_builtin_executive_presentation",
    slug: "executive-presentation-readiness",
    title: "Готовность презентации и питч-дека для руководства",
    description:
      "Проверяет структуру слайдов, тезисы ценности, финансовую модель и отсутствие черновых пометок.",
    target_kind: "both",
    passing_score_threshold: 80,
    block_on_critical_criteria: true,
    criteria: [
      {
        key: "deck_sections",
        label: "Структура ключевых слайдов",
        description: "Наличие разделов проблемы, решения, экономики и дорожной карты",
        grader_type: "required_sections",
        severity: "critical",
        weight: 40,
        config: {
          required_sections: ["Проблема", "Решение", "Экономика", "Дорожная карта"]
        }
      },
      {
        key: "deck_no_placeholders",
        label: "Чистота финального текста слайдов",
        description: "Отсутствие маркеров TODO и [insert",
        grader_type: "forbidden_phrases",
        severity: "critical",
        weight: 30,
        config: {
          forbidden_phrases: ["TODO", "TBD", "[insert"]
        }
      },
      {
        key: "deck_budget_efficiency",
        label: "Эффективность бюджета подготовки",
        description: "Бюджет не превышает $100",
        grader_type: "budget_efficiency",
        severity: "warning",
        weight: 30,
        config: {
          max_budget_usd: 100
        }
      }
    ],
    golden_test_cases: [
      {
        id: "tc_board_deck_q4",
        title: "Стратегическая презентация Q4",
        description: "Проверка генерации структуры презентации для совета директоров",
        variables: {
          topic: "Стратегия развития ИИ-платформы Q4",
          audience: "executives",
          slide_count: 12,
          include_visual_concepts: true
        },
        expected_substrings: ["Проблема", "Решение", "Дорожная карта"],
        forbidden_substrings: ["TODO", "TBD"],
        max_allowed_budget: 60
      }
    ]
  }
];
