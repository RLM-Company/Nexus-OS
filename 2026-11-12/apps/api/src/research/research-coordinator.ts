import {
  DeterministicResearchBrowserAdapter,
  type ResearchBrowserAdapter
} from "./browser-research-adapter.js";
import {
  type CanvasResearchArtifactRecord,
  ResearchStore,
  type ResearchRunView,
  canonicalizeSourceUrl
} from "./research-store.js";
import {
  type CandidateClaimExtraction,
  DEFAULT_RESEARCH_BUDGET,
  ProjectResearchOwnerBudget,
  type ResearchBudgetLimits,
  type ResearchOwnerBudget,
  synthesizeResearchClaims
} from "./research-synthesis.js";

export interface ResearchModelPlannerGateway {
  planResearchQueries?(input: {
    query: string;
    ownerId: string;
    projectId: string | null;
  }): Promise<{ queries: string[] }>;
}

export interface StartResearchRunInput {
  ownerId: string;
  projectId?: string | null;
  query: string;
  clientRequestId?: string | null;
  expectedTargets?: Array<{ subject: string; criterion: string }>;
  budgets?: Partial<ResearchBudgetLimits>;
  includeProjectDocuments?: boolean;
  runInBackground?: boolean;
}

export interface ResearchCoordinatorOptions {
  store: ResearchStore;
  browserAdapter?: ResearchBrowserAdapter;
  gateway?: ResearchModelPlannerGateway | null;
  ownerBudget?: ResearchOwnerBudget;
  emergency?: { getProcessStop?(): unknown } | null;
  clock?: () => number;
}

const DEFAULT_EXPECTED_TARGETS: Array<{ subject: string; criterion: string }> = [
  { subject: "OrionDB", criterion: "Базовая стоимость" },
  { subject: "OrionDB", criterion: "SLA доступности" },
  { subject: "OrionDB", criterion: "Задержка p95" },
  { subject: "OrionDB", criterion: "Закрытый сертификат ФСТЭК К1" }
];

function extractClaimsFromProjectDocumentText(
  text: string,
  expectedTargets: Array<{ subject: string; criterion: string }>
): CandidateClaimExtraction[] {
  const results: CandidateClaimExtraction[] = [];
  const sentences = String(text ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    for (const target of expectedTargets) {
      if (
        lower.includes(target.subject.toLowerCase()) &&
        lower.includes(target.criterion.toLowerCase())
      ) {
        const priceMatch = sentence.match(/\$\d+(?:\.\d+)?\s*\/\s*(?:мес|год)/i);
        const pctMatch = sentence.match(/\d+(?:\.\d+)?\s*%/);
        const msMatch = sentence.match(/\d+(?:\.\d+)?\s*(?:мс|ms)/i);
        const afterColon = sentence.split(/[:—]/).pop()?.replace(/\.$/, "").trim();
        const claimedValue =
          priceMatch?.[0] ?? pctMatch?.[0] ?? msMatch?.[0] ?? afterColon ?? sentence;

        results.push({
          subject: target.subject,
          criterion: target.criterion,
          claimedValue,
          verbatimQuote: sentence
        });
      }
    }
  }
  return results;
}

export class ResearchCoordinator {
  private readonly store: ResearchStore;
  public readonly browserAdapter: ResearchBrowserAdapter;
  private readonly gateway: ResearchModelPlannerGateway | null;
  private readonly ownerBudget: ResearchOwnerBudget;
  private readonly emergency: { getProcessStop?(): unknown } | null;
  private readonly clock: () => number;
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly activePromises = new Map<string, Promise<ResearchRunView>>();
  private readonly activeRunOwner = new Map<string, string>();

  constructor(options: ResearchCoordinatorOptions) {
    this.store = options.store;
    this.browserAdapter =
      options.browserAdapter ?? new DeterministicResearchBrowserAdapter();
    this.gateway = options.gateway ?? null;
    this.ownerBudget =
      options.ownerBudget ?? new ProjectResearchOwnerBudget(this.store.sqlite);
    this.emergency = options.emergency ?? null;
    this.clock = options.clock ?? (() => Date.now());
  }

