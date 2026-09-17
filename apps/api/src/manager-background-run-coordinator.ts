import type { ManagerService } from "@cosmora/core";
import {
  ProjectUsageLimitExceededError,
  type EmergencyStopStore,
  type StoredMessage
} from "@cosmora/db";
import {
  GatewayRunError,
  type ModelGateway,
  type ModelGatewayStreamEvent
} from "@cosmora/model-gateway";
import type { FastifyBaseLogger } from "fastify";
import type {
  ManagerRuntimeProjectStore,
  QueuedManagerRun
} from "./manager-runtime-project-store.js";
import { EmergencyStopActivatedError } from "./operations.js";
import type { RuntimeMetrics } from "./operations.js";

export interface ManagerBackgroundRunCoordinatorOptions {
  store: ManagerRuntimeProjectStore;
  modelGateway: ModelGateway;
  manager: ManagerService;
  runtimeMetrics: RuntimeMetrics;
  emergencyStopStore?: EmergencyStopStore;
  logger?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  pollIntervalMs?: number;
  controlPollIntervalMs?: number;
  maxConcurrentRuns?: number;
}

type ActiveRun = {
  projectId: string;
  ownerId: string;
  controller: AbortController;
  task: Promise<void>;
};

const positiveInteger = (value: number | undefined, fallback: number): number =>
  Number.isInteger(value) && (value as number) > 0 ? (value as number) : fallback;

export class ManagerBackgroundRunCoordinator {
  readonly #store: ManagerRuntimeProjectStore;
  readonly #modelGateway: ModelGateway;
  readonly #manager: ManagerService;
  readonly #runtimeMetrics: RuntimeMetrics;
  readonly #emergencyStopStore: EmergencyStopStore | undefined;
  readonly #logger: Pick<FastifyBaseLogger, "info" | "warn" | "error"> | undefined;
  readonly #pollIntervalMs: number;
  readonly #controlPollIntervalMs: number;
  readonly #maxConcurrentRuns: number;
  readonly #activeRuns = new Map<string, ActiveRun>();
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #polling = false;
  #stopping = false;

  constructor(options: ManagerBackgroundRunCoordinatorOptions) {
    this.#store = options.store;
    this.#modelGateway = options.modelGateway;
    this.#manager = options.manager;
    this.#runtimeMetrics = options.runtimeMetrics;
    this.#emergencyStopStore = options.emergencyStopStore;
    this.#logger = options.logger;
    this.#pollIntervalMs = positiveInteger(options.pollIntervalMs, 100);
    this.#controlPollIntervalMs = positiveInteger(options.controlPollIntervalMs, 50);
    this.#maxConcurrentRuns = positiveInteger(options.maxConcurrentRuns, 4);
  }

  get activeRunCount(): number {
    return this.#activeRuns.size;
  }

