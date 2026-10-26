import {
  MediaCapabilityRegistry,
  MediaProviderError,
  OpenAIMediaAdapter,
  type MediaCapability
} from "@cosmora/model-gateway";
import {
  canonicalUsage,
  type CanonicalMediaUsage,
  type MediaKind,
  type OwnerMediaBudget
} from "./media-budget.js";
import { MediaFileStore, type MediaJob } from "./media-store.js";

type AudioMime = "audio/webm" | "audio/wav" | "audio/mp4" | "audio/mpeg";
type GeneratedBinary = Awaited<ReturnType<OpenAIMediaAdapter["generateImage"]>> & {
  usage?: CanonicalMediaUsage;
};
type MediaAdapter = {
  generateImage(
    prompt: string,
    model: "gpt-image-1",
    signal: AbortSignal
  ): Promise<GeneratedBinary>;
  speak(text: string, model: "gpt-4o-mini-tts", signal: AbortSignal): Promise<GeneratedBinary>;
  transcribe(
    bytes: Uint8Array,
    mime: AudioMime,
    model: "gpt-4o-mini-transcribe",
    signal: AbortSignal
  ): Promise<string>;
  /** Optional: canonical provider usage for transcription when provider returns it. */
  transcribeWithUsage?(
    bytes: Uint8Array,
    mime: AudioMime,
    model: "gpt-4o-mini-transcribe",
    signal: AbortSignal
  ): Promise<{ text: string; usage?: CanonicalMediaUsage }>;
};
export interface MediaOptions {
  baseUrl?: string;
  directory?: string;
  apiKey?: string;
  paidEnabled?: boolean;
  adapter?: MediaAdapter;
  ownerBudget?: OwnerMediaBudget;
  registry?: MediaCapabilityRegistry;
  emergencyStopped?: () => boolean;
  ownerActive?: (ownerId: string) => boolean;
}

const MAX_RECORDING_BYTES = 1_500_000;
const MAX_MS = 60_000;
const QUIESCE_DRAIN_MS = 1_000;
const validRecording = (bytes: Uint8Array, mime: AudioMime): boolean =>
  mime === "audio/webm"
    ? [0x1a, 0x45, 0xdf, 0xa3].every((v, i) => bytes[i] === v)
    : mime === "audio/wav"
      ? Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF"
      : mime === "audio/mp4"
        ? Buffer.from(bytes.subarray(4, 8)).toString() === "ftyp"
        : bytes[0] === 0xff || Buffer.from(bytes.subarray(0, 3)).toString() === "ID3";

export class MediaService {
  private readonly store: MediaFileStore | null;
  private readonly adapter: MediaAdapter | undefined;
  private readonly registry: MediaCapabilityRegistry;
  private readonly budget: OwnerMediaBudget | undefined;
  private readonly running = new Map<
    string,
    { owner: string; controller: AbortController; task: Promise<void> }
  >();
  private readonly closedOwners = new Set<string>();
  private closed = false;
  private readonly paidEnabled: boolean;
  private readonly emergencyStopped: () => boolean;
  private readonly ownerActive: (ownerId: string) => boolean;

