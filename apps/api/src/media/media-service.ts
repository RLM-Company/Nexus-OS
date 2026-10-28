import { createHash } from "node:crypto";
import {
  MediaCapabilityError,
  MediaCapabilityRegistry,
  MediaProviderError,
  OpenAIMediaAdapter,
  estimateWavDurationSeconds,
  validateImageParameters,
  validateSpeechParameters,
  validateTranscriptionParameters,
  verifyAudioRecordingSignature,
  type ImageAdapterOptions,
  type ImageGenerationParametersInput,
  type MediaAudioMime,
  type MediaCapability,
  type SpeechAdapterOptions,
  type SpeechGenerationParametersInput,
  type TranscribeAdapterOptions,
  type TranscribeAdapterResult
} from "@cosmora/model-gateway";
import {
  canonicalUsage,
  type CanonicalMediaUsage,
  type MediaKind,
  type OwnerMediaBudget
} from "./media-budget.js";
import { MediaFileStore, type CreateMediaJobMetadata, type MediaJob } from "./media-store.js";
import { isValidChatAttachments, type ChatImageAttachment } from "@cosmora/contracts";

type AudioMime = MediaAudioMime;
type GeneratedBinary = Awaited<ReturnType<OpenAIMediaAdapter["generateImage"]>> & {
  usage?: CanonicalMediaUsage;
};
export type MediaAdapter = {
  editImage?(
    prompt: string,
    references: readonly ChatImageAttachment[],
    model: "gpt-image-1",
    signal: AbortSignal,
    options?: ImageAdapterOptions
  ): Promise<GeneratedBinary>;
  generateImage(
    prompt: string,
    model: "gpt-image-1",
    signal: AbortSignal,
    options?: ImageAdapterOptions
  ): Promise<GeneratedBinary>;
  speak(
    text: string,
    model: "gpt-4o-mini-tts",
    signal: AbortSignal,
    options?: SpeechAdapterOptions
  ): Promise<GeneratedBinary>;
  transcribe(
    bytes: Uint8Array,
    mime: AudioMime,
    model: "gpt-4o-mini-transcribe",
    signal: AbortSignal,
    options?: TranscribeAdapterOptions
  ): Promise<string>;
  /** Optional: canonical provider usage and metadata for transcription when provider returns it. */
  transcribeWithUsage?(
    bytes: Uint8Array,
    mime: AudioMime,
    model: "gpt-4o-mini-transcribe",
    signal: AbortSignal,
    options?: TranscribeAdapterOptions
  ): Promise<TranscribeAdapterResult>;
};
export interface MediaOptions {
  imageEditingEnabled?: boolean;
  baseUrl?: string;
  directory?: string;
  apiKey?: string;
  paidEnabled?: boolean;
  adapter?: MediaAdapter;
  ownerBudget?: OwnerMediaBudget;
  registry?: MediaCapabilityRegistry;
  emergencyStopped?: () => boolean;
  ownerActive?: (ownerId: string) => boolean;
  executionTimeoutMs?: number;
}

export interface EnqueueImageRequest extends ImageGenerationParametersInput {
  readonly client_request_id?: string | undefined;
}

export interface EnqueueSpeechRequest extends SpeechGenerationParametersInput {
  readonly client_request_id?: string | undefined;
}

export interface EnqueueTranscriptionRequest {
  readonly client_request_id?: string | undefined;
  readonly language?: string | undefined;
  readonly duration_seconds?: number | undefined;
}

const MAX_RECORDING_BYTES = 1_500_000;
const MAX_RECORDING_DURATION_SECONDS = 60;
const DEFAULT_MAX_MS = 60_000;
const QUIESCE_DRAIN_MS = 1_000;
const FENCE_POLL_MS = 100;

const sha256Hex = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

