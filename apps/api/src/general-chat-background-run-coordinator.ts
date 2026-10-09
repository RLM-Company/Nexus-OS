import { ContextTooLargeError } from "@cosmora/core";
import type { ChatService } from "@cosmora/core";
import type { EmergencyStopStore, StoredGeneralChatMessage } from "@cosmora/db";
import {
  GatewayRunError,
  type ModelGateway,
  type ModelGatewayStreamEvent
} from "@cosmora/model-gateway";
import type { FastifyBaseLogger } from "fastify";
import type {
  GeneralChatRuntimeStore,
  QueuedGeneralChatRun
} from "./general-chat-runtime-store.js";
import { EmergencyStopActivatedError, type RuntimeMetrics } from "./operations.js";
import type { AccountStore } from "./account-settings/account-store.js";
import {
  QuotaExceededError,
  RelayExecution,
  RelayProtectionError,
  RelayUnavailableError
} from "./account-settings/relay-execution.js";

export interface GeneralChatBackgroundRunCoordinatorOptions {
  store: GeneralChatRuntimeStore;
  modelGateway: ModelGateway;
  chat: ChatService;
  runtimeMetrics: RuntimeMetrics;
  emergencyStopStore?: EmergencyStopStore;
  logger?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  pollIntervalMs?: number;
  controlPollIntervalMs?: number;
  maxConcurrentRuns?: number;
  accountStore?: AccountStore;
}

type ActiveRun = {
  ownerId: string;
  controller: AbortController;
  task: Promise<void>;
};

const positiveInteger = (value: number | undefined, fallback: number): number =>
  Number.isInteger(value) && (value as number) > 0 ? (value as number) : fallback;

export class GeneralChatBackgroundRunCoordinator {
  readonly #store: GeneralChatRuntimeStore;
  readonly #accountStore: AccountStore | undefined;
  readonly #relay: RelayExecution | undefined;
  readonly #modelGateway: ModelGateway;
  readonly #chat: ChatService;
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

  constructor(options: GeneralChatBackgroundRunCoordinatorOptions) {
    this.#store = options.store;
    this.#accountStore = options.accountStore;
    this.#relay = options.accountStore
      ? new RelayExecution(options.accountStore, options.modelGateway)
      : undefined;
    this.#modelGateway = options.modelGateway;
    this.#chat = options.chat;
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
      for (const queued of this.#store.listQueuedGeneralChatRuns(capacity)) {
        if (this.#stopping || this.#activeRuns.size >= this.#maxConcurrentRuns) break;
        this.#tryLaunch(queued);
      }
    } catch (error) {
      this.#logger?.error({ error }, "General chat background queue poll failed");
    } finally {
      this.#polling = false;
    }
  }

  #tryLaunch(queued: QueuedGeneralChatRun): void {
    if (this.#activeRuns.has(queued.run_id)) return;
    if (!this.#store.claimQueuedGeneralChatRun(queued.run_id)) return;

    const assistant = this.#store.startAssistantMessage(queued.run_id, queued.owner_id);
    const claimed = this.#store.getRun(queued.run_id, queued.owner_id);
    if (!assistant || claimed?.status !== "running") return;

    const processStop = this.#emergencyStopStore?.getProcessStop();
    if (processStop) {
      this.#store.failRun(queued.run_id, "EMERGENCY_STOP");
      this.#runtimeMetrics.runFailed("EMERGENCY_STOP");
      this.#logger?.warn(
        { runId: queued.run_id, chatId: queued.chat_id, stopScope: processStop.scope },
        "Queued general chat run blocked by emergency stop"
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
      ownerId: queued.owner_id,
      controller,
      task
    });
    this.#runtimeMetrics.runStarted();
  }