  public async startRun(input: StartResearchRunInput): Promise<ResearchRunView> {
    this.assertNotEmergencyStopped();
    const projectId = input.projectId ?? null;
    this.ownerBudget.checkCanStartRun(input.ownerId, projectId);

    const existing = this.store.findIdempotentRun({
      ownerId: input.ownerId,
      projectId,
      query: input.query,
      clientRequestId: input.clientRequestId,
      deduplicateQuery: true
    });
    if (existing) {
      return existing;
    }

    const limits = this.ownerBudget.resolveLimits(
      input.ownerId,
      projectId,
      input.budgets ?? DEFAULT_RESEARCH_BUDGET
    );

    const expectedTargets =
      input.expectedTargets && input.expectedTargets.length > 0
        ? input.expectedTargets
        : DEFAULT_EXPECTED_TARGETS;

    const hasProjectDocs =
      input.includeProjectDocuments !== false &&
      Boolean(projectId) &&
      this.store.listProjectLibraryDocuments(input.ownerId, projectId).length > 0;

    const initialSteps: Array<{
      stepKey: string;
      stepKind: "search" | "read_project_docs" | "synthesize";
      depth: number;
    }> = [{ stepKey: "search:initial", stepKind: "search", depth: 1 }];

    if (hasProjectDocs) {
      initialSteps.push({
        stepKey: "read_project_docs:library",
        stepKind: "read_project_docs",
        depth: 1
      });
    }
    initialSteps.push({ stepKey: "synthesize:final", stepKind: "synthesize", depth: 1 });

    const created = this.store.createRunWithSteps({
      ownerId: input.ownerId,
      projectId,
      query: input.query,
      clientRequestId: input.clientRequestId ?? null,
      maxDepth: limits.maxDepth,
      maxSources: limits.maxSources,
      maxRuntimeMs: limits.maxRuntimeMs,
      expectedTargets,
      steps: initialSteps
    });

    if (input.runInBackground) {
      const promise = this.launchSingleFlightExecution(created.id, input.ownerId);
      void promise.catch(() => undefined);
      return this.store.getRunForOwner(created.id, input.ownerId);
    }

    return await this.launchSingleFlightExecution(created.id, input.ownerId);
  }

  public getRun(runId: string, ownerId: string): ResearchRunView {
    return this.store.getRunForOwner(runId, ownerId);
  }

  public listRuns(ownerId: string, projectId?: string | null): ResearchRunView[] {
    return this.store.listRunsForOwner(ownerId, projectId);
  }

  public cancelRun(runId: string, ownerId: string): ResearchRunView {
    const run = this.store.getRunForOwner(runId, ownerId);
    const controller = this.activeControllers.get(runId);
    if (controller) {
      controller.abort();
    }

    if (run.status === "completed") {
      return run;
    }

    for (const step of run.steps) {
      if (step.status === "running") {
        this.store.checkpointStep(runId, ownerId, step.stepKey, {
          status: "cancelled",
          errorCode: "RESEARCH_CANCELLED_BY_OWNER"
        });
      }
    }

    this.store.updateRunStatus(runId, ownerId, {
      status: "cancelled",
      errorCode: "RESEARCH_CANCELLED_BY_OWNER",
      errorMessage: "Исследование остановлено пользователем; контрольная точка сохранена."
    });

    return this.store.getRunForOwner(runId, ownerId);
  }

  public async resumeRun(
    runId: string,
    ownerId: string,
    options?: { reverifyChangedUrls?: string[] }
  ): Promise<ResearchRunView> {
    this.assertNotEmergencyStopped();
    const run = this.store.getRunForOwner(runId, ownerId);
    this.ownerBudget.checkCanStartRun(ownerId, run.projectId);

    const inFlight = this.activePromises.get(runId);
    if (inFlight) {
      return await inFlight;
    }

    if (options?.reverifyChangedUrls && options.reverifyChangedUrls.length > 0) {
      for (const rawUrl of options.reverifyChangedUrls) {
        const canonical = canonicalizeSourceUrl(rawUrl);
        const stepKey = `read_source:${canonical}`;
        const existingStep = run.steps.find((s) => s.stepKey === stepKey);
        if (existingStep) {
          this.store.checkpointStep(runId, ownerId, stepKey, {
            status: "pending",
            checkpoint: {
              ...existingStep.checkpoint,
              reverifyRequestedAt: new Date().toISOString()
            }
          });
        }
      }
      const synthStep = run.steps.find((s) => s.stepKind === "synthesize");
      if (synthStep) {
        this.store.checkpointStep(runId, ownerId, synthStep.stepKey, {
          status: "pending"
        });
      }
    } else if (run.status === "completed") {
      return run;
    }

    return await this.launchSingleFlightExecution(runId, ownerId);
  }

