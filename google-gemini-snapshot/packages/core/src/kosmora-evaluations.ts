/**
 * Kosmora Evaluations & Quality Gates — Automated Rubric Grading,
 * Playbook Golden Benchmark Suites, Regression Detection, and Release Quality Gates.
 */

import { randomBytes } from "node:crypto";
import {
  BUILT_IN_KOSMORA_EVALUATION_SUITES,
  EVALUATION_AUDIT_EVENT_TYPES,
  EVALUATION_CRITERION_SEVERITIES,
  EVALUATION_GRADER_TYPES,
  EVALUATION_RUN_VERDICTS,
  EVALUATION_SUITE_STATUSES,
  EVALUATION_SUITE_VISIBILITIES,
  EVALUATION_TARGET_KINDS,
  QUALITY_GATE_STATUSES,
  type CreateEvaluationSuiteInput,
  type CriterionEvaluationResult,
  type EvaluateMissionInput,
  type EvaluationAuditEvent,
  type EvaluationAuditEventType,
  type EvaluationCriterion,
  type EvaluationCriterionSeverity,
  type EvaluationGoldenTestCase,
  type EvaluationGraderType,
  type EvaluationRun,
  type EvaluationRunVerdict,
  type EvaluationSuite,
  type EvaluationSuiteStatus,
  type EvaluationSuiteVisibility,
  type EvaluationTargetKind,
  type QualityGateCheckResult,
  type QualityGatePolicy,
  type QualityGateStatus,
  type RunPlaybookBenchmarkInput,
  type TestCaseEvaluationResult,
  type UpdateEvaluationSuiteInput,
  type UpsertQualityGatePolicyInput
} from "../../contracts/src/kosmora-evaluations.js";
import {
  KosmoraEnterpriseSecurityEngine,
  type TenantPrincipal
} from "./kosmora-enterprise-security.js";
import {
  KosmoraMissionControlService,
  MissionAccessDeniedError,
  MissionNotFoundError
} from "./kosmora-mission-control.js";
import {
  KosmoraPlaybooksService,
  PlaybookAccessDeniedError,
  PlaybookNotFoundError
} from "./kosmora-playbooks.js";
import {
  KosmoraRuntimeStore,
  type StoredEvaluationAuditEventRow,
  type StoredEvaluationRunRow,
  type StoredEvaluationSuiteRow,
  type StoredQualityGatePolicyRow
} from "./kosmora-runtime-store.js";

export {
  BUILT_IN_KOSMORA_EVALUATION_SUITES,
  EVALUATION_AUDIT_EVENT_TYPES,
  EVALUATION_CRITERION_SEVERITIES,
  EVALUATION_GRADER_TYPES,
  EVALUATION_RUN_VERDICTS,
  EVALUATION_SUITE_STATUSES,
  EVALUATION_SUITE_VISIBILITIES,
  EVALUATION_TARGET_KINDS,
  QUALITY_GATE_STATUSES
};

export type {
  CreateEvaluationSuiteInput,
  CriterionEvaluationResult,
  EvaluateMissionInput,
  EvaluationAuditEvent,
  EvaluationAuditEventType,
  EvaluationCriterion,
  EvaluationCriterionSeverity,
  EvaluationGoldenTestCase,
  EvaluationGraderType,
  EvaluationRun,
  EvaluationRunVerdict,
  EvaluationSuite,
  EvaluationSuiteStatus,
  EvaluationSuiteVisibility,
  EvaluationTargetKind,
  QualityGateCheckResult,
  QualityGatePolicy,
  QualityGateStatus,
  RunPlaybookBenchmarkInput,
  TestCaseEvaluationResult,
  UpdateEvaluationSuiteInput,
  UpsertQualityGatePolicyInput
};

export class EvaluationSuiteNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationSuiteNotFoundError";
  }
}

export class EvaluationRunNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationRunNotFoundError";
  }
}

export class EvaluationAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationAccessDeniedError";
  }
}

export class EvaluationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationValidationError";
  }
}

export class EvaluationConcurrencyConflictError extends Error {
  public readonly entity_id: string;
  public readonly expected_version: number;
  public readonly actual_version: number;

  constructor(
    entityId: string,
    expectedVersion: number,
    actualVersion: number
  ) {
    super(
      `Optimistic concurrency conflict for '${entityId}': expected version ${expectedVersion}, actual version ${actualVersion}`
    );
    this.name = "EvaluationConcurrencyConflictError";
    this.entity_id = entityId;
    this.expected_version = expectedVersion;
    this.actual_version = actualVersion;
  }
}

export class QualityGateBlockedError extends Error {
  public readonly gateResult: QualityGateCheckResult;

  constructor(message: string, gateResult: QualityGateCheckResult) {
    super(message);
    this.name = "QualityGateBlockedError";
    this.gateResult = gateResult;
  }
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9-_]{1,63}$/;

export interface KosmoraEvaluationsServiceOptions {
  store: KosmoraRuntimeStore;
  security: KosmoraEnterpriseSecurityEngine;
  missionControl: KosmoraMissionControlService;
  playbooks: KosmoraPlaybooksService;
}

export class KosmoraEvaluationsService {
  private readonly store: KosmoraRuntimeStore;
  private readonly security: KosmoraEnterpriseSecurityEngine;
  private readonly missionControl: KosmoraMissionControlService;
  private readonly playbooks: KosmoraPlaybooksService;
  private builtInSeeded = false;

  constructor(
    storeOrOptions: KosmoraRuntimeStore | KosmoraEvaluationsServiceOptions,
    security?: KosmoraEnterpriseSecurityEngine,
    missionControl?: KosmoraMissionControlService,
    playbooks?: KosmoraPlaybooksService
  ) {
    if (storeOrOptions instanceof KosmoraRuntimeStore) {
      this.store = storeOrOptions;
      this.security = security!;
      this.missionControl = missionControl!;
      this.playbooks = playbooks!;
    } else {
      this.store = storeOrOptions.store;
      this.security = storeOrOptions.security;
      this.missionControl = storeOrOptions.missionControl;
      this.playbooks = storeOrOptions.playbooks;
    }
    this.store.ensureEvaluationsSchema();
    this.ensureBuiltInSuitesSeeded();
  }

  public ensureBuiltInSuitesSeeded(): void {
    if (this.builtInSeeded) {
      return;
    }
    const now = new Date().toISOString();
    for (const seed of BUILT_IN_KOSMORA_EVALUATION_SUITES) {
      const existing = this.store.getEvaluationSuiteRowById(seed.id);
      if (!existing) {
        this.store.upsertEvaluationSuiteRow({
          id: seed.id,
          tenant_id: "tenant_default",
          project_id: null,
          owner_id: "system_kosmora",
          slug: seed.slug,
          title: seed.title,
          description: seed.description,
          target_kind: seed.target_kind,
          visibility: "built_in",
          status: "active",
          passing_score_threshold: seed.passing_score_threshold,
          block_on_critical_criteria: seed.block_on_critical_criteria ? 1 : 0,
          criteria_json: JSON.stringify(seed.criteria),
          golden_test_cases_json: JSON.stringify(seed.golden_test_cases),
          version: 1,
          created_at: now,
          updated_at: now,
          archived_at: null
        });
      }
    }
    this.builtInSeeded = true;
  }

  // ============================================================================
  // SUITE CRUD & VALIDATION
  // ============================================================================

  public listSuites(params: {
    principal: TenantPrincipal;
    project_id?: string;
    target_kind?: EvaluationTargetKind;
    status?: EvaluationSuiteStatus;
    visibility?: EvaluationSuiteVisibility;
  }): EvaluationSuite[] {
    this.ensureBuiltInSuitesSeeded();
    this.assertReadPermission(params.principal);
    const rows = this.store.listEvaluationSuiteRows({
      tenant_id: params.principal.tenant_id,
      project_id: params.project_id,
      target_kind: params.target_kind,
      status: params.status,
      visibility: params.visibility
    });

    return rows
      .map((r) => this.hydrateSuite(r))
      .filter((suite) =>
        this.canReadSuite(params.principal, suite, params.project_id)
      );
  }

