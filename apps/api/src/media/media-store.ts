import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import type { MediaBinary } from "@cosmora/model-gateway";

export type MediaJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type MediaJobKind = "image" | "speech";
export type MediaJob = {
  id: string;
  owner_id: string;
  kind: MediaJobKind;
  status: MediaJobStatus;
  created_at: string;
  updated_at: string;
  error_code: string | null;
  asset: { mime: "image/png" | "audio/mpeg"; extension: "png" | "mp3"; bytes: number } | null;
};
const isId = (value: string): boolean => /^[a-f0-9-]{36}$/i.test(value);
const isJob = (value: unknown): value is MediaJob => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MediaJob>;
  return (
    typeof item.id === "string" &&
    isId(item.id) &&
    typeof item.owner_id === "string" &&
    (item.kind === "image" || item.kind === "speech") &&
    ["queued", "running", "done", "failed", "cancelled"].includes(item.status ?? "") &&
    typeof item.created_at === "string" &&
    typeof item.updated_at === "string" &&
    (item.error_code === null || typeof item.error_code === "string") &&
    (item.asset === null ||
      (item.asset !== undefined &&
        item.asset !== null &&
        typeof item.asset === "object" &&
        ["image/png", "audio/mpeg"].includes(item.asset.mime) &&
        ["png", "mp3"].includes(item.asset.extension) &&
        Number.isSafeInteger(item.asset.bytes) &&
        (item.asset.bytes ?? 0) > 0))
  );
};

/** Durable single-process filesystem store. Directory must be a persistent, owner-private volume. */
export class MediaFileStore {
  private readonly jobs = new Map<string, MediaJob>();
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(directory)) {
      if (!/^[a-f0-9-]{36}\.json$/i.test(name)) continue;
      try {
        const job: unknown = JSON.parse(readFileSync(join(directory, name), "utf8"));
        if (!isJob(job) || job.id !== name.slice(0, -5)) continue;
        const recovered = { ...job };
        if (recovered.status === "queued" || recovered.status === "running") {
          recovered.status = "failed";
          recovered.error_code = "INTERRUPTED";
          recovered.updated_at = new Date().toISOString();
          this.save(recovered);
        }
        this.jobs.set(recovered.id, recovered);
      } catch {
        /* Corrupt records never become visible, and cannot be executed. */
      }
    }
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
  create(ownerId: string, kind: MediaJobKind): MediaJob {
    if (this.list(ownerId).length >= 200) throw new Error("MEDIA_LIMIT");
    const timestamp = new Date().toISOString();
    const job: MediaJob = {
      id: randomUUID(),
      owner_id: ownerId,
      kind,
      status: "queued",
      created_at: timestamp,
      updated_at: timestamp,
      error_code: null,
      asset: null
    };
    this.save(job);
    return job;
  }
  get(id: string, ownerId: string): MediaJob | null {
    if (!isId(id)) return null;
    const job = this.jobs.get(id);
    return job?.owner_id === ownerId ? { ...job, asset: job.asset && { ...job.asset } } : null;
  }
  list(ownerId: string): MediaJob[] {
    return [...this.jobs.values()]
      .filter((job) => job.owner_id === ownerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((job) => ({ ...job }));
  }
  delete(id: string, ownerId: string): boolean {
    const job = this.get(id, ownerId);
    if (!job || job.status === "queued" || job.status === "running") return false;
    const metadata = join(this.directory, `${id}.json`);
    const asset = job.asset ? join(this.directory, `${id}.${job.asset.extension}`) : null;
    if (asset && existsSync(asset)) unlinkSync(asset);
    if (existsSync(metadata)) unlinkSync(metadata);
    this.jobs.delete(id);
    return true;
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
    this.save({ ...job, status, error_code: errorCode, updated_at: new Date().toISOString() });
    return this.get(id, ownerId);
  }
  complete(id: string, ownerId: string, binary: MediaBinary): MediaJob | null {
    const job = this.get(id, ownerId);
    if (!job || job.status !== "running") return null;
    if (
      (job.kind === "image" && binary.mime !== "image/png") ||
      (job.kind === "speech" && binary.mime !== "audio/mpeg") ||
      (binary.mime === "image/png" && binary.extension !== "png") ||
      (binary.mime === "audio/mpeg" && binary.extension !== "mp3") ||
      binary.bytes.length === 0 ||
      binary.bytes.length > 16 * 1024 * 1024
    )
      throw new Error("MEDIA_TYPE_MISMATCH");
    const assetPath = join(this.directory, `${id}.${binary.extension}`);
    const tempPath = join(this.directory, `${id}.${randomUUID()}.asset-tmp`);
    try {
      writeFileSync(tempPath, binary.bytes, { mode: 0o600, flag: "wx" });
      renameSync(tempPath, assetPath);
      this.save({
        ...job,
        status: "done",
        updated_at: new Date().toISOString(),
        asset: { mime: binary.mime, extension: binary.extension, bytes: binary.bytes.length }
      });
      return this.get(id, ownerId);
    } finally {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    }
  }
  asset(id: string, ownerId: string): { bytes: Buffer; mime: string; extension: string } | null {
    const job = this.get(id, ownerId);
    if (job?.status !== "done" || !job.asset) return null;
    try {
      const bytes = readFileSync(join(this.directory, `${id}.${job.asset.extension}`));
      if (bytes.length !== job.asset.bytes) return null;
      return { bytes, mime: job.asset.mime, extension: job.asset.extension };
    } catch {
      return null;
    }
  }
}
