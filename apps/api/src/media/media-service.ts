import {
  MediaCapabilityRegistry,
  MediaProviderError,
  OpenAIMediaAdapter,
  type MediaCapability
} from "@cosmora/model-gateway";
import { MediaFileStore, type MediaJob } from "./media-store.js";

export interface MediaOptions {
  directory?: string;
  apiKey?: string;
  paidEnabled?: boolean;
  adapter?: Pick<OpenAIMediaAdapter, "generateImage" | "speak" | "transcribe">;
  registry?: MediaCapabilityRegistry;
  emergencyStopped?: () => boolean;
}

export class MediaService {
  private readonly store: MediaFileStore | null;
  private readonly adapter: MediaOptions["adapter"];
  private readonly registry: MediaCapabilityRegistry;
  private readonly running = new Map<string, { owner: string; controller: AbortController }>();
  private readonly paidEnabled: boolean;
  private readonly transcriptions = new Map<string, AbortController>();
  private readonly emergencyStopped: () => boolean;

  constructor(options: MediaOptions = {}) {
    this.store = options.directory ? new MediaFileStore(options.directory) : null;
    this.paidEnabled = options.paidEnabled === true;
    this.registry = options.registry ?? new MediaCapabilityRegistry();
    this.adapter =
      options.adapter ?? (options.apiKey ? new OpenAIMediaAdapter(options.apiKey) : undefined);
    this.emergencyStopped = options.emergencyStopped ?? (() => false);
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
              : this.emergencyStopped()
                ? "EMERGENCY_STOP"
                : null;
      result[capability] = { ready: reason === null, model: route?.model ?? null, reason };
    }
    return result;
  }
  private check(capability: MediaCapability, consent: boolean): void {
    if (this.capabilities()[capability].ready !== true) throw new Error("MEDIA_UNAVAILABLE");
    if (!consent) throw new Error("CONSENT_REQUIRED");
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

  delete(id: string, ownerId: string): boolean {
    return this.store?.delete(id, ownerId) ?? false;
  }
  enqueue(ownerId: string, kind: "image" | "speech", value: string, consent: boolean): MediaJob {
    const capability = kind === "image" ? "image_generation" : "speech";
    this.check(capability, consent);
    if (
      this.running.size >= 4 ||
      [...this.running.values()].some((entry) => entry.owner === ownerId) ||
      this.list(ownerId).some((job) => job.status === "queued" || job.status === "running")
    )
      throw new Error("MEDIA_BUSY");
    const store = this.store!;
    const job = store.create(ownerId, kind);
    const controller = new AbortController();
    this.running.set(job.id, { owner: ownerId, controller });
    queueMicrotask(() => {
      void this.execute(job, value, controller);
    });
    return job;
  }
  private async execute(job: MediaJob, value: string, controller: AbortController): Promise<void> {
    const store = this.store!;
    const timeout = setTimeout(() => controller.abort(), 120_000);
    timeout.unref?.();
    const stopPoll = setInterval(() => {
      if (this.emergencyStopped()) controller.abort();
    }, 250);
    stopPoll.unref?.();
    try {
      if (this.emergencyStopped()) {
        store.transition(job.id, job.owner_id, "failed", "EMERGENCY_STOP");
        return;
      }
      if (!store.transition(job.id, job.owner_id, "running")) return;
      const route = this.registry.route(job.kind === "image" ? "image_generation" : "speech");
      if (!route || !this.adapter) throw new Error("MEDIA_UNAVAILABLE");
      const output =
        job.kind === "image"
          ? await this.adapter.generateImage(value, "gpt-image-1", controller.signal)
          : await this.adapter.speak(value, "gpt-4o-mini-tts", controller.signal);
      if (controller.signal.aborted || this.emergencyStopped()) {
        store.transition(job.id, job.owner_id, "cancelled");
        return;
      }
      store.complete(job.id, job.owner_id, output);
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
      clearTimeout(timeout);
      this.running.delete(job.id);
      clearInterval(stopPoll);
    }
  }
  cancel(id: string, ownerId: string): MediaJob | null {
    const job = this.get(id, ownerId);
    if (!job) return null;
    if (job.status === "queued" || job.status === "running") {
      this.running.get(id)?.controller.abort();
      return this.store?.transition(id, ownerId, "cancelled") ?? null;
    }
    return job;
  }
  async transcribe(
    ownerId: string,
    bytes: Uint8Array,
    mime: "audio/webm" | "audio/wav" | "audio/mp4" | "audio/mpeg",
    consent: boolean,
    signal?: AbortSignal
  ): Promise<string> {
    this.check("transcription", consent);
    if (this.transcriptions.has(ownerId) || this.transcriptions.size >= 4)
      throw new Error("MEDIA_BUSY");
    if (!bytes.length || bytes.length > 1_500_000) throw new Error("AUDIO_SIZE_INVALID");
    const valid =
      mime === "audio/webm"
        ? [0x1a, 0x45, 0xdf, 0xa3].every((v, i) => bytes[i] === v)
        : mime === "audio/wav"
          ? Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF"
          : mime === "audio/mp4"
            ? Buffer.from(bytes.subarray(4, 8)).toString() === "ftyp"
            : bytes[0] === 0xff || Buffer.from(bytes.subarray(0, 3)).toString() === "ID3";
    if (!valid) throw new Error("AUDIO_FORMAT_INVALID");
    const controller = new AbortController();
    this.transcriptions.set(ownerId, controller);
    const timeout = setTimeout(() => controller.abort(), 60_000);
    timeout.unref?.();
    const stopPoll = setInterval(() => {
      if (this.emergencyStopped()) controller.abort();
    }, 250);
    stopPoll.unref?.();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      if (!this.adapter) throw new Error("MEDIA_UNAVAILABLE");
      const text = await this.adapter.transcribe(
        bytes,
        mime,
        "gpt-4o-mini-transcribe",
        controller.signal
      );
      if (this.emergencyStopped() || controller.signal.aborted)
        throw new Error("MEDIA_UNAVAILABLE");
      return text;
    } finally {
      clearTimeout(timeout);
      this.transcriptions.delete(ownerId);
      clearInterval(stopPoll);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  stop(): void {
    for (const [id, { owner, controller }] of this.running) {
      controller.abort();
      this.store?.transition(id, owner, "cancelled");
    }
    for (const controller of this.transcriptions.values()) controller.abort();
  }
}