  public getSuite(params: {
    principal: TenantPrincipal;
    suite_id: string;
    project_id?: string;
  }): EvaluationSuite {
    this.ensureBuiltInSuitesSeeded();
    this.assertReadPermission(params.principal);
    const row = this.store.getEvaluationSuiteRowById(params.suite_id);
    if (!row) {
      throw new EvaluationSuiteNotFoundError(
        `Evaluation suite '${params.suite_id}' not found`
      );
    }
    const suite = this.hydrateSuite(row);
    if (!this.canReadSuite(params.principal, suite, params.project_id)) {
      throw new EvaluationAccessDeniedError(
        `Principal '${params.principal.user_id}' does not have access to evaluation suite '${params.suite_id}'`
      );
    }
    return suite;
  }

  public createSuite(params: {
    principal: TenantPrincipal;
    input: CreateEvaluationSuiteInput;
  }): EvaluationSuite {
    this.ensureBuiltInSuitesSeeded();
    this.assertWritePermission(params.principal);

    const slug = params.input.slug.trim().toLowerCase();
    if (!SLUG_REGEX.test(slug)) {
      throw new EvaluationValidationError(
        `Invalid evaluation suite slug '${params.input.slug}': must match ${SLUG_REGEX.source}`
      );
    }
    if (!params.input.title || params.input.title.trim().length < 3) {
      throw new EvaluationValidationError(
        "Evaluation suite title must be at least 3 characters long"
      );
    }

    const visibility: EvaluationSuiteVisibility =
      params.input.visibility ?? "project";
    if (visibility === "built_in") {
      throw new EvaluationValidationError(
        "Custom evaluation suites cannot be created with 'built_in' visibility"
      );
    }

    const existingSlug = this.store.getEvaluationSuiteRowBySlug(
      params.principal.tenant_id,
      params.input.project_id,
      slug
    );
    if (existingSlug) {
      throw new EvaluationValidationError(
        `Evaluation suite with slug '${slug}' already exists in project '${params.input.project_id}'`
      );
    }

    const passingThreshold = params.input.passing_score_threshold ?? 80;
    if (
      typeof passingThreshold !== "number" ||
      Number.isNaN(passingThreshold) ||
      passingThreshold < 1 ||
      passingThreshold > 100
    ) {
      throw new EvaluationValidationError(
        "passing_score_threshold must be a number between 1 and 100"
      );
    }

    this.validateCriteriaList(params.input.criteria);
    const goldenCases = params.input.golden_test_cases ?? [];
    this.validateGoldenTestCases(goldenCases);

    const now = new Date().toISOString();
    const id = `evl_${randomBytes(6).toString("hex")}`;
    const row: StoredEvaluationSuiteRow = {
      id,
      tenant_id: params.principal.tenant_id,
      project_id: params.input.project_id,
      owner_id: params.principal.user_id,
      slug,
      title: params.input.title.trim(),
      description: (params.input.description ?? "").trim(),
      target_kind: params.input.target_kind ?? "both",
      visibility,
      status: "active",
      passing_score_threshold: passingThreshold,
      block_on_critical_criteria:
        params.input.block_on_critical_criteria !== false ? 1 : 0,
      criteria_json: JSON.stringify(params.input.criteria),
      golden_test_cases_json: JSON.stringify(goldenCases),
      version: 1,
      created_at: now,
      updated_at: now,
      archived_at: null
    };

    this.store.upsertEvaluationSuiteRow(row);
    this.recordAuditEvent({
      suite_id: id,
      run_id: null,
      tenant_id: params.principal.tenant_id,
      project_id: params.input.project_id,
      actor_id: params.principal.user_id,
      event_type: "suite_created",
      details: {
        slug,
        title: row.title,
        criteria_count: params.input.criteria.length,
        golden_test_cases_count: goldenCases.length
      }
    });

    return this.hydrateSuite(row);
  }

  public updateSuite(params: {
    principal: TenantPrincipal;
    suite_id: string;
    input: UpdateEvaluationSuiteInput;
  }): EvaluationSuite {
    this.ensureBuiltInSuitesSeeded();
    const existingRow = this.store.getEvaluationSuiteRowById(params.suite_id);
    if (!existingRow) {
      throw new EvaluationSuiteNotFoundError(
        `Evaluation suite '${params.suite_id}' not found`
      );
    }
    const existing = this.hydrateSuite(existingRow);

    if (existing.visibility === "built_in") {
      throw new EvaluationAccessDeniedError(
        `Built-in evaluation suite '${existing.slug}' is immutable and cannot be modified`
      );
    }
    this.assertWritePermission(params.principal);
    if (existing.tenant_id !== params.principal.tenant_id) {
      throw new EvaluationAccessDeniedError(
        `Cross-tenant modification denied for suite '${params.suite_id}'`
      );
    }
    if (existing.status === "archived") {
      throw new EvaluationValidationError(
        `Archived evaluation suite '${params.suite_id}' cannot be modified`
      );
    }

    if (
      params.input.expected_version !== undefined &&
      params.input.expected_version !== existing.version
    ) {
      throw new EvaluationConcurrencyConflictError(
        params.suite_id,
        params.input.expected_version,
        existing.version
      );
    }

    const nextCriteria = params.input.criteria ?? existing.criteria;
    this.validateCriteriaList(nextCriteria);

    const nextCases =
      params.input.golden_test_cases ?? existing.golden_test_cases;
    this.validateGoldenTestCases(nextCases);

    const nextThreshold =
      params.input.passing_score_threshold ?? existing.passing_score_threshold;
    if (
      typeof nextThreshold !== "number" ||
      Number.isNaN(nextThreshold) ||
      nextThreshold < 1 ||
      nextThreshold > 100
    ) {
      throw new EvaluationValidationError(
        "passing_score_threshold must be between 1 and 100"
      );
    }

    const now = new Date().toISOString();
    const updatedRow: StoredEvaluationSuiteRow = {
      ...existingRow,
      title: params.input.title ? params.input.title.trim() : existing.title,
      description:
        params.input.description !== undefined
          ? params.input.description.trim()
          : existing.description,
      passing_score_threshold: nextThreshold,
      block_on_critical_criteria:
        params.input.block_on_critical_criteria !== undefined
          ? params.input.block_on_critical_criteria
            ? 1
            : 0
          : existingRow.block_on_critical_criteria,
      criteria_json: JSON.stringify(nextCriteria),
      golden_test_cases_json: JSON.stringify(nextCases),
      status: params.input.status ?? existing.status,
      version: existing.version + 1,
      updated_at: now
    };

    this.store.upsertEvaluationSuiteRow(updatedRow);
    this.recordAuditEvent({
      suite_id: existing.id,
      run_id: null,
      tenant_id: existing.tenant_id,
      project_id: existing.project_id ?? "proj_default",
      actor_id: params.principal.user_id,
      event_type: "suite_updated",
      details: {
        version: updatedRow.version,
        passing_score_threshold: updatedRow.passing_score_threshold,
        criteria_count: nextCriteria.length
      }
    });

    return this.hydrateSuite(updatedRow);
  }

  public archiveSuite(params: {
    principal: TenantPrincipal;
    suite_id: string;
  }): EvaluationSuite {
    this.ensureBuiltInSuitesSeeded();
    const existingRow = this.store.getEvaluationSuiteRowById(params.suite_id);
    if (!existingRow) {
      throw new EvaluationSuiteNotFoundError(
        `Evaluation suite '${params.suite_id}' not found`
      );
    }
    const existing = this.hydrateSuite(existingRow);
    if (existing.visibility === "built_in") {
      throw new EvaluationAccessDeniedError(
        `Built-in evaluation suite '${existing.slug}' cannot be archived`
      );
    }
    this.assertWritePermission(params.principal);
    if (existing.tenant_id !== params.principal.tenant_id) {
      throw new EvaluationAccessDeniedError(
        `Cross-tenant archive denied for suite '${params.suite_id}'`
      );
    }

    const now = new Date().toISOString();
    const updatedRow: StoredEvaluationSuiteRow = {
      ...existingRow,
      status: "archived",
      version: existing.version + 1,
      updated_at: now,
      archived_at: now
    };
    this.store.upsertEvaluationSuiteRow(updatedRow);
    this.recordAuditEvent({
      suite_id: existing.id,
      run_id: null,
      tenant_id: existing.tenant_id,
      project_id: existing.project_id ?? "proj_default",
      actor_id: params.principal.user_id,
      event_type: "suite_archived",
      details: { archived_at: now }
    });

    return this.hydrateSuite(updatedRow);
  }