  /**
   * Targeted Follow-Up Research on Unconfirmed / Conflicting Claims:
   * - Appends only new candidate URLs (or project documents added since the initial pass)
   *   without re-reading already-completed sources (`index < next_index`).
   * - Re-runs synthesis and updates the report and linked Canvas artifact if present.
   */
  public async followUpUnconfirmedClaims(
    runId: string,
    ownerId: string,
    options?: { additionalSourceUrls?: string[]; refreshProjectDocuments?: boolean }
  ): Promise<ResearchRunView> {
    this.assertNotEmergencyStopped();
    const run = this.store.getRunForOwner(runId, ownerId);
    this.ownerBudget.checkCanStartRun(ownerId, run.projectId);

    const inFlight = this.activePromises.get(runId);
    if (inFlight) {
      return await inFlight;
    }

    if (options?.additionalSourceUrls && options.additionalSourceUrls.length > 0) {
      this.store.registerDiscoveredSourceSteps(
        runId,
        ownerId,
        options.additionalSourceUrls.map((url) => ({ url, depth: 1 }))
      );
    }

    if (options?.refreshProjectDocuments !== false && run.projectId) {
      const docs = this.store.listProjectLibraryDocuments(ownerId, run.projectId);
      const expectedTargets = this.store.getExpectedTargets(runId, ownerId);
      for (const doc of docs) {
        const docUrl = `kosmora-doc://${doc.projectId}/${doc.id}`;
        const extractedClaims = extractClaimsFromProjectDocumentText(
          doc.extractedText,
          expectedTargets
        );
        this.store.upsertSourceSnapshot(runId, ownerId, {
          originalUrl: docUrl,
          title: `Документ проекта: ${doc.name}`,
          fetchedAt: doc.createdAt,
          publishedAt: doc.createdAt,
          pageVersion: `pv-doc-${doc.sha256.slice(0, 12)}`,
          contentText: doc.extractedText,
          depth: 1,
          httpStatus: 200,
          extractedClaims
        });
      }
    }

    const synthStep = this.store.listSteps(runId).find((s) => s.stepKind === "synthesize");
    if (synthStep) {
      this.store.checkpointStep(runId, ownerId, synthStep.stepKey, {
        status: "pending"
      });
    }

    const updatedRun = await this.launchSingleFlightExecution(runId, ownerId);
    if (updatedRun.canvasArtifactId) {
      this.store.exportRunToCanvasArtifact(runId, ownerId);
    }
    return this.store.getRunForOwner(runId, ownerId);
  }


  /**
   * Selective Source Freshness Re-verification:
   * - Re-polls existing web sources (or `options.targetUrls` subset) without repeating paid model calls.
   * - Detects changed pages (`pageChanged: true`, `previousPageVersion -> pageVersion`), re-verifies quotes,
   *   preserves valid manual conflict resolutions (`resolutionAudit`) if the winning source version/value is intact,
   *   and automatically invalidates stale manual resolutions if the winning source changed its claimed value.
   */

