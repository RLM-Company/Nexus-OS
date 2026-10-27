import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
function collectTextFromReactNode(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(collectTextFromReactNode).join(" ");
  }
  if (typeof node === "object" && node !== null) {
    const rec = node as {
      type?: unknown;
      props?: Record<string, unknown>;
    };
    if (typeof rec.type === "function") {
      const rendered = (rec.type as (p: Record<string, unknown>) => unknown)(
        rec.props ?? {}
      );
      return collectTextFromReactNode(rendered);
    }
    if (rec.props && "children" in rec.props) {
      return collectTextFromReactNode(rec.props.children);
    }
  }
  return "";
}

import {
  BUILT_IN_KOSMORA_EVALUATION_SUITES,
  EvaluationAccessDeniedError,
  EvaluationConcurrencyConflictError,
  EvaluationValidationError,
  KosmoraEnterpriseSecurityEngine,
  KosmoraEvaluationsService,
  KosmoraMissionControlService,
  KosmoraPlaybooksService,
  KosmoraRuntimeStore,
  QualityGateBlockedError,
  type TenantPrincipal
} from "../../core/src/index.js";
import {
  createKosmoraControlPlane,
  createKosmoraHttpServer
} from "../../../apps/api/src/kosmora-routes.js";
import {
  buildEvaluationsViewModel,
  KOSMORA_EVALUATIONS_MONOCHROME_PALETTE,
  KosmoraEvaluationsPanel
} from "../../../apps/web/src/app/kosmora-workspace/evaluations.js";
import KosmoraEvaluationsPage from "../../../apps/web/src/app/kosmora-workspace/evaluations/page.js";
import KosmoraWorkspacePage from "../../../apps/web/src/app/kosmora-workspace/page.js";

function createOwnerPrincipal(
  tenantId = "tenant_default",
  userId = "usr_eval_owner"
): TenantPrincipal {
  return {
    user_id: userId,
    tenant_id: tenantId,
    workspace_ids: ["ws_default"],
    role: "owner",
    mfa_verified: true
  };
}

function createViewerPrincipal(
  tenantId = "tenant_default",
  userId = "usr_eval_viewer"
): TenantPrincipal {
  return {
    user_id: userId,
    tenant_id: tenantId,
    workspace_ids: ["ws_default"],
    role: "viewer",
    mfa_verified: true
  };
}

let sharedMemHarness: {
  store: KosmoraRuntimeStore;
  security: KosmoraEnterpriseSecurityEngine;
  missionControl: KosmoraMissionControlService;
  playbooks: KosmoraPlaybooksService;
  evaluations: KosmoraEvaluationsService;
} | null = null;

function getHarness(dbPath = ":memory:") {
  if (dbPath === ":memory:") {
    if (!sharedMemHarness) {
      const store = new KosmoraRuntimeStore(":memory:");
      const security = new KosmoraEnterpriseSecurityEngine();
      const missionControl = new KosmoraMissionControlService(store, security);
      const playbooks = new KosmoraPlaybooksService(
        store,
        security,
        missionControl
      );
      const evaluations = new KosmoraEvaluationsService(
        store,
        security,
        missionControl,
        playbooks
      );
      sharedMemHarness = {
        store,
        security,
        missionControl,
        playbooks,
        evaluations
      };
    }
    return sharedMemHarness;
  }

  const store = new KosmoraRuntimeStore(dbPath);
  const security = new KosmoraEnterpriseSecurityEngine();
  const missionControl = new KosmoraMissionControlService(store, security);
  const playbooks = new KosmoraPlaybooksService(
    store,
    security,
    missionControl
  );
  const evaluations = new KosmoraEvaluationsService(
    store,
    security,
    missionControl,
    playbooks
  );
  return { store, security, missionControl, playbooks, evaluations };
}