const normalizeClientRequestId = (value: string | undefined): string | null => {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new Error("INVALID_CLIENT_REQUEST_ID");
  }
  return value;
};

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
  private readonly imageEditingEnabled: boolean;
  private readonly emergencyStopped: () => boolean;
  private readonly ownerActive: (ownerId: string) => boolean;
  private readonly executionTimeoutMs: number;

  constructor(options: MediaOptions = {}) {
    this.store = options.directory ? new MediaFileStore(options.directory) : null;
    this.paidEnabled = options.paidEnabled === true;
    this.imageEditingEnabled = options.imageEditingEnabled === true;
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
    this.executionTimeoutMs = options.executionTimeoutMs ?? DEFAULT_MAX_MS;
    if (
      !Number.isSafeInteger(this.executionTimeoutMs) ||
      this.executionTimeoutMs < 1 ||
      this.executionTimeoutMs > 120_000
    )
      throw new Error("INVALID_MEDIA_DEADLINE");
    // Crash recovery never dispatches again. A pre-existing reservation remains
    // held until canonical ownerBudget explicitly reconciles it.
    if (this.store && this.budget) {
      for (const job of this.store.recovered())
        if (job.budget_state === "reserved" || job.budget_state === "uncertain") {
          void Promise.resolve()
            .then(() =>
              this.budget!.uncertain({
                ownerId: job.owner_id,
                operationId: job.id,
                reason: "INTERRUPTED"
              })
            )
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
    {
      ready: boolean;
      model: string | null;
      provider: string | null;
      reason: string | null;
      constraints?: unknown;
    }
  > & { image_editing: { ready: boolean; model: string | null; reason: string | null } } {
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
      result[capability] = {
        ready: reason === null,
        model: route?.model ?? null,
        provider: route?.provider ?? null,
        reason,
        constraints:
          route?.imageConstraints ??
          route?.transcriptionConstraints ??
          route?.speechConstraints ??
          null
      };
    }
    const reason =
      result.image_generation.reason ??
      (!this.imageEditingEnabled || !this.adapter?.editImage ? "EDITING_UNAVAILABLE" : null);
    result.image_editing = { ready: reason === null, model: result.image_generation.model, reason };
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
    metadata: CreateMediaJobMetadata,
    work: (signal: AbortSignal) => Promise<{
      binary?: GeneratedBinary;
      text?: string;
      language?: string | null;
      duration_seconds?: number | null;
      usage?: CanonicalMediaUsage;
    }>,
    timeoutMs = this.executionTimeoutMs
  ): MediaJob {
    const capability =
      kind === "image" ? "image_generation" : kind === "speech" ? "speech" : "transcription";
    this.check(capability, consent, ownerId);

    // Idempotent client_request_id check BEFORE busy/quota checks so retries return the existing job.
    if (metadata.client_request_id) {
      const existing = this.store!.findByClientRequest(ownerId, kind, metadata.client_request_id);
      if (existing) {
        if (
          existing.request_fingerprint &&
          metadata.request_fingerprint &&
          existing.request_fingerprint !== metadata.request_fingerprint
        ) {
          throw new Error("IDEMPOTENCY_CONFLICT");
        }
        return existing;
      }
    }

    if (
      this.running.size >= 4 ||
      [...this.running.values()].some((entry) => entry.owner === ownerId) ||
      this.list(ownerId).some((job) => job.status === "queued" || job.status === "running")
    ) {
      throw new Error("MEDIA_BUSY");
    }

    const route = this.registry.route(capability);
    if (!route) throw new Error("MEDIA_UNAVAILABLE");

    const job = this.store!.create(ownerId, kind, {
      ...metadata,
      model: route.model,
      provider: route.provider
    });
    const controller = new AbortController();
    const task = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        void this.execute(job, controller, work, timeoutMs).finally(resolve);
      });
    });
    this.running.set(job.id, { owner: ownerId, controller, task });
    return job;
  }

  enqueue(
    ownerId: string,
    kind: "image" | "speech",
    value: string,
    consent: boolean,
    optionsOrReferences:
      EnqueueImageRequest | EnqueueSpeechRequest | readonly ChatImageAttachment[] = {},
    references: readonly ChatImageAttachment[] = []
  ): MediaJob {
    const requestOptions = (Array.isArray(optionsOrReferences) ? {} : optionsOrReferences) as
      EnqueueImageRequest | EnqueueSpeechRequest;
    const resolvedReferences: readonly ChatImageAttachment[] = Array.isArray(optionsOrReferences)
      ? (optionsOrReferences as ChatImageAttachment[])
      : references;
    const inputs = resolvedReferences.map((reference) => ({ ...reference }));
    if (inputs.length && (kind !== "image" || !this.capabilities().image_editing.ready))
      throw new Error("IMAGE_EDITING_UNAVAILABLE");
    if (inputs.length && !isValidChatAttachments(inputs))
      throw new Error("IMAGE_REFERENCES_INVALID");
    const capability = kind === "image" ? "image_generation" : "speech";
    const route = this.registry.route(capability);
    if (!route || !this.adapter) throw new Error("MEDIA_UNAVAILABLE");

    const clientRequestId = normalizeClientRequestId(requestOptions.client_request_id);
    const trimmed = value.trim();
    if (!trimmed) throw new Error("TEXT_REQUIRED");

    if (kind === "image") {
      if (trimmed.length > 2000) throw new MediaCapabilityError("PROMPT_TOO_LONG");
      const validated = validateImageParameters(route, requestOptions);
      const fingerprint = sha256Hex(
        JSON.stringify({
          kind: "image",
          prompt: trimmed,
          size: validated.size,
          aspect_ratio: validated.aspect_ratio,
          quality: validated.quality,
          format: validated.format,
          count: validated.count,
          references: inputs.map((reference) => ({
            mime: reference.media_type,
            sha256: sha256Hex(Buffer.from(reference.data_base64, "base64"))
          }))
        })
      );
      return this.submit(
        ownerId,
        "image",
        consent,
        {
          client_request_id: clientRequestId,
          request_fingerprint: fingerprint,
          parameters: {
            prompt_sha256: sha256Hex(trimmed),
            prompt_length: trimmed.length,
            size: validated.size,
            aspect_ratio: validated.aspect_ratio,
            quality: validated.quality,
            format: validated.format,
            count: validated.count
          }
        },
        async (signal) => ({
          binary: await (inputs.length
            ? this.adapter!.editImage!(trimmed, inputs, "gpt-image-1", signal, {
                size: validated.size,
                quality: validated.quality,
                format: validated.format
              })
            : this.adapter!.generateImage(trimmed, "gpt-image-1", signal, {
                size: validated.size,
                quality: validated.quality,
                format: validated.format
              }))
        }),
        inputs.length ? 120_000 : this.executionTimeoutMs
      );
    }

    if (trimmed.length > 4096) throw new MediaCapabilityError("SPEECH_TEXT_TOO_LONG");
    const validatedSpeech = validateSpeechParameters(route, requestOptions);
    const fingerprint = sha256Hex(
      JSON.stringify({
        kind: "speech",
        text: trimmed,
        voice: validatedSpeech.voice,
        format: validatedSpeech.format,
        speed: validatedSpeech.speed
      })
    );
    return this.submit(
      ownerId,
      "speech",
      consent,
      {
        client_request_id: clientRequestId,
        request_fingerprint: fingerprint,
        parameters: {
          text_sha256: sha256Hex(trimmed),
          text_length: trimmed.length,
          voice: validatedSpeech.voice,
          format: validatedSpeech.format,
          speed: validatedSpeech.speed
        }
      },
      async (signal) => ({
        binary: await this.adapter!.speak(trimmed, "gpt-4o-mini-tts", signal, {
          voice: validatedSpeech.voice,
          format: validatedSpeech.format,
          speed: validatedSpeech.speed
        })
      })
    );
  }

  enqueueTranscription(
    ownerId: string,
    bytes: Uint8Array,
    mime: AudioMime,
    consent: boolean,
    requestOptions: EnqueueTranscriptionRequest = {}
  ): MediaJob {
    this.check("transcription", consent, ownerId);
    const clientRequestId = normalizeClientRequestId(requestOptions.client_request_id);
    if (!bytes.length || bytes.length > MAX_RECORDING_BYTES) throw new Error("AUDIO_SIZE_INVALID");
    const route = this.registry.route("transcription");
    let validated: ReturnType<typeof validateTranscriptionParameters>;
    try {
      validated = validateTranscriptionParameters(route, {
        mime,
        language: requestOptions.language,
        duration_seconds: requestOptions.duration_seconds
      });
    } catch (error) {
      if (error instanceof MediaCapabilityError) {
        if (error.reason === "TRANSCRIPTION_MIME_UNSUPPORTED") {
          throw new Error("AUDIO_FORMAT_INVALID", { cause: error });
        }
        if (error.reason === "TRANSCRIPTION_DURATION_INVALID") {
          throw new Error("AUDIO_DURATION_INVALID", { cause: error });
        }
      }
      throw error;
    }
    if (!verifyAudioRecordingSignature(bytes, validated.mime)) {
      throw new Error("AUDIO_FORMAT_INVALID");
    }
    const wavDuration = validated.mime === "audio/wav" ? estimateWavDurationSeconds(bytes) : null;
    if (wavDuration !== null && wavDuration > MAX_RECORDING_DURATION_SECONDS) {
      throw new Error("AUDIO_DURATION_INVALID");
    }
    if (validated.mime === "audio/wav" && wavDuration === null)
      throw new Error("AUDIO_FORMAT_INVALID");
    const resolvedDuration = validated.duration_seconds ?? wavDuration;
    const audioSha256 = sha256Hex(bytes);
    const fingerprint = sha256Hex(
      JSON.stringify({
        kind: "transcription",
        audio_sha256: audioSha256,
        mime: validated.mime,
        language: validated.language
      })
    );
    // Copy only into bounded transient memory, NEVER write the microphone recording to storage.
    const recording = Uint8Array.from(bytes);
    return this.submit(
      ownerId,
      "transcription",
      consent,
      {
        client_request_id: clientRequestId,
        request_fingerprint: fingerprint,
        language: validated.language,
        duration_seconds: resolvedDuration,
        parameters: {
          audio_sha256: audioSha256,
          audio_bytes: recording.byteLength,
          mime: validated.mime,
          ...(validated.language ? { language: validated.language } : {}),
          ...(resolvedDuration !== null ? { duration_seconds: resolvedDuration } : {})
        }
      },
      async (signal) => {
        if (this.adapter!.transcribeWithUsage) {
          const result = await this.adapter!.transcribeWithUsage(
            recording,
            validated.mime,
            "gpt-4o-mini-transcribe",
            signal,
            { language: validated.language }
          );
          return {
            text: result.text,
            language: result.language ?? validated.language,
            duration_seconds: result.duration_seconds ?? resolvedDuration,
            ...(result.usage ? { usage: result.usage } : {})
          };
        }
        return {
          text: await this.adapter!.transcribe(
            recording,
            validated.mime,
            "gpt-4o-mini-transcribe",
            signal,
            { language: validated.language }
          ),
          language: validated.language,
          duration_seconds: resolvedDuration
        };
      }
    );
  }

  private async execute(
    job: MediaJob,
    controller: AbortController,
    work: (signal: AbortSignal) => Promise<{
      binary?: GeneratedBinary;
      text?: string;
      language?: string | null;
      duration_seconds?: number | null;
      usage?: CanonicalMediaUsage;
    }>,
    timeoutMs: number
  ): Promise<void> {
    const store = this.store!;
    let timedOut = false;
    let emergencyAborted = false;
    const timeout = setTimeout(() => {
      if (controller.signal.aborted) return;
      timedOut = true;
      store.transition(job.id, job.owner_id, "failed", "timeout");
      controller.abort(new Error("TIMEOUT"));
    }, timeoutMs);
    timeout.unref?.();
    const fenceMonitor = setInterval(() => {
      if (controller.signal.aborted) return;
      if (this.emergencyStopped()) {
        emergencyAborted = true;
        store.transition(job.id, job.owner_id, "failed", "EMERGENCY_STOP");
        controller.abort(new Error("EMERGENCY_STOP"));
      } else if (this.closedOwners.has(job.owner_id) || !this.ownerActive(job.owner_id)) {
        store.transition(job.id, job.owner_id, "cancelled");
        controller.abort(new Error("OWNER_INACTIVE"));
      }
    }, FENCE_POLL_MS);
    fenceMonitor.unref?.();

    let dispatched = false;
    let reserved = false;
    let ledgerSettled = false;
    try {
      if (this.emergencyStopped()) {
        store.transition(job.id, job.owner_id, "failed", "EMERGENCY_STOP");
        return;
      }
      if (
        controller.signal.aborted ||
        this.closedOwners.has(job.owner_id) ||
        !this.ownerActive(job.owner_id)
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
      if (this.emergencyStopped()) {
        store.transition(job.id, job.owner_id, "failed", "EMERGENCY_STOP");
        return;
      }
      if (
        controller.signal.aborted ||
        this.closedOwners.has(job.owner_id) ||
        !this.ownerActive(job.owner_id) ||
        !store.transition(job.id, job.owner_id, "running")
      ) {
        store.transition(job.id, job.owner_id, "cancelled");
        return;
      }
      dispatched = true;
      const output = await work(controller.signal);
      if (this.emergencyStopped() || emergencyAborted) {
        store.transition(job.id, job.owner_id, "failed", "EMERGENCY_STOP");
        return;
      }
      if (timedOut) {
        store.transition(job.id, job.owner_id, "failed", "timeout");
        return;
      }
      if (
        controller.signal.aborted ||
        this.closedOwners.has(job.owner_id) ||
        !this.ownerActive(job.owner_id) ||
        store.get(job.id, job.owner_id)?.status !== "running"
      ) {
        return;
      }
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
      if (this.emergencyStopped() || emergencyAborted) {
        store.transition(job.id, job.owner_id, "failed", "EMERGENCY_STOP");
        return;
      }
      if (
        controller.signal.aborted ||
        this.closedOwners.has(job.owner_id) ||
        !this.ownerActive(job.owner_id) ||
        store.get(job.id, job.owner_id)?.status !== "running"
      ) {
        return;
      }
      if (job.kind === "transcription" && typeof output.text === "string") {
        store.completeTranscript(
          job.id,
          job.owner_id,
          output.text,
          usage ? "reconciled" : "uncertain",
          {
            language: output.language,
            duration_seconds: output.duration_seconds,
            usage: usage ?? null
          }
        );
      } else if (output.binary && job.kind !== "transcription") {
        const binaryWithUsage = usage ? { ...output.binary, usage } : output.binary;
        store.complete(job.id, job.owner_id, binaryWithUsage, usage ? "reconciled" : "uncertain");
      } else {
        throw new MediaProviderError("INVALID_ASSET", "Invalid media result", {
          normalizedCode: "corrupt_response"
        });
      }
    } catch (error) {
      if (emergencyAborted || this.emergencyStopped()) {
        store.transition(job.id, job.owner_id, "failed", "EMERGENCY_STOP");
      } else if (
        timedOut ||
        (error instanceof MediaProviderError && error.normalizedCode === "timeout")
      ) {
        store.transition(job.id, job.owner_id, "failed", "timeout");
      } else if (controller.signal.aborted) {
        store.transition(job.id, job.owner_id, "cancelled", null);
      } else if (error instanceof MediaCapabilityError) {
        store.transition(job.id, job.owner_id, "failed", "capability_unavailable");
      } else if (error instanceof MediaProviderError) {
        store.transition(job.id, job.owner_id, "failed", error.normalizedCode);
      } else if (
        (error as { code?: unknown } | null)?.code === "USAGE_LIMIT_EXCEEDED" ||
        (error instanceof Error && error.message === "MEDIA_LIMIT")
      ) {
        store.transition(job.id, job.owner_id, "failed", "USAGE_LIMIT_EXCEEDED");
      } else if (error instanceof Error && error.message === "CORRUPT_MEDIA_BINARY") {
        store.transition(job.id, job.owner_id, "failed", "corrupt_response");
      } else if (error instanceof Error && error.message === "MEDIA_TYPE_MISMATCH") {
        store.transition(job.id, job.owner_id, "failed", "invalid_mime");
      } else {
        store.transition(job.id, job.owner_id, "failed", "MEDIA_FAILURE");
      }
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
      clearInterval(fenceMonitor);
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