  /**
   * Executes or resumes a research step inside a reusable Koswork workflow DAG (`kosmora_workflow_checkpoints`):
   * - Binds `(workflowRunId, stepId)` to a deterministic `clientRequestId = "wf_step:<workflowRunId>:<stepId>"`.
   * - Enforces the `<= 3` attempts ceiling per workflow step.
   * - On self-healing retry after a transient source failure, resumes the existing `research_run`
   *   from `next_index` without re-reading completed sources or repeating the paid model call.
   */
  public async executeWorkflowResearchStep(input: {
    ownerId: string;
    projectId?: string | null;
    workflowRunId: string;
    stepId: string;
    query: string;
    expectedTargets?: Array<{ subject: string; criterion: string }>;
    budgets?: Partial<ResearchBudgetLimits>;
    includeProjectDocuments?: boolean;
    promoteConfirmedToMemory?: boolean;
  }): Promise<{
    workflowCheckpoint: ReturnType<ResearchStore["getWorkflowStepCheckpoint"]>;
    run: ResearchRunView;
    resumedFromCheckpoint: boolean;
    deduplicatedCompleted: boolean;
  }> {
    this.assertNotEmergencyStopped();
    const projectId = input.projectId ?? null;
    this.ownerBudget.checkCanStartRun(input.ownerId, projectId);

    const clientRequestId = `wf_step:${input.workflowRunId}:${input.stepId}`;
    const priorWfCheckpoint = this.store.getWorkflowStepCheckpoint(
      input.workflowRunId,
      input.stepId
    );
    const existingRun = this.store.findIdempotentRun({
      ownerId: input.ownerId,
      projectId,
      query: input.query,
      clientRequestId,
      deduplicateQuery: false
    });

    if (existingRun && existingRun.status === "completed") {
      const checkpoint = this.store.saveWorkflowStepCheckpoint({
        workflowRunId: input.workflowRunId,
        stepId: input.stepId,
        attempt: priorWfCheckpoint?.attempt ?? 1,
        status: "completed",
        outputContent: existingRun.reportMarkdown,
        state: {
          researchRunId: existingRun.id,
          nextIndex: existingRun.nextIndex,
          confirmedCount: existingRun.confirmedClaims.length,
          conflictingCount: existingRun.conflictingClaims.length,
          unconfirmedCount: existingRun.unconfirmedClaims.length
        }
      });
      return {
        workflowCheckpoint: checkpoint,
        run: existingRun,
        resumedFromCheckpoint: false,
        deduplicatedCompleted: true
      };
    }

    const nextAttempt = priorWfCheckpoint ? priorWfCheckpoint.attempt + 1 : 1;
    if (nextAttempt > 3) {
      throw new Error("WORKFLOW_STEP_MAX_ATTEMPTS_EXCEEDED");
    }

    let run: ResearchRunView;
    let resumedFromCheckpoint = false;

    if (existingRun && existingRun.canResume) {
      resumedFromCheckpoint = true;
      run = await this.resumeRun(existingRun.id, input.ownerId);
    } else {
      run = await this.startRun({
        ownerId: input.ownerId,
        projectId,
        query: input.query,
        clientRequestId,
        expectedTargets: input.expectedTargets,
        budgets: input.budgets,
        includeProjectDocuments: input.includeProjectDocuments
      });
    }

    if (run.status === "completed" && input.promoteConfirmedToMemory && projectId) {
      this.store.promoteRunClaimsToContextMemory(run.id, input.ownerId);
    }

    const wfStatus =
      run.status === "completed"
        ? "completed"
        : run.status === "failed"
          ? "self_healing"
          : run.status;

    const workflowCheckpoint = this.store.saveWorkflowStepCheckpoint({
      workflowRunId: input.workflowRunId,
      stepId: input.stepId,
      attempt: nextAttempt,
      status: wfStatus,
      outputContent: run.reportMarkdown,
      state: {
        researchRunId: run.id,
        nextIndex: run.nextIndex,
        canResume: run.canResume,
        errorCode: run.errorCode,
        confirmedCount: run.confirmedClaims.length,
        conflictingCount: run.conflictingClaims.length,
        unconfirmedCount: run.unconfirmedClaims.length
      }
    });

    return {
      workflowCheckpoint,
      run,
      resumedFromCheckpoint,
      deduplicatedCompleted: false
    };
  }