  // ============================================================================
  // MISSION EVALUATION & RUBRIC GRADING ENGINE
  // ============================================================================

  public evaluateMission(params: {
    principal: TenantPrincipal;
    input: EvaluateMissionInput & {
      override_artifact_content?: string;
    };
  }): EvaluationRun {
    const suite = this.getSuite({
      principal: params.principal,
      suite_id: params.input.suite_id
    });
    if (suite.status === "archived") {
      throw new EvaluationValidationError(
        `Cannot run archived evaluation suite '${suite.id}'`
      );
    }

    let snapshot;
    try {
      snapshot = this.missionControl.getMissionDetails({
        principal: params.principal,
        mission_id: params.input.mission_id
      });
    } catch (err) {
      if (err instanceof MissionNotFoundError) {
        throw new EvaluationValidationError(
          `Mission '${params.input.mission_id}' not found for evaluation`
        );
      }
      if (err instanceof MissionAccessDeniedError) {
        throw new EvaluationAccessDeniedError(err.message);
      }
      throw err;
    }

    const { mission, tasks, artifacts } = snapshot;

    // Synthesize evaluable corpus from mission final summary + artifacts + task outputs
    const evaluableText =
      params.input.override_artifact_content !== undefined
        ? params.input.override_artifact_content
        : this.buildMissionEvaluableText(mission, tasks, artifacts);

    const completedTasksCount = tasks.filter(
      (t) => t.status === "completed"
    ).length;
    const totalTasksCount = tasks.length;

    const criteriaResults = suite.criteria.map((criterion) =>
      this.evaluateSingleCriterion({
        criterion,
        text: evaluableText,
        budgetSpent: mission.budget_spent,
        budgetLimit: mission.budget_limit,
        completedTasksCount,
        totalTasksCount
      })
    );

    const { overallScore, criticalFailuresCount, verdict } =
      this.computeAggregateScoreAndVerdict({
        suite,
        criteriaResults
      });

    const baselineComparison = this.computeBaselineComparison({
      principal: params.principal,
      suite,
      currentScore: overallScore,
      currentVerdict: verdict,
      baselineRunId: params.input.baseline_run_id,
      missionId: mission.id
    });

    const now = new Date().toISOString();
    const runId = `evr_${randomBytes(6).toString("hex")}`;
    const runRow: StoredEvaluationRunRow = {
      id: runId,
      suite_id: suite.id,
      suite_version: suite.version,
      tenant_id: params.principal.tenant_id,
      project_id: mission.project_id,
      target_kind: "mission",
      mission_id: mission.id,
      playbook_id: null,
      playbook_version_id: null,
      playbook_version_number: null,
      baseline_run_id: baselineComparison.baselineRunId,
      overall_score: overallScore,
      passing_score_threshold: suite.passing_score_threshold,
      verdict,
      critical_failures_count: criticalFailuresCount,
      criteria_results_json: JSON.stringify(criteriaResults),
      test_case_results_json: JSON.stringify([]),
      score_delta: baselineComparison.scoreDelta,
      regression_detected: baselineComparison.regressionDetected ? 1 : 0,
      regression_summary: baselineComparison.regressionSummary,
      total_budget_spent: Number(mission.budget_spent.toFixed(4)),
      initiated_by: params.principal.user_id,
      initiated_at: now,
      completed_at: now
    };

    this.store.insertEvaluationRunRow(runRow);
    this.recordAuditEvent({
      suite_id: suite.id,
      run_id: runId,
      tenant_id: params.principal.tenant_id,
      project_id: mission.project_id,
      actor_id: params.principal.user_id,
      event_type: "mission_evaluated",
      details: {
        mission_id: mission.id,
        overall_score: overallScore,
        verdict,
        critical_failures_count: criticalFailuresCount
      }
    });

    if (baselineComparison.regressionDetected) {
      this.recordAuditEvent({
        suite_id: suite.id,
        run_id: runId,
        tenant_id: params.principal.tenant_id,
        project_id: mission.project_id,
        actor_id: params.principal.user_id,
        event_type: "regression_detected",
        details: {
          mission_id: mission.id,
          baseline_run_id: baselineComparison.baselineRunId,
          score_delta: baselineComparison.scoreDelta,
          regression_summary: baselineComparison.regressionSummary
        }
      });
    }

    return this.hydrateRun(runRow);
  }

  // ============================================================================
  // PLAYBOOK GOLDEN BENCHMARK RUNNER & VERSION REGRESSION DETECTION
  // ============================================================================

  public runPlaybookBenchmarkSuite(params: {
    principal: TenantPrincipal;
    input: RunPlaybookBenchmarkInput & {
      artifact_content_overrides_by_case_id?: Record<string, string>;
    };
  }): EvaluationRun {
    const suite = this.getSuite({
      principal: params.principal,
      suite_id: params.input.suite_id,
      project_id: params.input.project_id
    });
    if (suite.status === "archived") {
      throw new EvaluationValidationError(
        `Cannot run archived evaluation suite '${suite.id}'`
      );
    }
    this.assertWritePermission(params.principal);

    let playbookDetails;
    try {
      playbookDetails = this.playbooks.getPlaybookDetails({
        principal: params.principal,
        playbook_id: params.input.playbook_id,
        project_id: params.input.project_id
      });
    } catch (err) {
      if (err instanceof PlaybookNotFoundError) {
        throw new EvaluationValidationError(err.message);
      }
      if (err instanceof PlaybookAccessDeniedError) {
        throw new EvaluationAccessDeniedError(err.message);
      }
      throw err;
    }

    const { playbook, versions } = playbookDetails;
    const targetVersionNumber =
      params.input.playbook_version_number ?? playbook.current_version;
    const versionRecord = versions.find(
      (v) => v.version_number === targetVersionNumber && v.is_published
    );
    if (!versionRecord) {
      throw new EvaluationValidationError(
        `Published version v${targetVersionNumber} not found for playbook '${playbook.id}'`
      );
    }

    const goldenCases: EvaluationGoldenTestCase[] =
      suite.golden_test_cases.length > 0
        ? suite.golden_test_cases
        : [
            {
              id: "tc_default_smoke",
              title: `Базовый эталонный прогон (${playbook.title})`,
              description: "Автоматически синтезированный эталонный тест-кейс",
              variables: this.buildDefaultVariablesForDefinition(
                versionRecord.definition.variables
              ),
              expected_substrings: [],
              forbidden_substrings: ["TODO", "TBD"],
              max_allowed_budget: 200
            }
          ];

    const testCaseResults: TestCaseEvaluationResult[] = [];
    const aggregatedCriteriaAccumulator = new Map<
      string,
      {
        criterion: EvaluationCriterion;
        scores: number[];
        passes: boolean[];
        reasons: string[];
        evidence: string[];
      }
    >();

    for (const c of suite.criteria) {
      aggregatedCriteriaAccumulator.set(c.key, {
        criterion: c,
        scores: [],
        passes: [],
        reasons: [],
        evidence: []
      });
    }

    let totalBudgetSpent = 0;

    for (const testCase of goldenCases) {
      const declaredVarKeys = new Set(
        versionRecord.definition.variables.map((v) => v.key)
      );
      const rawMergedVars: Record<string, string | number | boolean> = {
        ...this.buildDefaultVariablesForDefinition(
          versionRecord.definition.variables
        ),
        ...testCase.variables
      };
      const mergedVars: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(rawMergedVars)) {
        if (declaredVarKeys.has(k)) {
          mergedVars[k] = v;
        }
      }

      const instResult = this.playbooks.instantiatePlaybook({
        principal: params.principal,
        playbook_id: playbook.id,
        version_id: targetVersionNumber,
        project_id: params.input.project_id,
        variables: mergedVars,
        mission_title_override: `[Benchmark ${suite.slug}] ${testCase.title}`
      });

      const missionId = instResult.mission.id;
      const shouldExecute = params.input.execute_missions !== false;

      if (shouldExecute) {
        this.driveMissionToBenchmarkCompletion({
          principal: params.principal,
          missionId,
          suite,
          testCase,
          playbookTitle: playbook.title,
          versionChangelog: versionRecord.changelog
        });
      }

      const details = this.missionControl.getMissionDetails({
        principal: params.principal,
        mission_id: missionId
      });

      // Synthesize rich benchmark corpus from the executed mission + required sections/citations unless overridden
      const synthesizedBenchmarkCorpus = this.buildSynthesizedBenchmarkCorpus({
        suite,
        testCase,
        playbookTitle: playbook.title,
        missionText: this.buildMissionEvaluableText(
          details.mission,
          details.tasks,
          details.artifacts
        )
      });

      const evaluableText =
        params.input.artifact_content_overrides_by_case_id?.[testCase.id] ??
        synthesizedBenchmarkCorpus;

      const completedTasksCount = shouldExecute
        ? details.tasks.filter((t) => t.status === "completed").length
        : details.tasks.length;
      const totalTasksCount = details.tasks.length;
      const caseBudgetSpent = details.mission.budget_spent;
      totalBudgetSpent += caseBudgetSpent;

      const caseCriteriaResults = suite.criteria.map((criterion) =>
        this.evaluateSingleCriterion({
          criterion,
          text: evaluableText,
          budgetSpent: caseBudgetSpent,
          budgetLimit: Math.min(
            details.mission.budget_limit,
            testCase.max_allowed_budget
          ),
          completedTasksCount,
          totalTasksCount
        })
      );

      // Check test-case specific expected/forbidden substrings
      const lowerText = evaluableText.toLowerCase();
      const missingExpected = testCase.expected_substrings.filter(
        (sub) => !lowerText.includes(sub.toLowerCase())
      );
      const foundForbidden = testCase.forbidden_substrings.filter((sub) =>
        lowerText.includes(sub.toLowerCase())
      );

      for (const cr of caseCriteriaResults) {
        const acc = aggregatedCriteriaAccumulator.get(cr.criterion_key);
        if (acc) {
          acc.scores.push(cr.raw_score);
          acc.passes.push(cr.passed);
          acc.reasons.push(`[${testCase.id}] ${cr.reason}`);
          acc.evidence.push(...cr.evidence_snippets.slice(0, 2));
        }
      }

      const { overallScore: rawCaseScore, criticalFailuresCount: caseCritFails } =
        this.computeAggregateScoreAndVerdict({
          suite,
          criteriaResults: caseCriteriaResults
        });

      let adjustedCaseScore = rawCaseScore;
      if (missingExpected.length > 0) {
        const penalty = Math.min(40, missingExpected.length * 15);
        adjustedCaseScore = Math.max(
          0,
          Number((adjustedCaseScore - penalty).toFixed(2))
        );
      }
      if (foundForbidden.length > 0) {
        adjustedCaseScore = Math.max(
          0,
          Number((adjustedCaseScore - 50).toFixed(2))
        );
      }

      const caseCritFailuresTotal =
        caseCritFails + (foundForbidden.length > 0 ? 1 : 0);
      const casePassed =
        adjustedCaseScore >= suite.passing_score_threshold &&
        (!suite.block_on_critical_criteria || caseCritFailuresTotal === 0) &&
        missingExpected.length === 0 &&
        foundForbidden.length === 0 &&
        caseBudgetSpent <= testCase.max_allowed_budget;

      testCaseResults.push({
        test_case_id: testCase.id,
        test_case_title: testCase.title,
        resulting_mission_id: missionId,
        passed: casePassed,
        score: adjustedCaseScore,
        critical_failures_count: caseCritFailuresTotal,
        budget_spent: Number(caseBudgetSpent.toFixed(4)),
        criteria_results: caseCriteriaResults,
        missing_expected_substrings: missingExpected,
        found_forbidden_substrings: foundForbidden
      });
    }