  constructor(options: MediaOptions = {}) {
    this.store = options.directory ? new MediaFileStore(options.directory) : null;
    this.paidEnabled = options.paidEnabled === true;
    this.registry =
      options.registry ??
      new MediaCapabilityRegistry(
        options.baseUrl?.startsWith("https://ru.cheapvibecode.ru/")
          ? ["image_generation"]
          : undefined
      );
    this.adapter =
      options.adapter ??
      (options.apiKey ? new OpenAIMediaAdapter(options.apiKey, fetch, options.baseUrl) : undefined);
    this.emergencyStopped = options.emergencyStopped ?? (() => false);
    this.ownerActive = options.ownerActive ?? (() => true);
    this.budget = options.ownerBudget;
    // Crash recovery never dispatches again. A pre-existing reservation remains
    // held until canonical ownerBudget explicitly reconciles it.
    if (this.store && this.budget) {
      for (const job of this.store.recovered())
        if (job.budget_state === "reserved") {
          void this.budget
            .uncertain({ ownerId: job.owner_id, operationId: job.id, reason: "INTERRUPTED" })
            .then(() => {
              this.store?.budget(job.id, job.owner_id, "uncertain");
            })
            .catch(() => {
              /* A reserved hold MUST NOT be cleared on ledger error. */
            });
        }
    }
  }
  capabilities(): Record<
    MediaCapability,
    { ready: boolean; model: string | null; reason: string | null }
  > {
    const result = {} as ReturnType<MediaService["capabilities"]>;
    for (const capability of ["image_generation", "transcription", "speech"] as const) {
      const route = this.registry.route(capability);
      const reason = !route
        ? "REGISTRY_UNAVAILABLE"
        : !this.store
          ? "STORAGE_UNAVAILABLE"
          : !this.adapter
            ? "CREDENTIAL_UNAVAILABLE"
            : !this.paidEnabled
              ? "PAID_EXECUTION_DISABLED"
              : !this.budget
                ? "BUDGET_UNAVAILABLE"
                : this.emergencyStopped()
                  ? "EMERGENCY_STOP"
                  : this.closed
                    ? "MEDIA_STOPPED"
                    : null;
      result[capability] = { ready: reason === null, model: route?.model ?? null, reason };
    }
    return result;
  }
  private check(capability: MediaCapability, consent: boolean, ownerId: string): void {
    if (
      !this.capabilities()[capability].ready ||
      this.closedOwners.has(ownerId) ||
      !this.ownerActive(ownerId)
    )
      throw new Error("MEDIA_UNAVAILABLE");
    if (!consent) throw new Error("CONSENT_REQUIRED");
  }
  storageReady(): boolean {
    return this.store !== null;
  }
  list(ownerId: string): MediaJob[] {
    return this.store?.list(ownerId) ?? [];
  }
  get(id: string, ownerId: string): MediaJob | null {
    return this.store?.get(id, ownerId) ?? null;
  }
  asset(id: string, ownerId: string) {
    return this.store?.asset(id, ownerId) ?? null;
  }