  async #execute(
    queued: QueuedGeneralChatRun,
    assistant: StoredGeneralChatMessage,
    controller: AbortController
  ): Promise<void> {
    const controlTimer = setInterval(() => {
      const current = this.#store.getRun(queued.run_id, queued.owner_id);
      if (!current || current.status === "cancelled") {
        controller.abort(new Error("Run was cancelled by the owner"));
        return;
      }
      if (this.#emergencyStopStore?.getProcessStop()) {
        controller.abort(new EmergencyStopActivatedError());
      }
    }, this.#controlPollIntervalMs);
    controlTimer.unref?.();

    const mainHolds = new Map<number, string>();
    try {
      const conversation = this.#store.getConversationForRun(queued.run_id, queued.owner_id);
      if (conversation.length === 0) {
        throw new GatewayRunError(
          "PROVIDER_ERROR",
          "gateway",
          "General chat run is missing its persisted conversation",
          false
        );
      }

      let modelRequest = this.#chat.buildRequest({
        chatId: queued.chat_id,
        runId: queued.run_id,
        messages: conversation
      });
      if (
        this.#accountStore?.getRelay(queued.owner_id, queued.chat_id) &&
        conversation.some((message) => message.attachments?.length)
      )
        throw new RelayProtectionError(
          "Attachments are not translated without explicit format permission"
        );
      const prepared = this.#relay
        ? await this.#relay.prepare(
            queued.owner_id,
            queued.chat_id,
            queued.run_id,
            modelRequest,
            controller.signal
          )
        : { request: modelRequest, relay: false };
      modelRequest = prepared.request;
      let pendingEnglish = "";
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
              chatId: queued.chat_id,
              attempt: event.route.attempt,
              provider: event.route.provider_id,
              model: event.route.model_id,
              registryVersion: event.route.registry_version
            },
            "Background general chat route attempt selected"
          );
          if (this.#accountStore) {
            const hold = this.#accountStore.reserve(
              queued.owner_id,
              queued.run_id,
              event.route.attempt,
              event.route.estimated_input_tokens + event.route.max_output_tokens,
              "main",
              queued.chat_id,
              event.route.provider_id,
              event.route.model_id
            );
            mainHolds.set(event.route.attempt, hold);
          }
          const reserved = this.#store.reserveModelUsage(
            queued.run_id,
            event.route,
            queued.owner_id
          );
          if (!reserved) {
            throw new GatewayRunError(
              "ROUTE_UNAVAILABLE",
              event.route.provider_id,
              "Chat run cannot reserve the selected model route",
              false
            );
          }
        } else if (event.type === "route.failed") {
          this.#runtimeMetrics.routeFailed(event.errorCode);
          this.#store.failModelUsage(queued.run_id, event.route.attempt, event.errorCode);
          const hold = mainHolds.get(event.route.attempt);
          if (hold) this.#accountStore?.uncertainReservation(hold, "main");
          this.#logger?.warn(
            {
              runId: queued.run_id,
              chatId: queued.chat_id,
              attempt: event.route.attempt,
              provider: event.route.provider_id,
              model: event.route.model_id,
              errorCode: event.errorCode,
              retryable: event.retryable
            },
            "Background general chat route attempt failed"
          );
        } else if (event.type === "text.delta") {
          if (prepared.relay) pendingEnglish += event.delta;
          else this.#store.appendAssistantDelta(assistant.id, event.delta);
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

      if (prepared.relay) {
        if (!pendingEnglish.trim()) throw new RelayUnavailableError("No text to translate");
        const translated = await this.#relay!.finish(
          queued.owner_id,
          queued.chat_id,
          queued.run_id,
          modelRequest,
          pendingEnglish,
          controller.signal
        );
        this.#store.appendAssistantDelta(assistant.id, translated);
      }
      this.#store.completeRun(queued.run_id, completed.provider, completed.model, completed.usage, {
        attempt: completed.route.attempt,
        calculatedCost: completed.calculatedCost
      });
      const hold = mainHolds.get(completed.route.attempt);
      if (hold)
        this.#accountStore?.completeReservation(
          hold,
          "main",
          completed.usage.inputTokens,
          completed.usage.outputTokens
        );
      this.#runtimeMetrics.runCompleted();
      this.#logger?.info(
        {
          runId: queued.run_id,
          chatId: queued.chat_id,
          attempt: completed.route.attempt,
          provider: completed.provider,
          model: completed.model,
          inputTokens: completed.usage.inputTokens,
          outputTokens: completed.usage.outputTokens,
          calculatedCost: completed.calculatedCost
        },
        "Background general chat run completed"
      );
    } catch (error) {
      if (controller.signal.reason instanceof EmergencyStopActivatedError) {
        this.#store.failRun(queued.run_id, "EMERGENCY_STOP");
        this.#runtimeMetrics.runFailed("EMERGENCY_STOP");
        this.#logger?.error(
          { runId: queued.run_id, chatId: queued.chat_id },
          "Background general chat run interrupted by emergency stop"
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
          { runId: queued.run_id, chatId: queued.chat_id },
          "Background general chat run interrupted by API lifecycle"
        );
        return;
      }

      if (
        error instanceof RelayUnavailableError ||
        error instanceof RelayProtectionError ||
        error instanceof QuotaExceededError
      ) {
        const code =
          error instanceof QuotaExceededError ? "USAGE_LIMIT_EXCEEDED" : "RELAY_UNAVAILABLE";
        this.#store.failRun(queued.run_id, code);
        this.#runtimeMetrics.runFailed("PROVIDER_ERROR");
        this.#logger?.warn(
          { runId: queued.run_id, chatId: queued.chat_id, code },
          "Chat preflight or relay failed closed"
        );
        return;
      }
      const gatewayError =
        error instanceof ContextTooLargeError
          ? new GatewayRunError("CONTEXT_TOO_LARGE", "gateway", error.message, false)
          : error instanceof GatewayRunError
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
          chatId: queued.chat_id,
          provider: gatewayError.provider
        },
        "Background general chat provider run failed"
      );
    } finally {
      for (const hold of mainHolds.values()) this.#accountStore?.uncertainReservation(hold, "main");
      clearInterval(controlTimer);
    }
  }
}