  public async reverifySources(
    runId: string,
    ownerId: string,
    options?: { targetUrls?: string[] }
  ): Promise<{
    run: ResearchRunView;
    checkedCount: number;
    changedUrls: string[];
    invalidatedClaimIds: string[];
  }> {
    this.assertNotEmergencyStopped();
    const run = this.store.getRunForOwner(runId, ownerId);
    this.ownerBudget.checkCanStartRun(ownerId, run.projectId);

    const priorClaimsByKey = new Map<string, ResearchRunView["confirmedClaims"][number]>();
    for (const c of [...run.confirmedClaims, ...run.conflictingClaims, ...run.unconfirmedClaims]) {
      priorClaimsByKey.set(`${c.subject}:::${c.criterion}`, c);
    }

    const filterCanonicals =
      options?.targetUrls && options.targetUrls.length > 0
        ? new Set(options.targetUrls.map((u) => canonicalizeSourceUrl(u)))
        : null;

    const webSources = run.sources.filter(
      (s) =>
        !s.canonicalUrl.startsWith("kosmora-doc://") &&
        (!filterCanonicals || filterCanonicals.has(s.canonicalUrl))
    );

    const changedUrls: string[] = [];
    let checkedCount = 0;

    for (const src of webSources) {
      checkedCount += 1;
      const oldVersion = src.pageVersion;
      const oldSha = src.contentSha256;
      const snap = await this.browserAdapter.readSourcePage(src.originalUrl, {
        depth: src.depth
      });

      const saved = this.store.upsertSourceSnapshot(runId, ownerId, {
        originalUrl: snap.originalUrl,
        title: snap.title,
        fetchedAt: snap.fetchedAt,
        publishedAt: snap.publishedAt,
        pageVersion: snap.pageVersion,
        initialExpectedVersion: oldVersion,
        contentText: snap.contentText,
        depth: snap.depth,
        httpStatus: snap.httpStatus,
        extractedClaims: snap.extractedClaims
      });

      if (saved.pageVersion !== oldVersion || saved.contentSha256 !== oldSha) {
        changedUrls.push(saved.canonicalUrl);
      }
    }

    const allSources = this.store.listSources(runId);
    const expectedTargets = this.store.getExpectedTargets(runId, ownerId);
    const synthesized = synthesizeResearchClaims({
      runId,
      expectedTargets,
      sources: allSources
    });

    const invalidatedClaimIds: string[] = [];
    const reconciledClaims = synthesized.allClaims.map((newClaim) => {
      const prior = priorClaimsByKey.get(`${newClaim.subject}:::${newClaim.criterion}`);
      if (!prior?.resolutionAudit) {
        return newClaim;
      }
      const audit = prior.resolutionAudit;
      const matchingCit = newClaim.citations.find(
        (cit) => cit.canonicalUrl === audit.winningCanonicalUrl
      );
      if (
        matchingCit &&
        matchingCit.pageVersion === audit.winningPageVersion &&
        matchingCit.claimedValue === audit.winningClaimedValue
      ) {
        return {
          ...newClaim,
          category: "confirmed" as const,
          resolvedValue: audit.winningClaimedValue,
          resolutionAudit: audit
        };
      }
      invalidatedClaimIds.push(newClaim.claimId);
      return newClaim;
    });

    const updatedRun = this.store.saveSynthesizedClaimsAndReport(
      runId,
      ownerId,
      reconciledClaims,
      run.status
    );

    if (updatedRun.canvasArtifactId) {
      this.store.exportRunToCanvasArtifact(runId, ownerId);
    }

    return {
      run: this.store.getRunForOwner(runId, ownerId),
      checkedCount,
      changedUrls,
      invalidatedClaimIds
    };
  }