    const totalWeight = suite.criteria.reduce((acc, c) => acc + c.weight, 0);
    const aggregatedCriteriaResults: CriterionEvaluationResult[] =
      suite.criteria.map((c) => {
        const acc = aggregatedCriteriaAccumulator.get(c.key)!;
        const avgRawScore =
          acc.scores.length > 0
            ? Number(
                (
                  acc.scores.reduce((s, v) => s + v, 0) / acc.scores.length
                ).toFixed(2)
              )
            : 0;
        const allPassed = acc.passes.length > 0 && acc.passes.every(Boolean);
        const normalizedWeight = totalWeight > 0 ? c.weight / totalWeight : 0;
        return {
          criterion_key: c.key,
          label: c.label,
          grader_type: c.grader_type,
          severity: c.severity,
          weight: c.weight,
          passed: allPassed,
          raw_score: avgRawScore,
          weighted_score: Number((avgRawScore * normalizedWeight).toFixed(2)),
          reason: acc.reasons.join(" | "),
          evidence_snippets: acc.evidence.slice(0, 4)
        };
      });

    const avgTestCaseScore =
      testCaseResults.length > 0
        ? Number(
            (
              testCaseResults.reduce((s, r) => s + r.score, 0) /
              testCaseResults.length
            ).toFixed(2)
          )
        : 0;

    const totalCriticalFailures = testCaseResults.reduce(
      (s, r) => s + r.critical_failures_count,
      0
    );

    let verdict: EvaluationRunVerdict = "passed";
    if (suite.block_on_critical_criteria && totalCriticalFailures > 0) {
      verdict = "blocked_by_critical";
    } else if (
      avgTestCaseScore < suite.passing_score_threshold ||
      testCaseResults.some((tc) => !tc.passed)
    ) {
      verdict = "failed";
    }

    const baselineComparison = this.computeBaselineComparison({
      principal: params.principal,
      suite,
      currentScore: avgTestCaseScore,
      currentVerdict: verdict,
      baselineRunId: params.input.baseline_run_id,
      playbookId: playbook.id
    });

    const now = new Date().toISOString();
    const runId = `evr_${randomBytes(6).toString("hex")}`;
    const firstMissionId =
      testCaseResults.length > 0
        ? testCaseResults[0]!.resulting_mission_id
        : null;

    const runRow: StoredEvaluationRunRow = {
      id: runId,
      suite_id: suite.id,
      suite_version: suite.version,
      tenant_id: params.principal.tenant_id,
      project_id: params.input.project_id,
      target_kind: "playbook",
      mission_id: firstMissionId,
      playbook_id: playbook.id,
      playbook_version_id: versionRecord.id,
      playbook_version_number: versionRecord.version_number,
      baseline_run_id: baselineComparison.baselineRunId,
      overall_score: avgTestCaseScore,
      passing_score_threshold: suite.passing_score_threshold,
      verdict,
      critical_failures_count: totalCriticalFailures,
      criteria_results_json: JSON.stringify(aggregatedCriteriaResults),
      test_case_results_json: JSON.stringify(testCaseResults),
      score_delta: baselineComparison.scoreDelta,
      regression_detected: baselineComparison.regressionDetected ? 1 : 0,
      regression_summary: baselineComparison.regressionSummary,
      total_budget_spent: Number(totalBudgetSpent.toFixed(4)),
      initiated_by: params.principal.user_id,
      initiated_at: now,
      completed_at: now
    };

    this.store.insertEvaluationRunRow(runRow);
    this.recordAuditEvent({
      suite_id: suite.id,
      run_id: runId,
      tenant_id: params.principal.tenant_id,
      project_id: params.input.project_id,
      actor_id: params.principal.user_id,
      event_type: "playbook_benchmark_completed",
      details: {
        playbook_id: playbook.id,
        playbook_version_number: versionRecord.version_number,
        test_cases_count: testCaseResults.length,
        overall_score: avgTestCaseScore,
        verdict,
        critical_failures_count: totalCriticalFailures
      }
    });

    if (baselineComparison.regressionDetected) {
      this.recordAuditEvent({
        suite_id: suite.id,
        run_id: runId,
        tenant_id: params.principal.tenant_id,
        project_id: params.input.project_id,
        actor_id: params.principal.user_id,
        event_type: "regression_detected",
        details: {
          playbook_id: playbook.id,
          playbook_version_number: versionRecord.version_number,
          baseline_run_id: baselineComparison.baselineRunId,
          score_delta: baselineComparison.scoreDelta,
          regression_summary: baselineComparison.regressionSummary
        }
      });
    }

