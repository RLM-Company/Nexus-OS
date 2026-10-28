import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  sniffMediaBinary,
  type MediaAssetExtension,
  type MediaAssetMime,
  type MediaBinary
} from "@cosmora/model-gateway";
import { canonicalUsage, type CanonicalMediaUsage, type MediaKind } from "./media-budget.js";

export type MediaJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type MediaJobKind = MediaKind;

const ALLOWED_ASSET_MIMES: readonly MediaAssetMime[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg"
];
const ALLOWED_ASSET_EXTENSIONS: readonly MediaAssetExtension[] = [
  "png",
  "jpg",
  "webp",
  "gif",
  "mp3",
  "wav",
  "ogg"
];

export type MediaJobAsset = {
  id?: string;
  owner_id?: string;
  source_operation_id?: string;
  mime: MediaAssetMime;
  extension: MediaAssetExtension;
  bytes: number;
  sha256?: string;
};

export type MediaJob = {
  id: string;
  owner_id: string;
  kind: MediaJobKind;
  status: MediaJobStatus;
  created_at: string;
  updated_at: string;
  error_code: string | null;
  budget_state: "none" | "reserved" | "reconciled" | "uncertain";
  transcript: string | null;
  language?: string | null;
  duration_seconds?: number | null;
  usage?: CanonicalMediaUsage | null;
  client_request_id?: string | null;
  request_fingerprint?: string | null;
  model?: string | null;
  provider?: string | null;
  parameters?: Record<string, unknown> | null;
  asset: MediaJobAsset | null;
};

export interface CreateMediaJobMetadata {
  readonly client_request_id?: string | null;
  readonly request_fingerprint?: string | null;
  readonly model?: string | null;
  readonly provider?: string | null;
  readonly parameters?: Record<string, unknown> | null;
  readonly language?: string | null;
  readonly duration_seconds?: number | null;
}

export interface CompleteTranscriptDetails {
  readonly language?: string | null | undefined;
  readonly duration_seconds?: number | null | undefined;
  readonly usage?: CanonicalMediaUsage | null;
}

const isId = (value: string): boolean =>
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const isJob = (value: unknown): value is MediaJob => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MediaJob>;
  return (
    typeof item.id === "string" &&
    isId(item.id) &&
    typeof item.owner_id === "string" &&
    item.owner_id.length > 0 &&
    ["image", "speech", "transcription"].includes(item.kind ?? "") &&
    ["queued", "running", "done", "failed", "cancelled"].includes(item.status ?? "") &&
    typeof item.created_at === "string" &&
    typeof item.updated_at === "string" &&
    (item.error_code === null || typeof item.error_code === "string") &&
    (item.transcript === undefined ||
      item.transcript === null ||
      (typeof item.transcript === "string" && item.transcript.length <= 20_000)) &&
    (item.language === undefined ||
      item.language === null ||
      (typeof item.language === "string" && item.language.length <= 32)) &&
    (item.duration_seconds === undefined ||
      item.duration_seconds === null ||
      (typeof item.duration_seconds === "number" &&
        Number.isFinite(item.duration_seconds) &&
        item.duration_seconds >= 0)) &&
    (item.usage === undefined || item.usage === null || canonicalUsage(item.usage) !== null) &&
    (item.client_request_id === undefined ||
      item.client_request_id === null ||
      (typeof item.client_request_id === "string" &&
        item.client_request_id.length > 0 &&
        item.client_request_id.length <= 128)) &&
    (item.request_fingerprint === undefined ||
      item.request_fingerprint === null ||
      (typeof item.request_fingerprint === "string" && item.request_fingerprint.length <= 128)) &&
    (item.model === undefined || item.model === null || typeof item.model === "string") &&
    (item.provider === undefined || item.provider === null || typeof item.provider === "string") &&
    (item.parameters === undefined ||
      item.parameters === null ||
      (typeof item.parameters === "object" && !Array.isArray(item.parameters))) &&
    (item.budget_state === undefined ||
      ["none", "reserved", "reconciled", "uncertain"].includes(item.budget_state)) &&
    (item.asset === null ||
      (item.asset !== undefined &&
        item.asset !== null &&
        typeof item.asset === "object" &&
        (ALLOWED_ASSET_MIMES as readonly string[]).includes(item.asset.mime) &&
        (ALLOWED_ASSET_EXTENSIONS as readonly string[]).includes(item.asset.extension) &&
        Number.isSafeInteger(item.asset.bytes) &&
        (item.asset.bytes ?? 0) > 0 &&
        (item.asset.sha256 === undefined || /^[a-f0-9]{64}$/.test(item.asset.sha256))))
  );
};

const cloneJob = (job: MediaJob): MediaJob => ({
  ...job,
  ...(job.usage ? { usage: { ...job.usage } } : {}),
  ...(job.parameters ? { parameters: { ...job.parameters } } : {}),
  asset: job.asset ? { ...job.asset } : null
});