  private submit(
    ownerId: string,
    kind: MediaKind,
    consent: boolean,
    work: (
      signal: AbortSignal
    ) => Promise<{ binary?: GeneratedBinary; text?: string; usage?: CanonicalMediaUsage }>
  ): MediaJob {
    const capability =
      kind === "image" ? "image_generation" : kind === "speech" ? "speech" : "transcription";
    this.check(capability, consent, ownerId);
    if (
      this.running.size >= 4 ||
      [...this.running.values()].some((entry) => entry.owner === ownerId) ||
      this.list(ownerId).some((job) => job.status === "queued" || job.status === "running")
    )
      throw new Error("MEDIA_BUSY");
    const job = this.store!.create(ownerId, kind);
    const controller = new AbortController();
    const task = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        void this.execute(job, controller, work).finally(resolve);
      });
    });
    this.running.set(job.id, { owner: ownerId, controller, task });
    return job;
  }
  enqueue(ownerId: string, kind: "image" | "speech", value: string, consent: boolean): MediaJob {
    const route = this.registry.route(kind === "image" ? "image_generation" : "speech");
    if (!route || !this.adapter) throw new Error("MEDIA_UNAVAILABLE");
    return this.submit(ownerId, kind, consent, async (signal) => ({
      binary:
        kind === "image"
          ? await this.adapter!.generateImage(value, "gpt-image-1", signal)
          : await this.adapter!.speak(value, "gpt-4o-mini-tts", signal)
    }));
  }
  enqueueTranscription(
    ownerId: string,
    bytes: Uint8Array,
    mime: AudioMime,
    consent: boolean
  ): MediaJob {
    this.check("transcription", consent, ownerId);
    if (!bytes.length || bytes.length > MAX_RECORDING_BYTES) throw new Error("AUDIO_SIZE_INVALID");
    if (!validRecording(bytes, mime)) throw new Error("AUDIO_FORMAT_INVALID");
    // Copy only into bounded transient memory, NEVER write the microphone recording to storage.
    const recording = Uint8Array.from(bytes);
    return this.submit(ownerId, "transcription", consent, async (signal) => {
      if (this.adapter!.transcribeWithUsage) {
        const result = await this.adapter!.transcribeWithUsage(
          recording,
          mime,
          "gpt-4o-mini-transcribe",
          signal
        );
        return { text: result.text, ...(result.usage ? { usage: result.usage } : {}) };
      }
      return {
        text: await this.adapter!.transcribe(recording, mime, "gpt-4o-mini-transcribe", signal)
      };
    });
  }
  private async execute(
    job: MediaJob,
    controller: AbortController,
    work: (
      signal: AbortSignal
    ) => Promise<{ binary?: GeneratedBinary; text?: string; usage?: CanonicalMediaUsage }>
  ): Promise<void> {
    const store = this.store!;
    const timeout = setTimeout(() => controller.abort(), MAX_MS);
    timeout.unref?.();
    let dispatched = false;
    let reserved = false;
    let ledgerSettled = false;
    try {
      if (
        controller.signal.aborted ||
        this.closedOwners.has(job.owner_id) ||
        !this.ownerActive(job.owner_id) ||
        this.emergencyStopped()
      ) {
        store.transition(job.id, job.owner_id, "cancelled");
        return;
      }
      const capability =
        job.kind === "image"
          ? "image_generation"
          : job.kind === "speech"
            ? "speech"
            : "transcription";
      const model = this.registry.route(capability)?.model;
      if (!model || !this.budget) throw new Error("BUDGET_UNAVAILABLE");
      // The shared ledger MUST reserve idempotently using this exact job id, before any provider dispatch.
      await this.budget.reserve({
        ownerId: job.owner_id,
        operationId: job.id,
        kind: job.kind,
        model
      });
      reserved = true;
      store.budget(job.id, job.owner_id, "reserved");
      if (
        controller.signal.aborted ||
        this.closedOwners.has(job.owner_id) ||
        !this.ownerActive(job.owner_id) ||
        this.emergencyStopped() ||
        !store.transition(job.id, job.owner_id, "running")
      )
        return;
      dispatched = true;
      const output = await work(controller.signal);
      if (
        controller.signal.aborted ||
        this.closedOwners.has(job.owner_id) ||
        !this.ownerActive(job.owner_id) ||
        this.emergencyStopped() ||
        store.get(job.id, job.owner_id)?.status !== "running"
      )
        return;
      const usage = canonicalUsage(output.usage ?? output.binary?.usage);
      // Canonical provider evidence alone allows reconciliation. No fake token-price conversion.
      if (usage) {
        await this.budget.reconcile({ ownerId: job.owner_id, operationId: job.id, usage });
        ledgerSettled = true;
        store.budget(job.id, job.owner_id, "reconciled");
      } else {
        await this.budget.uncertain({
          ownerId: job.owner_id,
          operationId: job.id,
          reason: "NO_CANONICAL_USAGE"
        });
        ledgerSettled = true;
        store.budget(job.id, job.owner_id, "uncertain");
      }
      if (
        controller.signal.aborted ||
        this.closedOwners.has(job.owner_id) ||
        !this.ownerActive(job.owner_id) ||
        this.emergencyStopped() ||
        store.get(job.id, job.owner_id)?.status !== "running"
      )
        return;
      if (job.kind === "transcription" && typeof output.text === "string") {
        store.completeTranscript(
          job.id,
          job.owner_id,
          output.text,
          usage ? "reconciled" : "uncertain"
        );
      } else if (output.binary && job.kind !== "transcription") {
        store.complete(job.id, job.owner_id, output.binary, usage ? "reconciled" : "uncertain");
      } else throw new Error("INVALID_MEDIA_RESULT");
    } catch (error) {
      store.transition(
        job.id,
        job.owner_id,
        controller.signal.aborted ? "cancelled" : "failed",
        controller.signal.aborted
          ? null
          : error instanceof MediaProviderError
            ? error.code
            : "MEDIA_FAILURE"
      );
    } finally {
      if (reserved && !ledgerSettled) {
        try {
          await this.budget?.uncertain({
            ownerId: job.owner_id,
            operationId: job.id,
            reason: dispatched ? "DISPATCH_OUTCOME_UNKNOWN" : "RESERVED_BEFORE_DISPATCH"
          });
          ledgerSettled = true;
          store.budget(job.id, job.owner_id, "uncertain");
        } catch {
          /* Keep reserved hold; never claim refund. */
        }
      }
      clearTimeout(timeout);
      this.running.delete(job.id);
    }
  }
  cancel(id: string, ownerId: string): MediaJob | null {
    const job = this.get(id, ownerId);
    if (!job) return null;
    if (job.status === "queued" || job.status === "running") {
      this.running.get(id)?.controller.abort();
      return this.store?.transition(id, ownerId, "cancelled") ?? this.get(id, ownerId);
    }
    return job;
  }
  /** Explicit deletion; cancelling alone preserves history and accounting. */
  // The async service contract immediately fences late writes by removing the owned job.
  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(id: string, ownerId: string): Promise<boolean> {
    if (!this.get(id, ownerId)) return false;
    this.cancel(id, ownerId);
    return this.store?.delete(id, ownerId) ?? false;
  }
  /** Fences future dispatch and commits, aborts in-flight tasks, never releases usage holds. */
  async quiesce(ownerId: string): Promise<void> {
    this.closedOwners.add(ownerId);
    const tasks: Promise<void>[] = [];
    for (const [id, active] of this.running)
      if (active.owner === ownerId) {
        active.controller.abort();
        this.store?.transition(id, ownerId, "cancelled");
        tasks.push(active.task);
      }
    // Wait briefly for cooperative clients. A provider may ignore abort and still
    // bill after this wait; its reservation remains counted until reconciliation.
    // The owner fence and this task's aborted signal prevent eventual file writes.
    // Keep the task tracked so late settlement can mark its hold uncertain.
    if (!tasks.length) return;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(tasks),
        new Promise<void>((resolve) => {
          deadline = setTimeout(resolve, QUIESCE_DRAIN_MS);
        })
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }
  resume(ownerId: string): void {
    if (!this.closed) this.closedOwners.delete(ownerId);
  }
  exportOwner(ownerId: string): {
    jobs: MediaJob[];
    assets: Array<{
      id: string;
      url: string;
      mime: string;
      bytes: number;
      sha256: string | null;
      auth: "owner_session";
    }>;
  } {
    const jobs = this.list(ownerId);
    return {
      jobs,
      assets: jobs
        .filter((job) => job.status === "done" && job.asset && this.asset(job.id, ownerId))
        .map((job) => ({
          id: job.id,
          url: `/api/v1/media/assets/${job.id}?download=1`,
          mime: job.asset!.mime,
          bytes: job.asset!.bytes,
          sha256: job.asset!.sha256 ?? null,
          auth: "owner_session" as const
        }))
    };
  }
  /** Caller must quiesce owner before invoking; usage ledger is deliberately untouched. */
  async deleteOwner(ownerId: string): Promise<{ deleted_jobs: number }> {
    await this.quiesce(ownerId);
    return { deleted_jobs: this.store?.deleteOwner(ownerId) ?? 0 };
  }
  stop(): void {
    this.closed = true;
    for (const [id, active] of this.running) {
      active.controller.abort();
      this.store?.transition(id, active.owner, "cancelled");
    }
  }
}