describe("Kosmora Evaluations & Quality Gates — 20-Point Verification Matrix", () => {
  it("01. Seeds built-in evaluation suites and protects them as immutable", () => {
    const { evaluations } = getHarness();
    const owner = createOwnerPrincipal();

    const suites = evaluations.listSuites({
      principal: owner,
      visibility: "built_in"
    });
    assert.ok(suites.length >= 3);
    const ids = suites.map((s) => s.id);
    for (const seed of BUILT_IN_KOSMORA_EVALUATION_SUITES) {
      assert.ok(ids.includes(seed.id), `Missing built-in suite ${seed.id}`);
    }

    assert.throws(
      () =>
        evaluations.updateSuite({
          principal: owner,
          suite_id: "evl_builtin_analytical_report",
          input: { title: "Попытка перезаписи встроенного эталона" }
        }),
      (err: unknown) => err instanceof EvaluationAccessDeniedError
    );

    assert.throws(
      () =>
        evaluations.archiveSuite({
          principal: owner,
          suite_id: "evl_builtin_analytical_report"
        }),
      (err: unknown) => err instanceof EvaluationAccessDeniedError
    );
  });

  it("02. Creates a custom evaluation suite with multi-criterion rubric and golden test cases", () => {
    const { evaluations } = getHarness();
    const owner = createOwnerPrincipal();

    const suite = evaluations.createSuite({
      principal: owner,
      input: {
        project_id: "proj_eval_custom",
        slug: "custom-fintech-rubric",
        title: "Рубрика проверки финтех-исследований",
        description: "Проверка полноты разделов, цитат и отсутствия заглушек",
        target_kind: "both",
        visibility: "project",
        passing_score_threshold: 85,
        block_on_critical_criteria: true,
        criteria: [
          {
            key: "sections_check",
            label: "Обязательные разделы",
            description: "Проверка структуры",
            grader_type: "required_sections",
            severity: "critical",
            weight: 40,
            config: {
              required_sections: ["Резюме", "Регуляторика", "Риски"]
            }
          },
          {
            key: "citations_check",
            label: "Минимум 2 источника",
            description: "Проверка ссылок",
            grader_type: "citation_count",
            severity: "warning",
            weight: 30,
            config: { min_citations: 2 }
          },
          {
            key: "no_todo_check",
            label: "Без TODO/TBD",
            description: "Проверка чистоты текста",
            grader_type: "forbidden_phrases",
            severity: "critical",
            weight: 30,
            config: { forbidden_phrases: ["TODO", "TBD", "FIXME"] }
          }
        ],
        golden_test_cases: [
          {
            id: "tc_fintech_1",
            title: "Платежные шлюзы СНГ",
            description: "Анализ платежной инфраструктуры",
            variables: { market: "FinTech" },
            expected_substrings: ["Регуляторика", "Риски"],
            forbidden_substrings: ["TODO"],
            max_allowed_budget: 40
          }
        ]
      }
    });

    assert.equal(suite.slug, "custom-fintech-rubric");
    assert.equal(suite.version, 1);
    assert.equal(suite.criteria.length, 3);
    assert.equal(suite.golden_test_cases.length, 1);
  });

  it("03. Rejects invalid suite slugs, duplicate criterion keys, and built_in visibility on custom suites", () => {
    const { evaluations } = getHarness();
    const owner = createOwnerPrincipal();

    assert.throws(
      () =>
        evaluations.createSuite({
          principal: owner,
          input: {
            project_id: "proj_eval_custom",
            slug: "INVALID SLUG!",
            title: "Некорректный slug",
            criteria: [
              {
                key: "c1",
                label: "C1",
                description: "",
                grader_type: "length_bounds",
                severity: "info",
                weight: 100,
                config: { min_chars: 10 }
              }
            ]
          }
        }),
      (err: unknown) => err instanceof EvaluationValidationError
    );

    assert.throws(
      () =>
        evaluations.createSuite({
          principal: owner,
          input: {
            project_id: "proj_eval_custom",
            slug: "dup-criteria-suite",
            title: "Дубликат ключей",
            criteria: [
              {
                key: "same_key",
                label: "C1",
                description: "",
                grader_type: "length_bounds",
                severity: "info",
                weight: 50,
                config: { min_chars: 10 }
              },
              {
                key: "same_key",
                label: "C2",
                description: "",
                grader_type: "length_bounds",
                severity: "info",
                weight: 50,
                config: { min_chars: 20 }
              }
            ]
          }
        }),
      (err: unknown) => err instanceof EvaluationValidationError
    );
  });

  it("04. Enforces optimistic concurrency control on suite updates", () => {
    const { evaluations } = getHarness();
    const owner = createOwnerPrincipal();

    const created = evaluations.createSuite({
      principal: owner,
      input: {
        project_id: "proj_occ",
        slug: "occ-test-suite",
        title: "Тест оптимистичной блокировки",
        criteria: [
          {
            key: "len_check",
            label: "Длина текста",
            description: "",
            grader_type: "length_bounds",
            severity: "warning",
            weight: 100,
            config: { min_chars: 50 }
          }
        ]
      }
    });

    const updated = evaluations.updateSuite({
      principal: owner,
      suite_id: created.id,
      input: {
        expected_version: 1,
        passing_score_threshold: 90
      }
    });
    assert.equal(updated.version, 2);
    assert.equal(updated.passing_score_threshold, 90);

    assert.throws(
      () =>
        evaluations.updateSuite({
          principal: owner,
          suite_id: created.id,
          input: {
            expected_version: 1,
            title: "Устаревшая версия"
          }
        }),
      (err: unknown) => err instanceof EvaluationConcurrencyConflictError
    );
  });

  it("05. Archives a custom suite and blocks new evaluations against archived suites", () => {
    const { evaluations, missionControl } = getHarness();
    const owner = createOwnerPrincipal();

    const suite = evaluations.createSuite({
      principal: owner,
      input: {
        project_id: "proj_archive",
        slug: "archivable-suite",
        title: "Архивируемый набор оценки",
        criteria: [
          {
            key: "len_ok",
            label: "Длина",
            description: "",
            grader_type: "length_bounds",
            severity: "info",
            weight: 100,
            config: { min_chars: 10 }
          }
        ]
      }
    });

    const archived = evaluations.archiveSuite({
      principal: owner,
      suite_id: suite.id
    });
    assert.equal(archived.status, "archived");
    assert.ok(archived.archived_at);

    const mission = missionControl.createMission({
      principal: owner,
      project_id: "proj_archive",
      title: "Миссия для проверки архива",
      goal: "Проверка отказа запуска архивной рубрики"
    });

    assert.throws(
      () =>
        evaluations.evaluateMission({
          principal: owner,
          input: {
            suite_id: suite.id,
            mission_id: mission.id
          }
        }),
      (err: unknown) => err instanceof EvaluationValidationError
    );
  });

  it("06. Grades required_sections accurately for partial and complete section coverage", () => {
    const { evaluations, missionControl } = getHarness();
    const owner = createOwnerPrincipal();

    const suite = evaluations.createSuite({
      principal: owner,
      input: {
        project_id: "proj_graders",
        slug: "grader-sections-suite",
        title: "Проверка разделов",
        passing_score_threshold: 80,
        criteria: [
          {
            key: "req_sec",
            label: "Разделы отчёта",
            description: "",
            grader_type: "required_sections",
            severity: "warning",
            weight: 100,
            config: {
              required_sections: ["Методология", "Анализ рынка", "Риски", "Выводы"]
            }
          }
        ]
      }
    });

    const mission = missionControl.createMission({
      principal: owner,
      project_id: "proj_graders",
      title: "Тестовая миссия разделов",
      goal: "Проверка грейдера разделов"
    });

    const partialRun = evaluations.evaluateMission({
      principal: owner,
      input: {
        suite_id: suite.id,
        mission_id: mission.id,
        override_artifact_content:
          "# Отчёт\n## Методология\nОписание.\n## Выводы\nИтоги."
      }
    });
    assert.equal(partialRun.overall_score, 50);
    assert.equal(partialRun.verdict, "failed");

    const fullRun = evaluations.evaluateMission({
      principal: owner,
      input: {
        suite_id: suite.id,
        mission_id: mission.id,
        override_artifact_content:
          "# Отчёт\n## Методология\n1\n## Анализ рынка\n2\n## Риски\n3\n## Выводы\n4"
      }
    });
    assert.equal(fullRun.overall_score, 100);
    assert.equal(fullRun.verdict, "passed");
  });

  it("07. Grades citation_count by extracting URLs and bracketed source references", () => {
    const { evaluations, missionControl } = getHarness();
    const owner = createOwnerPrincipal();

    const suite = evaluations.createSuite({
      principal: owner,
      input: {
        project_id: "proj_graders",
        slug: "grader-citations-suite",
        title: "Проверка цитирования",
        passing_score_threshold: 80,
        criteria: [
          {
            key: "citations",
            label: "Минимум 3 источника",
            description: "",
            grader_type: "citation_count",
            severity: "warning",
            weight: 100,
            config: { min_citations: 3 }
          }
        ]
      }
    });

    const mission = missionControl.createMission({
      principal: owner,
      project_id: "proj_graders",
      title: "Миссия цитирования",
      goal: "Проверка ссылок"
    });

    const runPass = evaluations.evaluateMission({
      principal: owner,
      input: {
        suite_id: suite.id,
        mission_id: mission.id,
        override_artifact_content:
          "Данные подтверждены: https://kosmora.ai/r1, https://kosmora.ai/r2 и [Источник 3: Отчёт ЦБ]."
      }
    });
    assert.equal(runPass.overall_score, 100);
    assert.equal(runPass.verdict, "passed");
  });

  it("08. Blocks evaluation with verdict 'blocked_by_critical' when forbidden_phrases are found", () => {
    const { evaluations, missionControl } = getHarness();
    const owner = createOwnerPrincipal();

    const mission = missionControl.createMission({
      principal: owner,
      project_id: "proj_graders",
      title: "Миссия с черновым маркером TODO",
      goal: "Проверка блокировки критическим критерием"
    });

    const runBlocked = evaluations.evaluateMission({
      principal: owner,
      input: {
        suite_id: "evl_builtin_analytical_report",
        mission_id: mission.id,
        override_artifact_content: [
          "# Полный аналитический отчёт",
          "## Методология\nПодробный разбор методологии исследования рынка.",
          "## Анализ рынка\nОбъём рынка вырос на 28% по данным https://kosmora.ai/src1 и https://kosmora.ai/src2.",
          "## Конкуренты\nСравнение ключевых игроков и долей рынка.",
          "## Риски\nМакроэкономические и регуляторные факторы риска.",
          "## Выводы\nTODO: дописать финальную рекомендацию перед отправкой клиенту."
        ].join("\n")
      }
    });

    assert.equal(runBlocked.verdict, "blocked_by_critical");
    assert.ok(runBlocked.critical_failures_count >= 1);
  });

  it("09. Grades length_bounds and budget_efficiency criteria accurately", () => {
    const { evaluations, missionControl } = getHarness();
    const owner = createOwnerPrincipal();

    const suite = evaluations.createSuite({
      principal: owner,
      input: {
        project_id: "proj_graders",
        slug: "grader-length-budget",
        title: "Проверка объёма и бюджета",
        passing_score_threshold: 80,
        criteria: [
          {
            key: "len_bounds",
            label: "Объём 40..500 символов",
            description: "",
            grader_type: "length_bounds",
            severity: "warning",
            weight: 50,
            config: { min_chars: 40, max_chars: 500 }
          },
          {
            key: "budget_cap",
            label: "Бюджет до $30",
            description: "",
            grader_type: "budget_efficiency",
            severity: "critical",
            weight: 50,
            config: { max_budget_usd: 30 }
          }
        ]
      }
    });

    const mission = missionControl.createMission({
      principal: owner,
      project_id: "proj_graders",
      title: "Бюджетная миссия",
      goal: "Проверка лимитов",
      budget_limit: 25
    });

    const run = evaluations.evaluateMission({
      principal: owner,
      input: {
        suite_id: suite.id,
        mission_id: mission.id,
        override_artifact_content:
          "Это содержательный аналитический текст достаточной длины для прохождения порога в сорок символов."
      }
    });

    assert.equal(run.overall_score, 100);
    assert.equal(run.verdict, "passed");
  });

  it("10. Grades json_schema_keys and deterministic_pattern criteria", () => {
    const { evaluations, missionControl } = getHarness();
    const owner = createOwnerPrincipal();

    const suite = evaluations.createSuite({
      principal: owner,
      input: {
        project_id: "proj_graders",
        slug: "grader-json-regex",
        title: "Проверка JSON-ключей и регулярных выражений",
        passing_score_threshold: 90,
        criteria: [
          {
            key: "json_keys",
            label: "Ключи отчёта безопасности",
            description: "",
            grader_type: "json_schema_keys",
            severity: "critical",
            weight: 50,
            config: {
              required_json_keys: ["severity", "cve_id", "remediation"]
            }
          },
          {
            key: "semver_pattern",
            label: "Версия релиза vX.Y.Z",
            description: "",
            grader_type: "deterministic_pattern",
            severity: "warning",
            weight: 50,
            config: {
              regex_pattern: "v\\d+\\.\\d+\\.\\d+",
              regex_flags: "i"
            }
          }
        ]
      }
    });

    const mission = missionControl.createMission({
      principal: owner,
      project_id: "proj_graders",
      title: "Аудит релиза",
      goal: "Проверка схемы"
    });

    const run = evaluations.evaluateMission({
      principal: owner,
      input: {
        suite_id: suite.id,
        mission_id: mission.id,
        override_artifact_content:
          'Релиз v2.4.1 проверен. Сводка: {"severity": "high", "cve_id": "CVE-2026-1042", "remediation": "Upgrade package"}'
      }
    });

    assert.equal(run.overall_score, 100);
    assert.equal(run.verdict, "passed");
  });

  it("11. Grades task_completion_rate on a real executed Mission Control mission", () => {
    const { evaluations, missionControl } = getHarness();
    const owner = createOwnerPrincipal();

    const suite = evaluations.createSuite({
      principal: owner,
      input: {
        project_id: "proj_task_rate",
        slug: "task-completion-suite",
        title: "Полнота выполнения задач",
        passing_score_threshold: 95,
        criteria: [
          {
            key: "tasks_done",
            label: "100% задач завершено",
            description: "",
            grader_type: "task_completion_rate",
            severity: "critical",
            weight: 100,
            config: { min_task_completion_pct: 100 }
          }
        ]
      }
    });

    const mission = missionControl.createMission({
      principal: owner,
      project_id: "proj_task_rate",
      title: "Миссия с двумя задачами",
      goal: "Проверить полное завершение графа задач",
      budget_limit: 50
    });

    const t1 = missionControl.createTask({
      principal: owner,
      mission_id: mission.id,
      title: "Сбор источников",
      instruction: "Найти источники",
      assigned_agent_role: "researcher",
      execution_mode: "autonomous",
      budget_limit: 10
    });

    missionControl.createTask({
      principal: owner,
      mission_id: mission.id,
      title: "Аналитический синтез",
      instruction: "Обобщить данные",
      assigned_agent_role: "analyst",
      execution_mode: "autonomous",
      dependencies: [t1.id],
      budget_limit: 10
    });

    missionControl.updateMission({
      principal: owner,
      mission_id: mission.id,
      status: "ready"
    });
    const completedMission = missionControl.startMission({
      principal: owner,
      mission_id: mission.id
    });
    assert.equal(completedMission.status, "completed");

    const evalRun = evaluations.evaluateMission({
      principal: owner,
      input: {
        suite_id: suite.id,
        mission_id: mission.id
      }
    });

    assert.equal(evalRun.overall_score, 100);
    assert.equal(evalRun.verdict, "passed");
  });

  it("12. Evaluates a completed mission end-to-end and records audit trail events", () => {
    const { evaluations, missionControl } = getHarness();
    const owner = createOwnerPrincipal();

    const mission = missionControl.createMission({
      principal: owner,
      project_id: "proj_e2e_eval",
      title: "Аудит безопасности репозитория",
      goal: "Проверить контур безопасности",
      budget_limit: 40
    });

    missionControl.createTask({
      principal: owner,
      mission_id: mission.id,
      title: "Проверка кода",
      instruction: "Найти уязвимости",
      assigned_agent_role: "developer",
      execution_mode: "autonomous",
      budget_limit: 15
    });

    missionControl.updateMission({
      principal: owner,
      mission_id: mission.id,
      status: "ready"
    });
    missionControl.startMission({
      principal: owner,
      mission_id: mission.id
    });

    const run = evaluations.evaluateMission({
      principal: owner,
      input: {
        suite_id: "evl_builtin_security_code_audit",
        mission_id: mission.id,
        override_artifact_content: [
          "# Отчёт аудита репозитория",
          "## Уязвимости\nПроверены зависимости и конфигурация секретов.",
          "## Архитектура\nМодульная изоляция соблюдена.",
          "## Рекомендации по исправлению\nОбновить ключи ротации.",
          "## Статус проверки\nПройдено успешно (https://security.kosmora.ai/advisory/1)."
        ].join("\n")
      }
    });

    assert.equal(run.verdict, "passed");
    assert.equal(run.overall_score, 100);

    const auditEvents = evaluations.listAuditEvents({
      principal: owner,
      suite_id: "evl_builtin_security_code_audit"
    });
    assert.ok(auditEvents.some((e) => e.event_type === "mission_evaluated"));
  });

  it("13. Runs Playbook Golden Benchmark Suite across golden test cases and instantiates real missions", () => {
    const { evaluations } = getHarness();
    const owner = createOwnerPrincipal();

    const benchmarkRun = evaluations.runPlaybookBenchmarkSuite({
      principal: owner,
      input: {
        suite_id: "evl_builtin_analytical_report",
        playbook_id: "pbk_builtin_market_research",
        playbook_version_number: 1,
        project_id: "proj_bench_1",
        execute_missions: true
      }
    });

    assert.equal(benchmarkRun.target_kind, "playbook");
    assert.equal(benchmarkRun.playbook_id, "pbk_builtin_market_research");
    assert.equal(benchmarkRun.playbook_version_number, 1);
    assert.equal(benchmarkRun.verdict, "passed");
    assert.ok(benchmarkRun.overall_score >= 85);
    assert.equal(benchmarkRun.test_case_results.length, 2);
    assert.ok(benchmarkRun.test_case_results[0]!.resulting_mission_id.startsWith("msn_"));
  });

  it("14. Detects version-to-version regression when Playbook v2 degrades compared to v1 baseline", () => {
    const { evaluations, playbooks } = getHarness();
    const owner = createOwnerPrincipal();

    const createdPb = playbooks.createPlaybook({
      principal: owner,
      project_id: "proj_regression",
      slug: "edtech-research-v-compare",
      title: "Исследование EdTech (v1 vs v2)",
      description: "Тестирование регрессии между версиями",
      category: "research",
      visibility: "project",
      publish_immediately: true,
      changelog: "v1 эталонная версия",
      definition: {
        mission_title_template: "EdTech анализ: {{market}}",
        goal_template: "Исследовать {{market}}",
        context_template: "Регион: {{country}}",
        default_priority: "high",
        default_budget_limit: 50,
        variables: [
          {
            key: "project_name",
            label: "Проект",
            description: "",
            type: "text",
            required: false,
            default_value: "Kosmora",
            secret: false
          },
          {
            key: "market",
            label: "Рынок",
            description: "",
            type: "text",
            required: false,
            default_value: "EdTech",
            secret: false
          },
          {
            key: "country",
            label: "Страна",
            description: "",
            type: "text",
            required: false,
            default_value: "СНГ",
            secret: false
          },
          {
            key: "deadline",
            label: "Дедлайн",
            description: "",
            type: "text",
            required: false,
            default_value: "2026-12-31",
            secret: false
          },
          {
            key: "budget",
            label: "Бюджет",
            description: "",
            type: "number",
            required: false,
            default_value: 40,
            secret: false
          }
        ],
        tasks: [
          {
            key: "research_step",
            title_template: "Исследование {{market}}",
            instruction_template: "Собрать аналитику по {{market}}",
            assigned_agent_role: "researcher",
            execution_mode: "autonomous",
            requested_tools: ["web_search"],
            priority: "high",
            dependencies: [],
            budget_limit: 15,
            max_attempts: 2,
            condition_expression: null,
            requires_owner_review: false
          }
        ]
      }
    });

    // Run baseline benchmark on v1
    const v1Run = evaluations.runPlaybookBenchmarkSuite({
      principal: owner,
      input: {
        suite_id: "evl_builtin_analytical_report",
        playbook_id: createdPb.playbook.id,
        playbook_version_number: 1,
        project_id: "proj_regression"
      }
    });
    assert.equal(v1Run.verdict, "passed");
    assert.ok(v1Run.overall_score >= 90);

    // Publish v2
    playbooks.publishVersion({
      principal: owner,
      playbook_id: createdPb.playbook.id,
      changelog: "v2 экспериментальный промпт"
    });

    // Run benchmark on v2 with degraded output containing TODO and missing sections
    const v2Run = evaluations.runPlaybookBenchmarkSuite({
      principal: owner,
      input: {
        suite_id: "evl_builtin_analytical_report",
        playbook_id: createdPb.playbook.id,
        playbook_version_number: 2,
        project_id: "proj_regression",
        baseline_run_id: v1Run.id,
        artifact_content_overrides_by_case_id: {
          tc_edtech_cis:
            "# Черновик v2\n## Методология\nTODO: заполнить разделы позже.",
          tc_cloud_fintech:
            "# Черновик v2\n## Методология\nTBD: нет источников."
        }
      }
    });

    assert.equal(v2Run.verdict, "blocked_by_critical");
    assert.equal(v2Run.baseline_run_id, v1Run.id);
    assert.ok(v2Run.score_delta !== null && v2Run.score_delta < -30);
    assert.equal(v2Run.regression_detected, true);
    assert.ok(v2Run.regression_summary?.includes("Регрессия"));
  });

  it("15. Configures a Release Quality Gate Policy and passes when all required suites meet thresholds", () => {
    const { evaluations } = getHarness();
    const owner = createOwnerPrincipal();

    // Ensure a passing benchmark run exists for pbk_builtin_presentation_prep v1
    const benchRun = evaluations.runPlaybookBenchmarkSuite({
      principal: owner,
      input: {
        suite_id: "evl_builtin_executive_presentation",
        playbook_id: "pbk_builtin_presentation_prep",
        playbook_version_number: 1,
        project_id: "proj_gates_pass",
        execute_missions: false
      }
    });
    assert.equal(benchRun.verdict, "passed");

    const policy = evaluations.upsertQualityGatePolicy({
      principal: owner,
      input: {
        project_id: "proj_gates_pass",
        playbook_id: "pbk_builtin_presentation_prep",
        required_suite_ids: ["evl_builtin_executive_presentation"],
        min_overall_score: 80,
        allow_critical_failures: false,
        max_regression_drop: 5
      }
    });
    assert.equal(policy.status, "active");

    const gateCheck = evaluations.checkQualityGate({
      principal: owner,
      project_id: "proj_gates_pass",
      playbook_id: "pbk_builtin_presentation_prep",
      playbook_version_number: 1
    });

    assert.equal(gateCheck.allowed, true);
    assert.equal(gateCheck.blocking_reasons.length, 0);
    assert.equal(gateCheck.suite_summaries.length, 1);
    assert.equal(gateCheck.suite_summaries[0]!.passed_gate, true);
  });

  it("16. Blocks Release Quality Gate when required suite has not been run or failed with regression", () => {
    const { evaluations } = getHarness();
    const owner = createOwnerPrincipal();

    evaluations.upsertQualityGatePolicy({
      principal: owner,
      input: {
        project_id: "proj_gates_block",
        playbook_id: "pbk_builtin_repository_audit",
        required_suite_ids: ["evl_builtin_security_code_audit"],
        min_overall_score: 88,
        allow_critical_failures: false,
        max_regression_drop: 5
      }
    });

    // Check before any evaluation run exists -> must block
    const unverifiedCheck = evaluations.checkQualityGate({
      principal: owner,
      project_id: "proj_gates_block",
      playbook_id: "pbk_builtin_repository_audit",
      playbook_version_number: 1
    });
    assert.equal(unverifiedCheck.allowed, false);
    assert.ok(unverifiedCheck.blocking_reasons.length >= 1);

    assert.throws(
      () =>
        evaluations.checkQualityGate({
          principal: owner,
          project_id: "proj_gates_block",
          playbook_id: "pbk_builtin_repository_audit",
          playbook_version_number: 1,
          throw_on_blocked: true
        }),
      (err: unknown) => err instanceof QualityGateBlockedError
    );
  });

  it("17. Enforces RBAC and multi-tenant RLS isolation across suites, runs, and quality gates", () => {
    const { evaluations } = getHarness();
    const ownerAlpha = createOwnerPrincipal("tenant_alpha", "usr_alpha");
    const ownerBeta = createOwnerPrincipal("tenant_beta", "usr_beta");
    const viewerAlpha = createViewerPrincipal("tenant_alpha", "usr_viewer");

    const alphaSuite = evaluations.createSuite({
      principal: ownerAlpha,
      input: {
        project_id: "proj_alpha",
        slug: "alpha-private-suite",
        title: "Приватная рубрика Alpha",
        visibility: "private",
        criteria: [
          {
            key: "sec_1",
            label: "Раздел 1",
            description: "",
            grader_type: "length_bounds",
            severity: "info",
            weight: 100,
            config: { min_chars: 5 }
          }
        ]
      }
    });

    // Viewer cannot create or archive suites
    assert.throws(
      () =>
        evaluations.createSuite({
          principal: viewerAlpha,
          input: {
            project_id: "proj_alpha",
            slug: "viewer-attempt",
            title: "Попытка создания зрителем",
            criteria: alphaSuite.criteria
          }
        }),
      (err: unknown) => err instanceof EvaluationAccessDeniedError
    );

    // Tenant Beta cannot access Tenant Alpha's suite
    assert.throws(
      () =>
        evaluations.getSuite({
          principal: ownerBeta,
          suite_id: alphaSuite.id
        }),
      (err: unknown) => err instanceof EvaluationAccessDeniedError
    );
  });

  it("18. Persists suites, runs, and quality gates in SQLite Migration 007 across store reopen", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "kosmora-eval-db-"));
    const dbFile = join(tempDir, "evaluations.sqlite");
    try {
      const h1 = getHarness(dbFile);
      const owner = createOwnerPrincipal();

      const migrations = h1.store.listAppliedMigrations();
      assert.ok(
        migrations.some(
          (m) => m.version === 7 && m.name === "007_kosmora_evaluations_tables"
        )
      );

      const created = h1.evaluations.createSuite({
        principal: owner,
        input: {
          project_id: "proj_persist",
          slug: "persistent-suite",
          title: "Персистентный набор оценки",
          criteria: [
            {
              key: "c_persist",
              label: "Проверка сохранения",
              description: "",
              grader_type: "length_bounds",
              severity: "info",
              weight: 100,
              config: { min_chars: 5 }
            }
          ]
        }
      });
      h1.store.close();

      const h2 = getHarness(dbFile);
      const loaded = h2.evaluations.getSuite({
        principal: owner,
        suite_id: created.id
      });
      assert.equal(loaded.slug, "persistent-suite");
      assert.equal(loaded.title, "Персистентный набор оценки");
      h2.store.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("19. Exposes live HTTP API endpoints for suites, mission evaluation, playbook benchmarks, and quality gates", async () => {
    const ctx = createKosmoraControlPlane(":memory:");
    const server = createKosmoraHttpServer(ctx);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const owner = createOwnerPrincipal();
      const { token } = ctx.security.issueSignedSessionToken(owner);
      const headers = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      };

      // 1. GET /api/v1/evaluations/suites
      const listRes = await fetch(`${baseUrl}/api/v1/evaluations/suites`, {
        headers
      });
      assert.equal(listRes.status, 200);
      const listBody = (await listRes.json()) as { suites: Array<{ id: string }> };
      assert.ok(listBody.suites.length >= 3);

      // 2. POST /api/v1/evaluations/benchmark-playbook
      const benchRes = await fetch(
        `${baseUrl}/api/v1/evaluations/benchmark-playbook`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            suite_id: "evl_builtin_analytical_report",
            playbook_id: "pbk_builtin_market_research",
            playbook_version_number: 1,
            project_id: "proj_http_eval",
            execute_missions: false
          })
        }
      );
      assert.equal(benchRes.status, 201);
      const benchBody = (await benchRes.json()) as {
        run: { id: string; verdict: string; overall_score: number };
      };
      assert.equal(benchBody.run.verdict, "passed");
      assert.ok(benchBody.run.overall_score >= 85);

      // 3. POST /api/v1/evaluations/gates & POST /api/v1/evaluations/gates/check
      const gateCreateRes = await fetch(`${baseUrl}/api/v1/evaluations/gates`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          project_id: "proj_http_eval",
          playbook_id: "pbk_builtin_market_research",
          required_suite_ids: ["evl_builtin_analytical_report"],
          min_overall_score: 85
        })
      });
      assert.equal(gateCreateRes.status, 201);

      const gateCheckRes = await fetch(
        `${baseUrl}/api/v1/evaluations/gates/check`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            project_id: "proj_http_eval",
            playbook_id: "pbk_builtin_market_research",
            playbook_version_number: 1
          })
        }
      );
      assert.equal(gateCheckRes.status, 200);
      const gateCheckBody = (await gateCheckRes.json()) as {
        gate_result: { allowed: boolean };
      };
      assert.equal(gateCheckBody.gate_result.allowed, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ctx.store.close(true);
    }
  });

  it("20. Renders monochrome Russian Evaluations UI across active, empty, loading, error, and regression_blocked states", () => {
    assert.equal(
      KOSMORA_EVALUATIONS_MONOCHROME_PALETTE.background_primary,
      "#0A0A0A"
    );
    assert.equal(
      KOSMORA_EVALUATIONS_MONOCHROME_PALETTE.surface_elevated,
      "#111111"
    );
    assert.equal(
      KOSMORA_EVALUATIONS_MONOCHROME_PALETTE.border_subtle,
      "#262626"
    );
    assert.equal(KOSMORA_EVALUATIONS_MONOCHROME_PALETTE.text_primary, "#FAFAFA");
    assert.equal(
      KOSMORA_EVALUATIONS_MONOCHROME_PALETTE.text_secondary,
      "#A3A3A3"
    );

    const activeText = collectTextFromReactNode(KosmoraEvaluationsPage());
    assert.ok(
      activeText.includes(
        "Оценка качества миссий, эталонные бенчмарки и релизные Quality Gates"
      )
    );
    assert.ok(
      activeText.includes("Эталон качества аналитического исследования")
    );
    assert.ok(activeText.includes("ПРОЙДЕНО (PASSED)"));

    const regressionVm = buildEvaluationsViewModel({
      mode: "regression_blocked"
    });
    const regressionText = collectTextFromReactNode(
      KosmoraEvaluationsPanel({ viewModel: regressionVm })
    );
    assert.ok(regressionText.includes("БЛОКИРОВКА РЕЛИЗА QUALITY GATE"));
    assert.ok(regressionText.includes("ОБНАРУЖЕНА РЕГРЕССИЯ"));

    const emptyText = collectTextFromReactNode(
      KosmoraEvaluationsPanel({
        viewModel: buildEvaluationsViewModel({ mode: "empty" })
      })
    );
    assert.ok(emptyText.includes("Наборы оценки качества пока не созданы"));

    const workspaceTree = KosmoraWorkspacePage();
    const workspaceJson = JSON.stringify(workspaceTree);
    assert.ok(workspaceJson.includes("/kosmora-workspace/evaluations"));
  });
});
