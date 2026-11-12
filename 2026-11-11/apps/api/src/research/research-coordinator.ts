import {
  DeterministicResearchBrowserAdapter,
  type ResearchBrowserAdapter
} from "./browser-research-adapter.js";
import {
  ResearchStore,
  type ResearchRunView,
  canonicalizeSourceUrl
} from "./research-store.js";
import {
  DEFAULT_RESEARCH_BUDGET,
  ProjectResearchOwnerBudget,
  type ResearchBudgetLimits,
  type ResearchOwnerBudget,
  synthesizeResearchClaims
} from "./research-synthesis.js";

export interface StartResearchRunInput {
  ownerId: string;
  projectId?: string | null;
  query: string;
  clientRequestId?: string | null;
  expectedTargets?: Array<{ subject: string; criterion: string }>;
  budgets?: Partial<ResearchBudgetLimits>;
  runInBackground?: boolean;
}

export interface ResearchCoordinatorOptions {
  store: ResearchStore;
  browserAdapter?: ResearchBrowserAdapter;
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

/**
 * Canonical ResearchCoordinator imported by `apps/api/src/app.ts` and `apps/api/src/server.ts`.
 *
 * Implements:
 * - Step-by-step persistent checkpoints (`search` -> `read_source:<url>` -> `synthesize`).
 * - Safe cancellation (`cancelRun`) during reading and safe continuation (`resumeRun`):
 *   only unfinished (`pending`/`failed`/`cancelled`) source reads are executed on resume;
 *   already-completed source reads are never re-executed or duplicated.
 * - Page-change detection (`pageChanged`, `previousPageVersion`) when a page mutates across reads/resumes.
 * - Strict owner and project access checks (`RESEARCH_RUN_FORBIDDEN`, `RESEARCH_PROJECT_FORBIDDEN`).
 * - Depth (`maxDepth`), source count (`maxSources`), and wall-clock runtime (`maxRuntimeMs`) budgets.
 */
export class ResearchCoordinator {
  private readonly store: ResearchStore;
  public readonly browserAdapter: ResearchBrowserAdapter;
  private readonly ownerBudget: ResearchOwnerBudget;
  private readonly emergency: { getProcessStop?(): unknown } | null;
  private readonly clock: () => number;
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly activePromises = new Map<string, Promise<ResearchRunView>>();

  constructor(options: ResearchCoordinatorOptions) {
    this.store = options.store;
    this.browserAdapter =
      options.browserAdapter ?? new DeterministicResearchBrowserAdapter();
    this.ownerBudget =
      options.ownerBudget ?? new ProjectResearchOwnerBudget(this.store.sqlite);
    this.emergency = options.emergency ?? null;
    this.clock = options.clock ?? (() => Date.now());
  }

  public async startRun(input: StartResearchRunInput): Promise<ResearchRunView> {
    this.assertNotEmergencyStopped();
    const projectId = input.projectId ?? null;
    this.ownerBudget.checkCanStartRun(input.ownerId, projectId);

    // 1. Check idempotent retry first (never duplicate results on repeated request)
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

    const created = this.store.createRunWithSteps({
      ownerId: input.ownerId,
      projectId,
      query: input.query,
      clientRequestId: input.clientRequestId ?? null,
      maxDepth: limits.maxDepth,
      maxSources: limits.maxSources,
      maxRuntimeMs: limits.maxRuntimeMs,
      expectedTargets,
      steps: [
        { stepKey: "search:initial", stepKind: "search", depth: 1 },
        { stepKey: "synthesize:final", stepKind: "synthesize", depth: 1 }
      ]
    });

    if (input.runInBackground) {
      const promise = this.executeFromLastCheckpoint(created.id, input.ownerId).catch(
        () => this.store.getRunForOwner(created.id, input.ownerId)
      );
      this.activePromises.set(created.id, promise);
      return this.store.getRunForOwner(created.id, input.ownerId);
    }

    return await this.executeFromLastCheckpoint(created.id, input.ownerId);
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

    // Mark any currently-running step as cancelled so resumeRun will pick it up cleanly
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

    // If caller requests re-verification of specific URLs whose content changed, mark only those steps pending
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

    return await this.executeFromLastCheckpoint(runId, ownerId);
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
  }

  private assertNotEmergencyStopped(): void {
    if (this.emergency?.getProcessStop?.()) {
      throw new Error("EMERGENCY_STOP_ACTIVE");
    }
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

    try {
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
        // Find the next unfinished step (`pending`, `failed`, or `cancelled`)
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
              candidates.map((c) => ({ url: c.originalUrl, depth: c.depth }))
            );

            // Store initialExpectedVersion on each discovered read_source step
            for (const c of candidates) {
              const stepKey = `read_source:${c.canonicalUrl}`;
              const hasStep = this.store
                .listSteps(runId)
                .find((s) => s.stepKey === stepKey);
              if (hasStep && c.initialExpectedVersion) {
                this.store.checkpointStep(runId, ownerId, stepKey, {
                  status: hasStep.status,
                  checkpoint: {
                    initialExpectedVersion: c.initialExpectedVersion,
                    discoveredAt: new Date().toISOString()
                  }
                });
              }
            }

            this.store.checkpointStep(runId, ownerId, nextStep.stepKey, {
              status: "completed",
              checkpoint: {
                discoveredCount: candidates.length,
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

            // Discover outlinks within depth & source budgets
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
    } finally {
      this.activeControllers.delete(runId);
      this.activePromises.delete(runId);
    }
  }
}