  start(): void {
    if (this.#pollTimer !== null) return;
    this.#stopping = false;
    void this.#pollQueuedRuns();
    this.#pollTimer = setInterval(() => void this.#pollQueuedRuns(), this.#pollIntervalMs);
    this.#pollTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#pollTimer !== null) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    const tasks = [...this.#activeRuns.values()].map((active) => {
      active.controller.abort(new Error("API process is shutting down"));
      return active.task;
    });
    await Promise.allSettled(tasks);
  }

  #pollQueuedRuns(): void {
    if (this.#stopping || this.#polling) return;
    const capacity = this.#maxConcurrentRuns - this.#activeRuns.size;
    if (capacity <= 0) return;

    this.#polling = true;
    try {
      for (const queued of this.#store.listQueuedManagerRuns(capacity)) {
        if (this.#stopping || this.#activeRuns.size >= this.#maxConcurrentRuns) break;
        this.#tryLaunch(queued);
      }
    } catch (error) {
      this.#logger?.error({ error }, "Manager background queue poll failed");
    } finally {
      this.#polling = false;
    }
  }

  #tryLaunch(queued: QueuedManagerRun): void {
    if (this.#activeRuns.has(queued.run_id)) return;
    if (!this.#store.claimQueuedManagerRun(queued.run_id)) return;

    const assistant = this.#store.startAssistantMessage(queued.run_id, queued.owner_id);
    const claimed = this.#store.getRun(queued.run_id, queued.owner_id);
    if (!assistant || claimed?.status !== "running") return;

    const blockingStop = this.#emergencyStopStore?.getBlockingStop(
      queued.project_id,
      queued.owner_id
    );
    if (blockingStop) {
      this.#store.failRun(queued.run_id, "EMERGENCY_STOP");
      this.#runtimeMetrics.runFailed("EMERGENCY_STOP");
      this.#logger?.warn(
        {
          runId: queued.run_id,
          projectId: queued.project_id,
          stopScope: blockingStop.scope
        },
        "Queued Manager run blocked by emergency stop"
      );
      return;
    }

    const controller = new AbortController();
    this.#runtimeMetrics.detachedRunStarted(queued.owner_id);
    const task = this.#execute(queued, assistant, controller).finally(() => {
      this.#runtimeMetrics.detachedRunFinished(queued.owner_id);
      this.#activeRuns.delete(queued.run_id);
    });
    this.#activeRuns.set(queued.run_id, {
      projectId: queued.project_id,
      ownerId: queued.owner_id,
      controller,
      task
    });
    this.#runtimeMetrics.runStarted();
  }

  async #execute(
    queued: QueuedManagerRun,
    assistant: StoredMessage,
    controller: AbortController
  ): Promise<void> {
    const controlTimer = setInterval(() => {
      const current = this.#store.getRun(queued.run_id, queued.owner_id);
      if (!current || current.status === "cancelled") {
        controller.abort(new Error("Run was cancelled by the owner"));
        return;
      }
      const stop = this.#emergencyStopStore?.getBlockingStop(queued.project_id, queued.owner_id);
      if (stop) controller.abort(new EmergencyStopActivatedError());
    }, this.#controlPollIntervalMs);
    controlTimer.unref?.();

    try {
      const conversation = this.#store.getConversationForRun(queued.run_id, queued.owner_id);
      if (conversation.length === 0) {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          "gateway",
          "Manager run is missing its persisted conversation",
          false
        );
      }

      const modelRequest = this.#manager.buildRequest({
        projectId: queued.project_id,
        runId: queued.run_id,
        messages: conversation
      });
      let completed: Extract<ModelGatewayStreamEvent, { type: "response.completed" }> | undefined;

      for await (const event of this.#modelGateway.stream(modelRequest, controller.signal)) {
        if (controller.signal.reason instanceof EmergencyStopActivatedError) {
          throw controller.signal.reason;
        }
        if (controller.signal.aborted) {
          throw controller.signal.reason;
        }
        if (event.type === "route.selected") {
          this.#runtimeMetrics.routeSelected();
          this.#logger?.info(
            {
              runId: queued.run_id,
              projectId: queued.project_id,
              attempt: event.route.attempt,
              provider: event.route.provider_id,
              model: event.route.model_id,
              registryVersion: event.route.registry_version
            },
            "Background Manager route attempt selected"
          );
          const reserved = this.#store.reserveModelUsage(
            queued.run_id,
            event.route,
            queued.owner_id
          );
          if (!reserved) {
            throw new GatewayRunError(
              "ROUTE_UNAVAILABLE",
              event.route.provider_id,
              "Run cannot reserve the selected model route",
              false
            );
          }
        } else if (event.type === "route.failed") {
          this.#runtimeMetrics.routeFailed(event.errorCode);
          this.#store.failModelUsage(queued.run_id, event.route.attempt, event.errorCode);
          this.#logger?.warn(
            {
              runId: queued.run_id,
              projectId: queued.project_id,
              attempt: event.route.attempt,
              provider: event.route.provider_id,
              model: event.route.model_id,
              errorCode: event.errorCode,
              retryable: event.retryable
            },
            "Background Manager route attempt failed"
          );
        } else if (event.type === "text.delta") {
          this.#store.appendAssistantDelta(assistant.id, event.delta);
        } else {
          completed = event;
        }
      }

      if (!completed) {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          "gateway",
          "Provider stream ended without completion",
          true
        );
      }

      this.#store.completeRun(queued.run_id, completed.provider, completed.model, completed.usage, {
        attempt: completed.route.attempt,
        calculatedCost: completed.calculatedCost
      });
      this.#runtimeMetrics.runCompleted();
      this.#logger?.info(
        {
          runId: queued.run_id,
          projectId: queued.project_id,
          attempt: completed.route.attempt,
          provider: completed.provider,
          model: completed.model,
          inputTokens: completed.usage.inputTokens,
          outputTokens: completed.usage.outputTokens,
          calculatedCost: completed.calculatedCost
        },
        "Background Manager run completed"
      );
    } catch (error) {
      if (controller.signal.reason instanceof EmergencyStopActivatedError) {
        this.#store.failRun(queued.run_id, "EMERGENCY_STOP");
        this.#runtimeMetrics.runFailed("EMERGENCY_STOP");
        this.#logger?.error(
          { runId: queued.run_id, projectId: queued.project_id },
          "Background Manager run interrupted by emergency stop"
        );
        return;
      }

      const current = this.#store.getRun(queued.run_id, queued.owner_id);
      if (current?.status === "cancelled") {
        this.#runtimeMetrics.runCancelled();
        return;
      }
      if (controller.signal.aborted) {
        this.#store.failRun(queued.run_id, "INTERRUPTED");
        this.#runtimeMetrics.runFailed("INTERRUPTED");
        this.#logger?.warn(
          { runId: queued.run_id, projectId: queued.project_id },
          "Background Manager run interrupted by API lifecycle"
        );
        return;
      }
      if (error instanceof ProjectUsageLimitExceededError) {
        this.#store.failRun(queued.run_id, error.code);
        this.#runtimeMetrics.runFailed("USAGE_LIMIT_EXCEEDED");
        this.#logger?.warn(
          { runId: queued.run_id, projectId: queued.project_id, limitCode: error.code },
          "Background Manager route blocked by project usage limit"
        );
        return;
      }

      const gatewayError =
        error instanceof GatewayRunError
          ? error
          : new GatewayRunError("PROVIDER_ERROR", "gateway", "Model gateway failed", true, {
              cause: error
            });
      this.#store.failRun(queued.run_id, gatewayError.code);
      this.#runtimeMetrics.runFailed(gatewayError.code);
      this.#logger?.warn(
        {
          error: gatewayError,
          runId: queued.run_id,
          projectId: queued.project_id,
          provider: gatewayError.provider
        },
        "Background Manager provider run failed"
      );
    } finally {
      clearInterval(controlTimer);
    }
  }
}