/** Single-process durable filesystem job store. Not a replacement for the canonical usage ledger. */
export class MediaFileStore {
  private readonly jobs = new Map<string, MediaJob>();
  private readonly interrupted: MediaJob[] = [];

  constructor(readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error("MEDIA_DIRECTORY_NOT_ABSOLUTE");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink()) throw new Error("MEDIA_DIRECTORY_SYMLINK");
    for (const name of readdirSync(directory)) {
      if (!/^[a-f0-9-]{36}\.json$/i.test(name)) continue;
      try {
        const path = join(directory, name);
        if (!lstatSync(path).isFile()) continue;
        const job: unknown = JSON.parse(readFileSync(path, "utf8"));
        if (!isJob(job) || job.id !== name.slice(0, -5)) continue;
        const recovered: MediaJob = {
          ...job,
          budget_state: job.budget_state ?? "none",
          transcript: job.transcript ?? null
        };
        if (recovered.status === "queued" || recovered.status === "running") {
          this.interrupted.push(cloneJob(recovered));
          recovered.status = "failed";
          recovered.error_code = "INTERRUPTED";
          recovered.updated_at = new Date().toISOString();
          this.save(recovered);
        }
        this.jobs.set(recovered.id, recovered);
      } catch {
        /* Corrupt records are never exposed or replayed. */
      }
    }
    // Previous process is gone; remove uncommitted temporary and orphaned binaries.
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (!lstatSync(path).isFile()) continue;
      if (/^[a-f0-9-]{36}\.[a-f0-9-]{36}\.(tmp|asset-tmp)$/i.test(name)) {
        unlinkSync(path);
        continue;
      }
      const match = /^([a-f0-9-]{36})\.(png|jpg|webp|gif|mp3|wav|ogg)$/i.exec(name);
      if (match) {
        const job = this.jobs.get(match[1]!);
        if (job?.status !== "done" || job.asset?.extension !== match[2]?.toLowerCase()) {
          unlinkSync(path);
        }
      }
    }
  }

  recovered(): MediaJob[] {
    return this.interrupted.map((job) => cloneJob(job));
  }

  private save(job: MediaJob): void {
    const temp = join(this.directory, `${job.id}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, JSON.stringify(job), { mode: 0o600, flag: "wx" });
      renameSync(temp, join(this.directory, `${job.id}.json`));
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
    this.jobs.set(job.id, job);
  }

  findByClientRequest(
    ownerId: string,
    kind: MediaJobKind,
    clientRequestId: string
  ): MediaJob | null {
    if (!ownerId.trim() || !clientRequestId.trim()) return null;
    for (const job of this.jobs.values()) {
      if (
        job.owner_id === ownerId &&
        job.kind === kind &&
        job.client_request_id === clientRequestId
      ) {
        return cloneJob(job);
      }
    }
    return null;
  }

  create(ownerId: string, kind: MediaJobKind, metadata: CreateMediaJobMetadata = {}): MediaJob {
    if (!ownerId.trim()) throw new Error("OWNER_REQUIRED");
    if (this.list(ownerId).length >= 200) throw new Error("MEDIA_LIMIT");
    const now = new Date().toISOString();
    const job: MediaJob = {
      id: randomUUID(),
      owner_id: ownerId,
      kind,
      status: "queued",
      created_at: now,
      updated_at: now,
      error_code: null,
      budget_state: "none",
      transcript: null,
      ...(metadata.language !== undefined ? { language: metadata.language } : {}),
      ...(metadata.duration_seconds !== undefined
        ? { duration_seconds: metadata.duration_seconds }
        : {}),
      ...(metadata.client_request_id ? { client_request_id: metadata.client_request_id } : {}),
      ...(metadata.request_fingerprint
        ? { request_fingerprint: metadata.request_fingerprint }
        : {}),
      ...(metadata.model ? { model: metadata.model } : {}),
      ...(metadata.provider ? { provider: metadata.provider } : {}),
      ...(metadata.parameters ? { parameters: { ...metadata.parameters } } : {}),
      asset: null
    };
    this.save(job);
    return cloneJob(job);
  }

  get(id: string, ownerId: string): MediaJob | null {
    if (!isId(id)) return null;
    const job = this.jobs.get(id);
    return job?.owner_id === ownerId ? cloneJob(job) : null;
  }

  list(ownerId: string): MediaJob[] {
    return [...this.jobs.values()]
      .filter((job) => job.owner_id === ownerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((job) => cloneJob(job));
  }

  budget(id: string, ownerId: string, state: MediaJob["budget_state"]): MediaJob | null {
    const job = this.get(id, ownerId);
    if (!job) return null;
    this.save({ ...job, budget_state: state, updated_at: new Date().toISOString() });
    return this.get(id, ownerId);
  }

  transition(
    id: string,
    ownerId: string,
    status: MediaJobStatus,
    errorCode: string | null = null
  ): MediaJob | null {
    const job = this.get(id, ownerId);
    if (!job || ["done", "failed", "cancelled"].includes(job.status)) return null;
    if (status === "running" && job.status !== "queued") return null;
    if (status === "done") return null; // done requires atomic asset/transcript commit
    this.save({ ...job, status, error_code: errorCode, updated_at: new Date().toISOString() });
    return this.get(id, ownerId);
  }

  complete(
    id: string,
    ownerId: string,
    binary: MediaBinary,
    budgetState: "reconciled" | "uncertain"
  ): MediaJob | null {
    const job = this.get(id, ownerId);
    if (!job || job.status !== "running") return null;
    if (
      !ALLOWED_ASSET_MIMES.includes(binary.mime) ||
      !ALLOWED_ASSET_EXTENSIONS.includes(binary.extension) ||
      !binary.bytes.length ||
      binary.bytes.length > (job.kind === "image" ? 16 : 8) * 1024 * 1024
    )
      throw new Error("CORRUPT_MEDIA_BINARY");
    if (
      job.kind === "transcription" ||
      (job.kind === "image" && !binary.mime.startsWith("image/")) ||
      (job.kind === "speech" && !binary.mime.startsWith("audio/"))
    ) {
      throw new Error("MEDIA_TYPE_MISMATCH");
    }
    const sniffed = sniffMediaBinary(binary.bytes);
    if (!sniffed || sniffed.mime !== binary.mime || sniffed.extension !== binary.extension) {
      throw new Error("CORRUPT_MEDIA_BINARY");
    }
    const path = join(this.directory, `${id}.${binary.extension}`);
    const temp = join(this.directory, `${id}.${randomUUID()}.asset-tmp`);
    try {
      writeFileSync(temp, binary.bytes, { mode: 0o600, flag: "wx" });
      // Re-verify active ownership and running status right before committing the file.
      const current = this.jobs.get(id);
      if (!current || current.owner_id !== ownerId || current.status !== "running") {
        return null;
      }
      renameSync(temp, path);
      const usage = canonicalUsage(binary.usage);
      this.save({
        ...current,
        status: "done",
        updated_at: new Date().toISOString(),
        budget_state: budgetState,
        ...(usage ? { usage } : {}),
        asset: {
          id,
          owner_id: ownerId,
          source_operation_id: id,
          mime: binary.mime,
          extension: binary.extension,
          bytes: binary.bytes.length,
          sha256: sha256(binary.bytes)
        }
      });
      return this.get(id, ownerId);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
      if (this.get(id, ownerId)?.status !== "done" && existsSync(path)) unlinkSync(path);
    }
  }

  completeTranscript(
    id: string,
    ownerId: string,
    text: string,
    budgetState: "reconciled" | "uncertain",
    details: CompleteTranscriptDetails = {}
  ): MediaJob | null {
    const job = this.get(id, ownerId);
    if (!job || job.status !== "running" || job.kind !== "transcription") return null;
    if (text.length > 20_000) throw new Error("TRANSCRIPT_TOO_LONG");
    const usage = canonicalUsage(details.usage);
    this.save({
      ...job,
      status: "done",
      updated_at: new Date().toISOString(),
      transcript: text,
      ...(details.language !== undefined ? { language: details.language } : {}),
      ...(details.duration_seconds !== undefined
        ? { duration_seconds: details.duration_seconds }
        : {}),
      ...(usage ? { usage } : {}),
      budget_state: budgetState
    });
    return this.get(id, ownerId);
  }

  asset(id: string, ownerId: string): { bytes: Buffer; mime: string; extension: string } | null {
    const job = this.get(id, ownerId);
    if (job?.status !== "done" || !job.asset) return null;
    try {
      const path = join(this.directory, `${id}.${job.asset.extension}`);
      const info = lstatSync(path);
      if (
        !info.isFile() ||
        info.size !== job.asset.bytes ||
        info.size > (job.kind === "image" ? 16 : 8) * 1024 * 1024
      )
        return null;
      const bytes = readFileSync(path);
      if (
        bytes.length !== job.asset.bytes ||
        (job.asset.sha256 && sha256(bytes) !== job.asset.sha256)
      ) {
        return null;
      }
      const sniffed = sniffMediaBinary(bytes);
      if (
        !sniffed ||
        sniffed.mime !== job.asset.mime ||
        sniffed.extension !== job.asset.extension
      ) {
        return null;
      }
      return { bytes, mime: job.asset.mime, extension: job.asset.extension };
    } catch {
      return null;
    }
  }

  delete(id: string, ownerId: string): boolean {
    const job = this.get(id, ownerId);
    if (!job) return false;
    // Remove metadata first; a late callback can no longer complete this job.
    this.jobs.delete(id);
    const metadata = join(this.directory, `${id}.json`);
    if (existsSync(metadata)) unlinkSync(metadata);
    for (const extension of ALLOWED_ASSET_EXTENSIONS) {
      const path = join(this.directory, `${id}.${extension}`);
      if (existsSync(path) && lstatSync(path).isFile()) unlinkSync(path);
    }
    return true;
  }

  deleteOwner(ownerId: string): number {
    let count = 0;
    for (const job of this.list(ownerId)) if (this.delete(job.id, ownerId)) count++;
    return count;
  }
}