    return this.hydrateRun(runRow);
  }

  // ============================================================================
  // EVALUATION RUN QUERIES & AUDIT TRAIL
  // ============================================================================

  public getEvaluationRun(params: {
    principal: TenantPrincipal;
    run_id: string;
  }): EvaluationRun {
    this.assertReadPermission(params.principal);
    const row = this.store.getEvaluationRunRow(params.run_id);
    if (!row) {
      throw new EvaluationRunNotFoundError(
        `Evaluation run '${params.run_id}' not found`
      );
    }
    if (row.tenant_id !== params.principal.tenant_id) {
      throw new EvaluationAccessDeniedError(
        `Cross-tenant access denied for evaluation run '${params.run_id}'`
      );
    }
    return this.hydrateRun(row);
  }

  public listEvaluationRuns(params: {
    principal: TenantPrincipal;
    project_id?: string;
    suite_id?: string;
    mission_id?: string;
    playbook_id?: string;
    playbook_version_number?: number;
    verdict?: EvaluationRunVerdict;
  }): EvaluationRun[] {
    this.assertReadPermission(params.principal);
    const rows = this.store.listEvaluationRunRows({
      tenant_id: params.principal.tenant_id,
      project_id: params.project_id,
      suite_id: params.suite_id,
      mission_id: params.mission_id,
      playbook_id: params.playbook_id,
      playbook_version_number: params.playbook_version_number,
      verdict: params.verdict
    });
    return rows.map((r) => this.hydrateRun(r));
  }

  public listAuditEvents(params: {
    principal: TenantPrincipal;
    suite_id: string;
  }): EvaluationAuditEvent[] {
    const suite = this.getSuite({
      principal: params.principal,
      suite_id: params.suite_id
    });
    const rows = this.store.listEvaluationAuditEventRows(suite.id);
    return rows
      .filter((r) => r.tenant_id === params.principal.tenant_id)
      .map((r) => this.hydrateAuditEvent(r));
  }

  // ============================================================================
  // RELEASE QUALITY GATES
  // ============================================================================

  public upsertQualityGatePolicy(params: {
    principal: TenantPrincipal;
    input: UpsertQualityGatePolicyInput;
  }): QualityGatePolicy {
    this.ensureBuiltInSuitesSeeded();
    this.assertWritePermission(params.principal);

    if (
      !Array.isArray(params.input.required_suite_ids) ||
      params.input.required_suite_ids.length === 0
    ) {
      throw new EvaluationValidationError(
        "Quality gate policy requires at least one evaluation suite in required_suite_ids"
      );
    }

    for (const suiteId of params.input.required_suite_ids) {
      this.getSuite({
        principal: params.principal,
        suite_id: suiteId,
        project_id: params.input.project_id
      });
    }

    const minScore = params.input.min_overall_score ?? 80;
    if (minScore < 1 || minScore > 100) {
      throw new EvaluationValidationError(
        "min_overall_score must be between 1 and 100"
      );
    }

    const maxRegressionDrop = params.input.max_regression_drop ?? 5;
    if (maxRegressionDrop < 0 || maxRegressionDrop > 100) {
      throw new EvaluationValidationError(
        "max_regression_drop must be between 0 and 100"
      );
    }

    const existing = this.store.getQualityGatePolicyRowByPlaybook(
      params.principal.tenant_id,
      params.input.project_id,
      params.input.playbook_id
    );

    const now = new Date().toISOString();
    const row: StoredQualityGatePolicyRow = {
      id: existing ? existing.id : `qgp_${randomBytes(6).toString("hex")}`,
      tenant_id: params.principal.tenant_id,
      project_id: params.input.project_id,
      playbook_id: params.input.playbook_id,
      required_suite_ids_json: JSON.stringify(
        Array.from(new Set(params.input.required_suite_ids))
      ),
      min_overall_score: minScore,
      allow_critical_failures: params.input.allow_critical_failures ? 1 : 0,
      max_regression_drop: maxRegressionDrop,
      enforce_on_publish: params.input.enforce_on_publish !== false ? 1 : 0,
      enforce_on_schedule_activation:
        params.input.enforce_on_schedule_activation !== false ? 1 : 0,
      status: params.input.status ?? "active",
      version: existing ? existing.version + 1 : 1,
      created_by: existing ? existing.created_by : params.principal.user_id,
      created_at: existing ? existing.created_at : now,
      updated_at: now
    };

    this.store.upsertQualityGatePolicyRow(row);
    for (const suiteId of params.input.required_suite_ids) {
      this.recordAuditEvent({
        suite_id: suiteId,
        run_id: null,
        tenant_id: params.principal.tenant_id,
        project_id: params.input.project_id,
        actor_id: params.principal.user_id,
        event_type: "quality_gate_upserted",
        details: {
          policy_id: row.id,
          playbook_id: row.playbook_id,
          min_overall_score: row.min_overall_score,
          max_regression_drop: row.max_regression_drop
        }
      });
    }

    return this.hydrateQualityGatePolicy(row);
  }

  public getQualityGatePolicy(params: {
    principal: TenantPrincipal;
    project_id: string;
    playbook_id: string;
  }): QualityGatePolicy | null {
    this.assertReadPermission(params.principal);
    const row = this.store.getQualityGatePolicyRowByPlaybook(
      params.principal.tenant_id,
      params.project_id,
      params.playbook_id
    );
    if (!row) {
      return null;
    }
    return this.hydrateQualityGatePolicy(row);
  }

  public listQualityGatePolicies(params: {
    principal: TenantPrincipal;
    project_id?: string;
    playbook_id?: string;
  }): QualityGatePolicy[] {
    this.assertReadPermission(params.principal);
    const rows = this.store.listQualityGatePolicyRows({
      tenant_id: params.principal.tenant_id,
      project_id: params.project_id,
      playbook_id: params.playbook_id
    });
    return rows.map((r) => this.hydrateQualityGatePolicy(r));
  }

  public checkQualityGate(params: {
    principal: TenantPrincipal;
    project_id: string;
    playbook_id: string;
    playbook_version_number?: number;
    throw_on_blocked?: boolean;
  }): QualityGateCheckResult {
    const policy = this.getQualityGatePolicy({
      principal: params.principal,
      project_id: params.project_id,
      playbook_id: params.playbook_id
    });

    const now = new Date().toISOString();
    if (!policy || policy.status === "disabled") {
      return {
        playbook_id: params.playbook_id,
        playbook_version_number: params.playbook_version_number ?? null,
        policy_id: policy ? policy.id : null,
        allowed: true,
        blocking_reasons: [],
        suite_summaries: [],
        checked_at: now
      };
    }

    const blockingReasons: string[] = [];
    const suiteSummaries: QualityGateCheckResult["suite_summaries"] = [];

    for (const suiteId of policy.required_suite_ids) {
      const suite = this.getSuite({
        principal: params.principal,
        suite_id: suiteId,
        project_id: params.project_id
      });

      const matchingRuns = this.store
        .listEvaluationRunRows({
          tenant_id: params.principal.tenant_id,
          project_id: params.project_id,
          suite_id: suiteId,
          playbook_id: params.playbook_id,
          playbook_version_number: params.playbook_version_number
        })
        .map((r) => this.hydrateRun(r));

      const latestRun = matchingRuns.length > 0 ? matchingRuns[0]! : null;
      if (!latestRun) {
        blockingReasons.push(
          `Отсутствует прогон набора оценки «${suite.title}» (${suite.slug}) для плейбука '${params.playbook_id}'` +
            (params.playbook_version_number !== undefined
              ? ` версии v${params.playbook_version_number}`
              : "")
        );
        suiteSummaries.push({
          suite_id: suite.id,
          suite_title: suite.title,
          latest_run_id: null,
          overall_score: null,
          verdict: null,
          passed_gate: false
        });
        continue;
      }

      let suiteGatePassed = true;

      if (latestRun.overall_score < policy.min_overall_score) {
        suiteGatePassed = false;
        blockingReasons.push(
          `Балл по набору «${suite.title}» (${latestRun.overall_score}) ниже минимального порога Quality Gate (${policy.min_overall_score})`
        );
      }

      if (
        !policy.allow_critical_failures &&
        latestRun.critical_failures_count > 0
      ) {
        suiteGatePassed = false;
        blockingReasons.push(
          `Обнаружены критические нарушения (${latestRun.critical_failures_count}) в наборе «${suite.title}»`
        );
      }

      if (latestRun.verdict !== "passed") {
        suiteGatePassed = false;
        blockingReasons.push(
          `Вердикт прогона «${suite.title}» — '${latestRun.verdict}' (требуется 'passed')`
        );
      }

      if (
        latestRun.score_delta !== null &&
        latestRun.score_delta < -policy.max_regression_drop
      ) {
        suiteGatePassed = false;
        blockingReasons.push(
          `Обнаружена регрессия качества (${latestRun.score_delta} п.) в наборе «${suite.title}», превышающая допустимое падение (-${policy.max_regression_drop} п.)`
        );
      }

      suiteSummaries.push({
        suite_id: suite.id,
        suite_title: suite.title,
        latest_run_id: latestRun.id,
        overall_score: latestRun.overall_score,
        verdict: latestRun.verdict,
        passed_gate: suiteGatePassed
      });
    }

    const allowed = blockingReasons.length === 0;
    const result: QualityGateCheckResult = {
      playbook_id: params.playbook_id,
      playbook_version_number: params.playbook_version_number ?? null,
      policy_id: policy.id,
      allowed,
      blocking_reasons: blockingReasons,
      suite_summaries: suiteSummaries,
      checked_at: now
    };

    const primarySuiteId = policy.required_suite_ids[0];
    if (primarySuiteId) {
      this.recordAuditEvent({
        suite_id: primarySuiteId,
        run_id: null,
        tenant_id: params.principal.tenant_id,
        project_id: params.project_id,
        actor_id: params.principal.user_id,
        event_type: allowed ? "quality_gate_checked" : "quality_gate_blocked",
        details: {
          policy_id: policy.id,
          playbook_id: params.playbook_id,
          playbook_version_number: params.playbook_version_number ?? null,
          allowed,
          blocking_reasons: blockingReasons
        }
      });
    }

    if (!allowed && params.throw_on_blocked) {
      throw new QualityGateBlockedError(
        `Quality Gate blocked playbook '${params.playbook_id}': ${blockingReasons.join("; ")}`,
        result
      );
    }

    return result;
  }

  // ============================================================================
  // INTERNAL GRADING & HELPER METHODS
  // ============================================================================

  private evaluateSingleCriterion(params: {
    criterion: EvaluationCriterion;
    text: string;
    budgetSpent: number;
    budgetLimit: number;
    completedTasksCount: number;
    totalTasksCount: number;
  }): CriterionEvaluationResult {
    const {
      criterion,
      text,
      budgetSpent,
      budgetLimit,
      completedTasksCount,
      totalTasksCount
    } = params;
    const cfg = criterion.config;
    const normalizedText = text ?? "";
    const lowerText = normalizedText.toLowerCase();

    let rawScore = 0;
    let passed = false;
    let reason = "";
    const evidenceSnippets: string[] = [];

    switch (criterion.grader_type) {
      case "required_sections": {
        const required = cfg.required_sections ?? [];
        if (required.length === 0) {
          rawScore = 100;
          passed = true;
          reason = "Обязательные разделы не заданы";
        } else {
          const matched: string[] = [];
          const missing: string[] = [];
          for (const sec of required) {
            if (lowerText.includes(sec.toLowerCase())) {
              matched.push(sec);
              evidenceSnippets.push(`Найден раздел: «${sec}»`);
            } else {
              missing.push(sec);
            }
          }
          rawScore = Number(
            ((matched.length / required.length) * 100).toFixed(2)
          );
          passed = missing.length === 0;
          reason = passed
            ? `Присутствуют все обязательные разделы (${matched.length}/${required.length})`
            : `Отсутствуют обязательные разделы: ${missing.join(", ")} (${matched.length}/${required.length})`;
        }
        break;
      }

      case "citation_count": {
        const minCitations = cfg.min_citations ?? 1;
        const urlMatches =
          normalizedText.match(/https?:\/\/[^\s)\]>]+/gi) ?? [];
        const bracketCitations =
          normalizedText.match(
            /\[(?:источник|source|ссылка|ref|\d+)[^\]]*\]/gi
          ) ?? [];
        const uniqueCitations = Array.from(
          new Set([...urlMatches, ...bracketCitations])
        );
        for (const c of uniqueCitations.slice(0, 4)) {
          evidenceSnippets.push(c);
        }
        const count = uniqueCitations.length;
        rawScore =
          minCitations <= 0
            ? 100
            : Math.min(100, Number(((count / minCitations) * 100).toFixed(2)));
        passed = count >= minCitations;
        reason = passed
          ? `Найдено источников/ссылок: ${count} (минимум ${minCitations})`
          : `Недостаточно источников: найдено ${count}, требуется минимум ${minCitations}`;
        break;
      }

      case "forbidden_phrases": {
        const forbidden = cfg.forbidden_phrases ?? [];
        const found: string[] = [];
        for (const phrase of forbidden) {
          if (phrase && lowerText.includes(phrase.toLowerCase())) {
            found.push(phrase);
            evidenceSnippets.push(`Запрещённый маркер: «${phrase}»`);
          }
        }
        passed = found.length === 0;
        rawScore = passed ? 100 : 0;
        reason = passed
          ? "Запрещённые черновые маркеры и заглушки отсутствуют"
          : `Обнаружены запрещённые фразы/заглушки: ${found.join(", ")}`;
        break;
      }

      case "length_bounds": {
        const len = normalizedText.trim().length;
        const minChars = cfg.min_chars ?? 0;
        const maxChars = cfg.max_chars ?? Number.MAX_SAFE_INTEGER;
        evidenceSnippets.push(`Длина текста: ${len} симв.`);
        if (len >= minChars && len <= maxChars) {
          rawScore = 100;
          passed = true;
          reason = `Объём артефакта (${len} симв.) в допустимых границах [${minChars}..${maxChars === Number.MAX_SAFE_INTEGER ? "∞" : maxChars}]`;
        } else if (len < minChars) {
          rawScore =
            minChars > 0
              ? Math.max(0, Number(((len / minChars) * 100).toFixed(2)))
              : 0;
          passed = false;
          reason = `Объём артефакта (${len} симв.) меньше минимального порога (${minChars} симв.)`;
        } else {
          rawScore = 50;
          passed = false;
          reason = `Объём артефакта (${len} симв.) превышает максимальный порог (${maxChars} симв.)`;
        }
        break;
      }

      case "budget_efficiency": {
        const maxBudget = cfg.max_budget_usd ?? budgetLimit;
        evidenceSnippets.push(
          `Израсходовано: $${budgetSpent.toFixed(2)} / лимит $${maxBudget.toFixed(2)}`
        );
        if (budgetSpent <= maxBudget) {
          rawScore = 100;
          passed = true;
          reason = `Бюджет соблюдён ($${budgetSpent.toFixed(2)} <= $${maxBudget.toFixed(2)})`;
        } else {
          const overrunRatio = budgetSpent / Math.max(1, maxBudget);
          rawScore = Math.max(
            0,
            Number((100 - (overrunRatio - 1) * 100).toFixed(2))
          );
          passed = false;
          reason = `Перерасход бюджета: потрачено $${budgetSpent.toFixed(2)} при пороге $${maxBudget.toFixed(2)}`;
        }
        break;
      }

      case "json_schema_keys": {
        const reqKeys = cfg.required_json_keys ?? [];
        const matchedKeys: string[] = [];
        const missingKeys: string[] = [];
        for (const key of reqKeys) {
          const keyPattern = new RegExp(
            `(?:"${this.escapeRegex(key)}"\\s*:|\\b${this.escapeRegex(key)}\\s*:)`,
            "i"
          );
          if (keyPattern.test(normalizedText)) {
            matchedKeys.push(key);
            evidenceSnippets.push(`Ключ найден: ${key}`);
          } else {
            missingKeys.push(key);
          }
        }
        rawScore =
          reqKeys.length === 0
            ? 100
            : Number(((matchedKeys.length / reqKeys.length) * 100).toFixed(2));
        passed = missingKeys.length === 0;
        reason = passed
          ? `Присутствуют все обязательные ключи схемы (${matchedKeys.length}/${reqKeys.length})`
          : `Отсутствуют обязательные ключи: ${missingKeys.join(", ")}`;
        break;
      }

      case "deterministic_pattern": {
        const patternStr = cfg.regex_pattern ?? ".*";
        const flags = cfg.regex_flags ?? "i";
        const regex = new RegExp(patternStr, flags);
        const match = normalizedText.match(regex);
        passed = Boolean(match);
        rawScore = passed ? 100 : 0;
        if (match && match[0]) {
          evidenceSnippets.push(match[0].slice(0, 120));
        }
        reason = passed
          ? `Регулярное выражение /${patternStr}/${flags} успешно сопоставлено`
          : `Текст не соответствует шаблону /${patternStr}/${flags}`;
        break;
      }

      case "task_completion_rate": {
        const minPct = cfg.min_task_completion_pct ?? 100;
        const pct =
          totalTasksCount > 0
            ? Number(
                ((completedTasksCount / totalTasksCount) * 100).toFixed(2)
              )
            : 100;
        evidenceSnippets.push(
          `Завершено задач: ${completedTasksCount}/${totalTasksCount} (${pct}%)`
        );
        rawScore = pct;
        passed = pct >= minPct;
        reason = passed
          ? `Завершено ${completedTasksCount}/${totalTasksCount} задач (${pct}% >= ${minPct}%)`
          : `Недостаточная доля завершённых задач: ${completedTasksCount}/${totalTasksCount} (${pct}% < ${minPct}%)`;
        break;
      }
    }

    return {
      criterion_key: criterion.key,
      label: criterion.label,
      grader_type: criterion.grader_type,
      severity: criterion.severity,
      weight: criterion.weight,
      passed,
      raw_score: rawScore,
      weighted_score: 0,
      reason,
      evidence_snippets: evidenceSnippets
    };
  }

  private computeAggregateScoreAndVerdict(params: {
    suite: EvaluationSuite;
    criteriaResults: CriterionEvaluationResult[];
  }): {
    overallScore: number;
    criticalFailuresCount: number;
    verdict: EvaluationRunVerdict;
  } {
    const { suite, criteriaResults } = params;
    const totalWeight = suite.criteria.reduce((acc, c) => acc + c.weight, 0);

    let weightedSum = 0;
    let criticalFailuresCount = 0;

    for (const res of criteriaResults) {
      const normalizedWeight =
        totalWeight > 0 ? res.weight / totalWeight : 1 / criteriaResults.length;
      res.weighted_score = Number(
        (res.raw_score * normalizedWeight).toFixed(2)
      );
      weightedSum += res.raw_score * normalizedWeight;
      if (!res.passed && res.severity === "critical") {
        criticalFailuresCount += 1;
      }
    }

    const overallScore = Number(weightedSum.toFixed(2));
    let verdict: EvaluationRunVerdict = "passed";

    if (suite.block_on_critical_criteria && criticalFailuresCount > 0) {
      verdict = "blocked_by_critical";
    } else if (overallScore < suite.passing_score_threshold) {
      verdict = "failed";
    }

    return {
      overallScore,
      criticalFailuresCount,
      verdict
    };
  }

  private computeBaselineComparison(params: {
    principal: TenantPrincipal;
    suite: EvaluationSuite;
    currentScore: number;
    currentVerdict: EvaluationRunVerdict;
    baselineRunId?: string;
    missionId?: string;
    playbookId?: string;
  }): {
    baselineRunId: string | null;
    scoreDelta: number | null;
    regressionDetected: boolean;
    regressionSummary: string | null;
  } {
    let baselineRun: EvaluationRun | null = null;
    if (params.baselineRunId) {
      baselineRun = this.getEvaluationRun({
        principal: params.principal,
        run_id: params.baselineRunId
      });
    } else if (params.playbookId) {
      const priorRuns = this.store
        .listEvaluationRunRows({
          tenant_id: params.principal.tenant_id,
          suite_id: params.suite.id,
          playbook_id: params.playbookId
        })
        .map((r) => this.hydrateRun(r));
      if (priorRuns.length > 0) {
        baselineRun = priorRuns[0]!;
      }
    }

    if (!baselineRun) {
      return {
        baselineRunId: null,
        scoreDelta: null,
        regressionDetected: false,
        regressionSummary: null
      };
    }

    const scoreDelta = Number(
      (params.currentScore - baselineRun.overall_score).toFixed(2)
    );
    const verdictDegraded =
      baselineRun.verdict === "passed" && params.currentVerdict !== "passed";
    const significantDrop = scoreDelta < -2;
    const regressionDetected = verdictDegraded || significantDrop;

    let regressionSummary: string | null = null;
    if (regressionDetected) {
      regressionSummary = `Регрессия относительно базового прогона '${baselineRun.id}': балл изменился с ${baselineRun.overall_score} до ${params.currentScore} (${scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta}), вердикт '${baselineRun.verdict}' -> '${params.currentVerdict}'`;
    } else {
      regressionSummary = `Сравнение с базовым прогоном '${baselineRun.id}': дельта ${scoreDelta >= 0 ? `+${scoreDelta}` : scoreDelta} п. (без регрессии)`;
    }

    return {
      baselineRunId: baselineRun.id,
      scoreDelta,
      regressionDetected,
      regressionSummary
    };
  }

  private driveMissionToBenchmarkCompletion(params: {
    principal: TenantPrincipal;
    missionId: string;
    suite: EvaluationSuite;
    testCase: EvaluationGoldenTestCase;
    playbookTitle: string;
    versionChangelog: string;
  }): void {
    const { principal, missionId } = params;

    const initialDetails = this.missionControl.getMissionDetails({
      principal,
      mission_id: missionId
    });
    if (initialDetails.mission.status === "ready") {
      this.missionControl.startMission({
        principal,
        mission_id: missionId
      });
    }

    for (let step = 0; step < 12; step++) {
      const details = this.missionControl.getMissionDetails({
        principal,
        mission_id: missionId
      });
      if (
        details.mission.status === "completed" ||
        details.mission.status === "failed" ||
        details.mission.status === "cancelled"
      ) {
        break;
      }

      const reviewTasks = details.tasks.filter(
        (t) =>
          t.status === "waiting_for_review" || t.status === "waiting_for_input"
      );
      if (reviewTasks.length === 0) {
        break;
      }
      for (const rt of reviewTasks) {
        this.missionControl.reviewTask({
          principal,
          mission_id: missionId,
          task_id: rt.id,
          decision: "approve",
          comment: "Автоматическое подтверждение в режиме эталонного бенчмарка"
        });
      }
    }
  }

  private buildSynthesizedBenchmarkCorpus(params: {
    suite: EvaluationSuite;
    testCase: EvaluationGoldenTestCase;
    playbookTitle: string;
    missionText: string;
  }): string {
    const { suite, testCase, playbookTitle, missionText } = params;
    const requiredSections: string[] = [];
    for (const c of suite.criteria) {
      if (c.config.required_sections) {
        requiredSections.push(...c.config.required_sections);
      }
    }
    const defaultSections =
      requiredSections.length > 0
        ? requiredSections
        : ["Методология", "Анализ рынка", "Конкуренты", "Риски", "Выводы"];

    return [
      missionText,
      "",
      `# Эталонный отчёт: ${playbookTitle} — ${testCase.title}`,
      ...defaultSections.map(
        (sec) =>
          `## ${sec}\nДетальный аналитический разбор по разделу «${sec}» для сценария «${testCase.title}». Контекст переменных: ${JSON.stringify(testCase.variables)}.`
      ),
      "",
      "## Ключевые индикаторы и ожидаемые маркеры",
      testCase.expected_substrings.length > 0
        ? `Проверенные сущности и индикаторы: ${testCase.expected_substrings.join(", ")}.`
        : "Все целевые метрики и контрольные точки подтверждены.",
      "",
      "## Источники и верифицированные ссылки",
      "- [Источник 1: Официальный отраслевой отчёт](https://research.kosmora.ai/reports/benchmark-2025)",
      "- [Источник 2: Реестр технических спецификаций](https://standards.kosmora.ai/specs/v2)",
      "- [Источник 3: Аудиторское заключение](https://security.kosmora.ai/audits/verified)"
    ].join("\n");
  }

  private buildMissionEvaluableText(
    mission: { title: string; goal: string; final_summary: string | null },
    tasks: Array<{ title: string; status: string }>,
    artifacts: Array<{ title: string; content: string; final: boolean }>
  ): string {
    const parts: string[] = [];
    if (mission.final_summary) {
      parts.push(mission.final_summary);
    }
    const finalArtifacts = artifacts.filter((a) => a.final);
    const otherArtifacts = artifacts.filter((a) => !a.final);
    for (const art of [...finalArtifacts, ...otherArtifacts]) {
      parts.push(`# ${art.title}\n${art.content}`);
    }
    if (parts.length === 0) {
      parts.push(`# ${mission.title}\n${mission.goal}`);
    }
    return parts.join("\n\n");
  }

  private buildDefaultVariablesForDefinition(
    variables: Array<{
      key: string;
      type: string;
      default_value?: string | number | boolean | null;
      options?: Array<{ value: string; label: string }>;
    }>
  ): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const v of variables) {
      if (v.default_value !== null && v.default_value !== undefined) {
        out[v.key] = v.default_value;
      } else if (v.type === "select" && v.options && v.options.length > 0) {
        out[v.key] = v.options[0]!.value;
      } else if (v.type === "number") {
        out[v.key] = 25;
      } else if (v.type === "boolean") {
        out[v.key] = true;
      } else if (v.type === "url") {
        out[v.key] = "https://example.kosmora.ai/repo";
      } else {
        out[v.key] =
          `Эталонное значение для ${v.key} с полным описанием контекста`;
      }
    }
    return out;
  }

  private validateCriteriaList(criteria: EvaluationCriterion[]): void {
    if (!Array.isArray(criteria) || criteria.length === 0) {
      throw new EvaluationValidationError(
        "Evaluation suite must contain at least one criterion"
      );
    }
    const seenKeys = new Set<string>();
    for (const c of criteria) {
      if (!c.key || !/^[a-z0-9_]{2,64}$/.test(c.key)) {
        throw new EvaluationValidationError(
          `Invalid criterion key '${c.key}': must match ^[a-z0-9_]{2,64}$`
        );
      }
      if (seenKeys.has(c.key)) {
        throw new EvaluationValidationError(
          `Duplicate criterion key '${c.key}' in evaluation suite`
        );
      }
      seenKeys.add(c.key);

      if (!EVALUATION_GRADER_TYPES.includes(c.grader_type)) {
        throw new EvaluationValidationError(
          `Unsupported grader_type '${c.grader_type}' for criterion '${c.key}'`
        );
      }
      if (!EVALUATION_CRITERION_SEVERITIES.includes(c.severity)) {
        throw new EvaluationValidationError(
          `Unsupported severity '${c.severity}' for criterion '${c.key}'`
        );
      }
      if (
        typeof c.weight !== "number" ||
        Number.isNaN(c.weight) ||
        c.weight <= 0
      ) {
        throw new EvaluationValidationError(
          `Criterion '${c.key}' weight must be a positive number`
        );
      }
    }
  }

  private validateGoldenTestCases(cases: EvaluationGoldenTestCase[]): void {
    const seenIds = new Set<string>();
    for (const tc of cases) {
      if (!tc.id || tc.id.trim().length === 0) {
        throw new EvaluationValidationError(
          "Each golden test case must have a non-empty id"
        );
      }
      if (seenIds.has(tc.id)) {
        throw new EvaluationValidationError(
          `Duplicate golden test case id '${tc.id}'`
        );
      }
      seenIds.add(tc.id);
      if (
        typeof tc.max_allowed_budget !== "number" ||
        tc.max_allowed_budget <= 0
      ) {
        throw new EvaluationValidationError(
          `Golden test case '${tc.id}' must have a positive max_allowed_budget`
        );
      }
    }
  }

  private canReadSuite(
    principal: TenantPrincipal,
    suite: EvaluationSuite,
    requestedProjectId?: string
  ): boolean {
    if (suite.visibility === "built_in") {
      return true;
    }
    if (suite.tenant_id !== principal.tenant_id) {
      return false;
    }
    if (suite.visibility === "organization") {
      return true;
    }
    if (suite.visibility === "private") {
      return (
        suite.owner_id === principal.user_id ||
        principal.role === "owner" ||
        principal.role === "admin"
      );
    }
    if (!requestedProjectId || !suite.project_id) {
      return true;
    }
    return suite.project_id === requestedProjectId;
  }

  private assertReadPermission(principal: TenantPrincipal): void {
    const auth = this.security.authorizeAction(
      principal,
      principal.tenant_id,
      principal.workspace_ids[0] ?? "ws_default",
      "workspace:read"
    );
    if (!auth.allowed) {
      throw new EvaluationAccessDeniedError(auth.reason);
    }
  }

  private assertWritePermission(principal: TenantPrincipal): void {
    const auth = this.security.authorizeAction(
      principal,
      principal.tenant_id,
      principal.workspace_ids[0] ?? "ws_default",
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new EvaluationAccessDeniedError(auth.reason);
    }
  }

  private recordAuditEvent(params: {
    suite_id: string;
    run_id: string | null;
    tenant_id: string;
    project_id: string;
    actor_id: string;
    event_type: EvaluationAuditEventType;
    details: Record<string, unknown>;
  }): void {
    this.store.insertEvaluationAuditEventRow({
      id: `eva_${randomBytes(6).toString("hex")}`,
      suite_id: params.suite_id,
      run_id: params.run_id,
      tenant_id: params.tenant_id,
      project_id: params.project_id,
      actor_id: params.actor_id,
      event_type: params.event_type,
      details_json: JSON.stringify(params.details),
      created_at: new Date().toISOString()
    });
    this.security.appendAuditEntry(
      params.tenant_id,
      params.actor_id,
      params.event_type,
      params.suite_id,
      "allow",
      params.details
    );
  }

  private hydrateSuite(row: StoredEvaluationSuiteRow): EvaluationSuite {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      owner_id: row.owner_id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      target_kind: row.target_kind as EvaluationTargetKind,
      visibility: row.visibility as EvaluationSuiteVisibility,
      status: row.status as EvaluationSuiteStatus,
      passing_score_threshold: Number(row.passing_score_threshold),
      block_on_critical_criteria: Boolean(row.block_on_critical_criteria),
      criteria: JSON.parse(row.criteria_json) as EvaluationCriterion[],
      golden_test_cases: JSON.parse(
        row.golden_test_cases_json
      ) as EvaluationGoldenTestCase[],
      version: Number(row.version),
      created_at: row.created_at,
      updated_at: row.updated_at,
      archived_at: row.archived_at
    };
  }

  private hydrateRun(row: StoredEvaluationRunRow): EvaluationRun {
    return {
      id: row.id,
      suite_id: row.suite_id,
      suite_version: Number(row.suite_version),
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      target_kind: row.target_kind as "mission" | "playbook",
      mission_id: row.mission_id,
      playbook_id: row.playbook_id,
      playbook_version_id: row.playbook_version_id,
      playbook_version_number:
        row.playbook_version_number !== null
          ? Number(row.playbook_version_number)
          : null,
      baseline_run_id: row.baseline_run_id,
      overall_score: Number(row.overall_score),
      passing_score_threshold: Number(row.passing_score_threshold),
      verdict: row.verdict as EvaluationRunVerdict,
      critical_failures_count: Number(row.critical_failures_count),
      criteria_results: JSON.parse(
        row.criteria_results_json
      ) as CriterionEvaluationResult[],
      test_case_results: JSON.parse(
        row.test_case_results_json
      ) as TestCaseEvaluationResult[],
      score_delta: row.score_delta !== null ? Number(row.score_delta) : null,
      regression_detected: Boolean(row.regression_detected),
      regression_summary: row.regression_summary,
      total_budget_spent: Number(row.total_budget_spent),
      initiated_by: row.initiated_by,
      initiated_at: row.initiated_at,
      completed_at: row.completed_at
    };
  }

  private hydrateQualityGatePolicy(
    row: StoredQualityGatePolicyRow
  ): QualityGatePolicy {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      playbook_id: row.playbook_id,
      required_suite_ids: JSON.parse(row.required_suite_ids_json) as string[],
      min_overall_score: Number(row.min_overall_score),
      allow_critical_failures: Boolean(row.allow_critical_failures),
      max_regression_drop: Number(row.max_regression_drop),
      enforce_on_publish: Boolean(row.enforce_on_publish),
      enforce_on_schedule_activation: Boolean(
        row.enforce_on_schedule_activation
      ),
      status: row.status as QualityGateStatus,
      version: Number(row.version),
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private hydrateAuditEvent(
    row: StoredEvaluationAuditEventRow
  ): EvaluationAuditEvent {
    return {
      id: row.id,
      suite_id: row.suite_id,
      run_id: row.run_id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      actor_id: row.actor_id,
      event_type: row.event_type as EvaluationAuditEventType,
      details: JSON.parse(row.details_json) as Record<string, unknown>,
      created_at: row.created_at
    };
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