  public exportReport(
    runId: string,
    ownerId: string
  ): {
    runId: string;
    query: string;
    status: string;
    reportMarkdown: string;
    confirmedClaims: ResearchRunView["confirmedClaims"];
    conflictingClaims: ResearchRunView["conflictingClaims"];
    unconfirmedClaims: ResearchRunView["unconfirmedClaims"];
    sources: Array<{
      sourceId: string;
      title: string;
      originalUrl: string;
      canonicalUrl: string;
      fetchedAt: string;
      pageVersion: string;
      previousPageVersion: string | null;
      pageChanged: boolean;
    }>;
  } {
    const run = this.store.getRunForOwner(runId, ownerId);
    if (!run.reportMarkdown) {
      throw new Error("RESEARCH_REPORT_NOT_READY");
    }
    return {
      runId: run.id,
      query: run.query,
      status: run.status,
      reportMarkdown: run.reportMarkdown,
      confirmedClaims: run.confirmedClaims,
      conflictingClaims: run.conflictingClaims,
      unconfirmedClaims: run.unconfirmedClaims,
      sources: run.sources.map((s) => ({
        sourceId: s.sourceId,
        title: s.title,
        originalUrl: s.originalUrl,
        canonicalUrl: s.canonicalUrl,
        fetchedAt: s.fetchedAt,
        pageVersion: s.pageVersion,
        previousPageVersion: s.previousPageVersion,
        pageChanged: s.pageChanged
      }))
    };
  }

  public exportToCanvas(
    runId: string,
    ownerId: string,
    options?: { title?: string }
  ): CanvasResearchArtifactRecord {
    this.assertNotEmergencyStopped();
    return this.store.exportRunToCanvasArtifact(runId, ownerId, options);
  }

  /**
   * Aborts and drains all active research runs belonging to `ownerId` (used by `ResearchIntegratedPrivacyAdapter.quiesce`).
   */
  public async quiesceOwner(ownerId: string): Promise<number> {
    let abortedCount = 0;
    const toWait: Array<Promise<ResearchRunView>> = [];

    for (const [runId, activeOwner] of this.activeRunOwner.entries()) {
      if (activeOwner === ownerId) {
        abortedCount += 1;
        this.activeControllers.get(runId)?.abort();
        const p = this.activePromises.get(runId);
        if (p) toWait.push(p);
      }
    }

    await Promise.allSettled(toWait);
    return abortedCount;
  }

  public async waitForActiveRun(runId: string): Promise<void> {
    const p = this.activePromises.get(runId);
    if (p) {
      await p;
    }
  }

  public async stop(): Promise<void> {
    for (const controller of this.activeControllers.values()) {
      controller.abort();
    }
    await Promise.allSettled(Array.from(this.activePromises.values()));
    this.activeControllers.clear();
    this.activePromises.clear();
    this.activeRunOwner.clear();
  }

  private assertNotEmergencyStopped(): void {
    if (this.emergency?.getProcessStop?.()) {
      throw new Error("EMERGENCY_STOP_ACTIVE");
    }
  }

  private launchSingleFlightExecution(
    runId: string,
    ownerId: string
  ): Promise<ResearchRunView> {
    const existingPromise = this.activePromises.get(runId);
    if (existingPromise) {
      return existingPromise;
    }
    this.activeRunOwner.set(runId, ownerId);
    const promise = this.executeFromLastCheckpoint(runId, ownerId).finally(() => {
      this.activePromises.delete(runId);
      this.activeControllers.delete(runId);
      this.activeRunOwner.delete(runId);
    });
    this.activePromises.set(runId, promise);
    return promise;
  }

  private async executeFromLastCheckpoint(
    runId: string,
    ownerId: string
  ): Promise<ResearchRunView> {
    const controller = new AbortController();
    this.activeControllers.set(runId, controller);
    const startWallMs = this.clock();

    const initialRun = this.store.getRunForOwner(runId, ownerId);
    const priorElapsedMs = initialRun.budgets.elapsedMs;
    const maxRuntimeMs = initialRun.budgets.maxRuntimeMs;

    this.store.updateRunStatus(runId, ownerId, {
      status: "running",
      errorCode: null,
      errorMessage: null
    });

    while (true) {
      if (controller.signal.aborted) {
        this.store.updateRunStatus(runId, ownerId, {
          status: "cancelled",
          elapsedMs: priorElapsedMs + Math.max(0, this.clock() - startWallMs),
          errorCode: "RESEARCH_CANCELLED_BY_OWNER",
          errorMessage: "Исследование остановлено пользователем; контрольная точка сохранена."
        });
        return this.store.getRunForOwner(runId, ownerId);
      }

      const currentElapsed = priorElapsedMs + Math.max(0, this.clock() - startWallMs);
      if (currentElapsed > maxRuntimeMs) {
        this.store.updateRunStatus(runId, ownerId, {
          status: "failed",
          elapsedMs: currentElapsed,
          errorCode: "RESEARCH_RUNTIME_BUDGET_EXCEEDED",
          errorMessage: `Превышен лимит времени исследования (${maxRuntimeMs} мс).`
        });
        return this.store.getRunForOwner(runId, ownerId);
      }

      const steps = this.store.listSteps(runId);
      const nextStep = steps.find(
        (s) =>
          s.status === "pending" ||
          s.status === "failed" ||
          s.status === "cancelled"
      );

      if (!nextStep) {
        break;
      }

      this.store.checkpointStep(runId, ownerId, nextStep.stepKey, {
        status: "running",
        incrementAttempts: true
      });

      try {
        if (nextStep.stepKind === "search") {
          const currentRun = this.store.getRunForOwner(runId, ownerId);

          if (
            !currentRun.checkpoint.plan_model_completed &&
            this.gateway &&
            typeof this.gateway.planResearchQueries === "function"
          ) {
            const planRes = await this.gateway.planResearchQueries({
              query: currentRun.query,
              ownerId,
              projectId: currentRun.projectId
            });
            this.store.updateRunCheckpointEnvelope(runId, ownerId, {
              plan_model_completed: true,
              planned_queries: planRes.queries,
              model_calls_count: currentRun.checkpoint.model_calls_count + 1
            });
          } else if (!currentRun.checkpoint.plan_model_completed) {
            this.store.updateRunCheckpointEnvelope(runId, ownerId, {
              plan_model_completed: true,
              planned_queries: [currentRun.query]
            });
          }

          const candidates = await this.browserAdapter.searchSources(
            currentRun.query,
            {
              maxResults: currentRun.budgets.maxSources,
              signal: controller.signal
            }
          );

          this.store.registerDiscoveredSourceSteps(
            runId,
            ownerId,
            candidates.map((c) => ({
              url: c.originalUrl,
              depth: c.depth,
              initialExpectedVersion: c.initialExpectedVersion
            }))
          );

          this.store.checkpointStep(runId, ownerId, nextStep.stepKey, {
            status: "completed",
            checkpoint: {
              discoveredCount: candidates.length,
              completedAt: new Date().toISOString()
            }
          });
        } else if (nextStep.stepKind === "read_project_docs") {
          const currentRun = this.store.getRunForOwner(runId, ownerId);
          const expectedTargets = this.store.getExpectedTargets(runId, ownerId);
          const docs = this.store.listProjectLibraryDocuments(
            ownerId,
            currentRun.projectId
          );

          for (const doc of docs) {
            const docUrl = `kosmora-doc://${doc.projectId}/${doc.id}`;
            const extractedClaims = extractClaimsFromProjectDocumentText(
              doc.extractedText,
              expectedTargets
            );
            this.store.upsertSourceSnapshot(runId, ownerId, {
              originalUrl: docUrl,
              title: `Документ проекта: ${doc.name}`,
              fetchedAt: doc.createdAt,
              publishedAt: doc.createdAt,
              pageVersion: `pv-doc-${doc.sha256.slice(0, 12)}`,
              contentText: doc.extractedText,
              depth: 1,
              httpStatus: 200,
              extractedClaims
            });
          }

          this.store.checkpointStep(runId, ownerId, nextStep.stepKey, {
            status: "completed",
            checkpoint: {
              ingestedProjectDocsCount: docs.length,
              completedAt: new Date().toISOString()
            }
          });
        } else if (nextStep.stepKind === "read_source") {
          const targetUrl = nextStep.targetUrl!;
          const initialExpectedVersion =
            typeof nextStep.checkpoint.initialExpectedVersion === "string"
              ? nextStep.checkpoint.initialExpectedVersion
              : null;

          const snap = await this.browserAdapter.readSourcePage(targetUrl, {
            depth: nextStep.depth,
            signal: controller.signal
          });

          if (controller.signal.aborted) {
            this.store.checkpointStep(runId, ownerId, nextStep.stepKey, {
              status: "cancelled",
              errorCode: "RESEARCH_CANCELLED_BY_OWNER"
            });
            this.store.updateRunStatus(runId, ownerId, {
              status: "cancelled",
              elapsedMs: priorElapsedMs + Math.max(0, this.clock() - startWallMs),
              errorCode: "RESEARCH_CANCELLED_BY_OWNER",
              errorMessage: "Исследование остановлено во время чтения источника."
            });
            return this.store.getRunForOwner(runId, ownerId);
          }

          const savedSource = this.store.upsertSourceSnapshot(runId, ownerId, {
            originalUrl: snap.originalUrl,
            title: snap.title,
            fetchedAt: snap.fetchedAt,
            publishedAt: snap.publishedAt,
            pageVersion: snap.pageVersion,
            initialExpectedVersion,
            contentText: snap.contentText,
            depth: snap.depth,
            httpStatus: snap.httpStatus,
            extractedClaims: snap.extractedClaims
          });

          this.store.updateRunStatus(runId, ownerId, {
            depthReached: snap.depth,
            elapsedMs: priorElapsedMs + Math.max(0, this.clock() - startWallMs)
          });

          if (snap.outlinks && snap.outlinks.length > 0) {
            this.store.registerDiscoveredSourceSteps(runId, ownerId, snap.outlinks);
          }

          this.store.checkpointStep(runId, ownerId, nextStep.stepKey, {
            status: "completed",
            checkpoint: {
              sourceId: savedSource.sourceId,
              canonicalUrl: savedSource.canonicalUrl,
              pageVersion: savedSource.pageVersion,
              previousPageVersion: savedSource.previousPageVersion,
              pageChanged: savedSource.pageChanged,
              fetchedAt: savedSource.fetchedAt
            }
          });
        } else if (nextStep.stepKind === "synthesize") {
          const sources = this.store.listSources(runId);
          const expectedTargets = this.store.getExpectedTargets(runId, ownerId);
          const synthesized = synthesizeResearchClaims({
            runId,
            expectedTargets,
            sources
          });

          this.store.checkpointStep(runId, ownerId, nextStep.stepKey, {
            status: "completed",
            checkpoint: {
              confirmedCount: synthesized.confirmedClaims.length,
              conflictingCount: synthesized.conflictingClaims.length,
              unconfirmedCount: synthesized.unconfirmedClaims.length,
              synthesizedAt: new Date().toISOString()
            }
          });

          this.store.updateRunStatus(runId, ownerId, {
            elapsedMs: priorElapsedMs + Math.max(0, this.clock() - startWallMs)
          });

          this.store.saveSynthesizedClaimsAndReport(
            runId,
            ownerId,
            synthesized.allClaims,
            "completed"
          );
        }
      } catch (stepErr) {
        const message = stepErr instanceof Error ? stepErr.message : String(stepErr);
        if (controller.signal.aborted || message === "RESEARCH_CANCELLED") {
          this.store.checkpointStep(runId, ownerId, nextStep.stepKey, {
            status: "cancelled",
            errorCode: "RESEARCH_CANCELLED_BY_OWNER"
          });
          this.store.updateRunStatus(runId, ownerId, {
            status: "cancelled",
            elapsedMs: priorElapsedMs + Math.max(0, this.clock() - startWallMs),
            errorCode: "RESEARCH_CANCELLED_BY_OWNER",
            errorMessage: "Исследование остановлено пользователем во время выполнения шага."
          });
          return this.store.getRunForOwner(runId, ownerId);
        }

        this.store.checkpointStep(runId, ownerId, nextStep.stepKey, {
          status: "failed",
          errorCode: message
        });
        this.store.updateRunStatus(runId, ownerId, {
          status: "failed",
          elapsedMs: priorElapsedMs + Math.max(0, this.clock() - startWallMs),
          errorCode: message,
          errorMessage: `Сбой на шаге ${nextStep.stepKey}: ${message}`
        });
        return this.store.getRunForOwner(runId, ownerId);
      }
    }

    return this.store.getRunForOwner(runId, ownerId);
  }
}
