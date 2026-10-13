import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createArchive, verifiedOriginal } from "./archive.js";

export const REQUIRED_PRIVACY_STORES = [
  "account-core",
  "documents",
  "work",
  "research",
  "media",
  "code",
  "agent-studio",
  "policy-projects",
  "canvas",
  "presentations"
] as const;
export type PrivacyStoreId = string;
export class PrivacyUnavailableError extends Error {
  readonly code = "PRIVACY_ADAPTERS_UNAVAILABLE";
}
export class PrivacyIncompleteError extends Error {
  readonly code = "PRIVACY_EXPORT_INCOMPLETE";
}
export class PrivacyOperationError extends Error {
  readonly code = "PRIVACY_OPERATION_FAILED";
}

export interface OriginalBinary {
  /** Unique opaque ID for an original inside its owner-scoped adapter. Never a file path or public URL. */
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
}
export interface PrivacySection {
  /** Plain metadata and text only. No auth credentials, secret tokens or binary data. */
  records: Record<string, unknown[]>;
  originals: OriginalBinary[];
  /** Must be true only after the adapter proves it enumerated EVERY owned record and original. */
  complete: boolean;
  /** Honest explanation for absent originals or unsupported data. */
  limitations?: string[];
}
export interface BinaryStream {
  stream: NodeJS.ReadableStream;
  original: OriginalBinary;
}
export interface PrivacyAdapter {
  readonly id: PrivacyStoreId;
  /** Every writer must check durable owner epoch/fence; in-flight tasks must be aborted and joined. */
  quiesce(ownerId: string, epoch: number): Promise<{ drained: true; fence_epoch: number }>;
  export(ownerId: string): Promise<PrivacySection>;
  /** Idempotent; deletion after quiesce, never touch authentication, accounting or audit. */
  delete(ownerId: string, epoch: number): Promise<{ deleted_records: number }>;
  /** Independently authorize owner+opaque binary key on each access; no URLs from user data. */
  readBinary?(ownerId: string, id: string): Promise<BinaryStream | null>;
  resume?(ownerId: string): Promise<void> | void;
}

export type PrivacyOverview = {
  ready: boolean;
  missing: string[];
  connected: string[];
  retained: string[];
  lifecycle: "active" | "quiescing" | "deleting" | "deleted" | "error";
  epoch: number;
};
export type PrivacyExport = {
  format: "kosmora-owner-export-v2";
  generated_at: string;
  owner_scope: string;
  complete: true;
  sections: Record<
    string,
    {
      records: Record<string, unknown[]>;
      count: number;
      originals: (OriginalBinary & { href: string; authentication: "owner-session" })[];
      limitations: string[];
    }
  >;
  original_count: number;
  record_count: number;
  retained: string[];
};
const retained = [
  "authentication sessions",
  "provider credentials",
  "system security audit",
  "canonical and retained usage accounting",
  "uncertain budget holds"
];
const phrase = "УДАЛИТЬ МОИ ДАННЫЕ";
const iso = () => new Date().toISOString();
const hash = (token: string) => createHash("sha256").update(token).digest();
const validId = (s: string) => /^[a-z][a-z0-9-]{1,63}$/.test(s);
const safePart = (s: string) => encodeURIComponent(s);

/**
 * Deliberately fail-closed registry: an adapter is REQUIRED if its ID is in the manifest.
 * It cannot self-declare a missing store as empty. No startup DDL. A failed destructive
 * operation leaves a durable fenced owner state; recovery requires explicit integrator action.
 */
export class OwnerPrivacyCoordinator {
  private readonly adapters = new Map<string, PrivacyAdapter>();
  private readonly required: readonly string[];
  private readonly maxBytes: number;
  constructor(
    private readonly sqlite: DatabaseSync,
    options: { required?: readonly string[]; maxExportBytes?: number } = {}
  ) {
    this.required = options.required ?? REQUIRED_PRIVACY_STORES;
    this.maxBytes = options.maxExportBytes ?? 20 * 1024 * 1024;
    if (
      !this.required.includes("account-core") ||
      new Set(this.required).size !== this.required.length ||
      this.required.some((s) => !validId(s))
    )
      throw new Error("Invalid privacy manifest");
  }
  register(adapter: PrivacyAdapter): void {
    if (
      !validId(adapter.id) ||
      this.adapters.has(adapter.id) ||
      typeof adapter.quiesce !== "function" ||
      typeof adapter.export !== "function" ||
      typeof adapter.delete !== "function"
    )
      throw new Error("Duplicate/invalid privacy adapter");
    this.adapters.set(adapter.id, adapter);
  }
  overview(ownerId: string): PrivacyOverview {
    const state = this.sqlite
      .prepare("SELECT state,epoch FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .get(ownerId) as { state: PrivacyOverview["lifecycle"]; epoch: number } | undefined;
    const missing = this.required.filter((id) => !this.adapters.has(id));
    return {
      ready: missing.length === 0 && (!state || state.state === "active"),
      missing,
      connected: [...this.adapters.keys()],
      retained,
      lifecycle: state?.state ?? "active",
      epoch: state?.epoch ?? 0
    };
  }
  private requireReady(owner: string): PrivacyAdapter[] {
    const overview = this.overview(owner);
    if (overview.missing.length)
      throw new PrivacyUnavailableError(
        `Missing mandatory privacy adapters: ${overview.missing.join(", ")}`
      );
    if (overview.lifecycle !== "active")
      throw new PrivacyOperationError(`Owner lifecycle fenced: ${overview.lifecycle}`);
    return this.required.map((id) => this.adapters.get(id)!);
  }
  /** Check in every async writer immediately before persistence; database triggers also fence known stores. */
  assertWritable(owner: string, expectedEpoch?: number): void {
    const state = this.overview(owner);
    if (
      state.lifecycle !== "active" ||
      (expectedEpoch !== undefined && expectedEpoch !== state.epoch)
    )
      throw new PrivacyOperationError("OWNER_DATA_FENCED");
  }
  /** Export freezes new writes and drains in-flight tasks before collecting a snapshot. */
  private beginSnapshot(ownerId: string): { epoch: number; operationId: string } {
    const operationId = randomUUID();
    const now = iso();
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const current = this.sqlite
        .prepare("SELECT epoch,state FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
        .get(ownerId) as { epoch: number; state: string } | undefined;
      if (current && current.state !== "active")
        throw new PrivacyOperationError("Owner already has a privacy operation");
      const epoch = (current?.epoch ?? 0) + 1;
      this.sqlite
        .prepare(
          `INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,?,'quiescing',?,?,?)
        ON CONFLICT(owner_id) DO UPDATE SET epoch=excluded.epoch,state='quiescing',operation_id=excluded.operation_id,started_at=excluded.started_at,updated_at=excluded.updated_at,last_error=NULL`
        )
        .run(ownerId, epoch, operationId, now, now);
      this.sqlite.exec("COMMIT");
      return { epoch, operationId };
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
  /** Results are complete or a hard error, never an incomplete download pretending to be full. */
  async export(ownerId: string): Promise<PrivacyExport>;
  async export(
    ownerId: string,
    collector: (
      manifest: PrivacyExport,
      read: (store: string, id: string) => Promise<Buffer>
    ) => Promise<Buffer>
  ): Promise<Buffer>;
  async export(
    ownerId: string,
    collector?: (
      manifest: PrivacyExport,
      read: (store: string, id: string) => Promise<Buffer>
    ) => Promise<Buffer>
  ): Promise<PrivacyExport | Buffer> {
    const adapters = this.requireReady(ownerId);
    const snap = this.beginSnapshot(ownerId);
    try {
      const receipts = await Promise.all(adapters.map((a) => a.quiesce(ownerId, snap.epoch)));
      if (receipts.some((r) => r?.drained !== true || r.fence_epoch !== snap.epoch))
        throw new PrivacyOperationError("Owner quiesce fence not confirmed");
      const sections: PrivacyExport["sections"] = {};
      let originals = 0,
        records = 0;
      for (const adapter of adapters) {
        const section = await adapter.export(ownerId);
        if (!section.complete || (section.limitations?.length ?? 0) > 0)
          throw new PrivacyIncompleteError(
            `${adapter.id}: ${section.limitations?.join("; ") || "adapter did not certify completeness"}`
          );
        if (!section.records || !Array.isArray(section.originals))
          throw new PrivacyIncompleteError(`${adapter.id}: invalid section`);
        const ids = new Set<string>();
        for (const binary of section.originals) {
          if (
            !adapter.readBinary ||
            !binary.id ||
            ids.has(binary.id) ||
            !Number.isSafeInteger(binary.size_bytes) ||
            binary.size_bytes < 0 ||
            !/^[a-f0-9]{64}$/i.test(binary.sha256) ||
            !binary.filename ||
            !binary.content_type
          )
            throw new PrivacyIncompleteError(
              `${adapter.id}: original is not available through owner-scoped download`
            );
          ids.add(binary.id);
        }
        const count = Object.values(section.records).reduce((n, list) => {
          if (!Array.isArray(list))
            throw new PrivacyIncompleteError(`${adapter.id}: unbounded/invalid record set`);
          return n + list.length;
        }, 0);
        sections[adapter.id] = {
          records: section.records,
          count,
          originals: section.originals.map((x) => ({
            ...x,
            href: `/api/v1/personal-settings/binaries/${safePart(adapter.id)}/${safePart(x.id)}`,
            authentication: "owner-session"
          })),
          limitations: []
        };
        originals += section.originals.length;
        records += count;
        if (Buffer.byteLength(JSON.stringify(sections), "utf8") > this.maxBytes)
          throw new PrivacyIncompleteError(
            `Full export exceeds ${this.maxBytes} bytes; full segmented exporter required`
          );
      }
      const result: PrivacyExport = {
        format: "kosmora-owner-export-v2",
        generated_at: iso(),
        owner_scope: ownerId,
        complete: true,
        sections,
        original_count: originals,
        record_count: records,
        retained
      };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > this.maxBytes)
        throw new PrivacyIncompleteError("Full export exceeds limit; no file produced");
      if (!collector) return result;
      return await collector(result, async (store, id) => {
        const adapter = this.adapters.get(store);
        const expected = result.sections[store]?.originals.find((item) => item.id === id);
        if (!adapter?.readBinary || !expected)
          throw new PrivacyIncompleteError("Unlisted original");
        const binary = await adapter.readBinary(ownerId, id);
        if (
          !binary ||
          binary.original.size_bytes !== expected.size_bytes ||
          binary.original.sha256.toLowerCase() !== expected.sha256.toLowerCase() ||
          binary.original.filename !== expected.filename ||
          binary.original.content_type !== expected.content_type
        )
          throw new PrivacyIncompleteError("Original changed during snapshot");
        return verifiedOriginal(binary.stream, binary.original, 100 * 1024 * 1024);
      });
    } finally {
      // Export is nondestructive; release its durable fence even after a failed snapshot.
      this.sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state='active',updated_at=? WHERE owner_id=? AND epoch=? AND operation_id=? AND state='quiescing'"
        )
        .run(iso(), ownerId, snap.epoch, snap.operationId);
      // Resume the actual in-process owner fences; a DB-only release leaves media/research/documents inert.
      await Promise.all(adapters.map((a) => Promise.resolve(a.resume?.(ownerId))));
    }
  }
  /** JSON manifest plus every authenticated original, assembled inside the SAME quiesce epoch. */
  async exportArchive(ownerId: string): Promise<Buffer> {
    return this.export(ownerId, async (manifest, read) => {
      const entries: { path: string; bytes: Buffer }[] = [];
      const index: {
        store: string;
        id: string;
        path: string;
        sha256: string;
        size_bytes: number;
      }[] = [];
      let total = 0;
      for (const [store, section] of Object.entries(manifest.sections)) {
        for (let i = 0; i < section.originals.length; i++) {
          const original = section.originals[i]!;
          const path = `originals/${store}/${String(i).padStart(5, "0")}.bin`;
          const bytes = await read(store, original.id);
          total += bytes.length;
          if (total > 100 * 1024 * 1024)
            throw new PrivacyIncompleteError("Owner originals exceed archive safety limit");
          entries.push({ path, bytes });
          index.push({
            store,
            id: original.id,
            path,
            sha256: original.sha256,
            size_bytes: original.size_bytes
          });
        }
      }
      entries.unshift({
        path: "manifest.json",
        bytes: Buffer.from(
          JSON.stringify({ ...manifest, archive_originals: index }, null, 2),
          "utf8"
        )
      });
      try {
        return createArchive(entries, 120 * 1024 * 1024);
      } catch (error) {
        throw new PrivacyIncompleteError(
          error instanceof Error ? error.message : "Export exceeds bound"
        );
      }
    });
  }
  async binary(ownerId: string, adapterId: string, binaryId: string): Promise<BinaryStream | null> {
    this.requireReady(ownerId);
    const adapter = this.adapters.get(adapterId);
    if (!adapter || !this.required.includes(adapterId) || !adapter.readBinary) return null;
    // Adapter must perform owner scoping independently. Do not fetch remote URLs or host paths.
    const result = await adapter.readBinary(ownerId, binaryId);
    if (!result) return null;
    if (
      result.original.id !== binaryId ||
      !Number.isSafeInteger(result.original.size_bytes) ||
      !/^[a-f0-9]{64}$/i.test(result.original.sha256)
    )
      throw new PrivacyIncompleteError("Binary descriptor mismatch");
    return result;
  }
  /** The old single-store delete endpoint is intentionally bypassed; confirmation is one-use. */
  async delete(
    ownerId: string,
    token: string,
    confirmation: string
  ): Promise<{
    deleted: true;
    by_store: Record<string, number>;
    retained: string[];
    epoch: number;
  }> {
    if (
      confirmation !== phrase ||
      typeof token !== "string" ||
      token.length < 20 ||
      token.length > 128
    )
      throw new PrivacyOperationError("Explicit confirmation required");
    const adapters = this.requireReady(ownerId);
    const op = randomUUID();
    const now = iso();
    let epoch: number;
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const challenge = this.sqlite
        .prepare("SELECT digest,expires_at FROM kosmora_data_delete_challenges WHERE owner_id=?")
        .get(ownerId) as { digest: string; expires_at: string } | undefined;
      const digest = hash(token);
      if (
        !challenge ||
        Date.parse(challenge.expires_at) <= Date.now() ||
        !/^[a-f0-9]{64}$/.test(challenge.digest) ||
        !timingSafeEqual(Buffer.from(challenge.digest, "hex"), digest)
      )
        throw new PrivacyOperationError("Invalid or expired confirmation");
      const row = this.sqlite
        .prepare("SELECT epoch,state FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
        .get(ownerId) as { epoch: number; state: string } | undefined;
      if (row && row.state !== "active") throw new PrivacyOperationError("Owner is already fenced");
      epoch = (row?.epoch ?? 0) + 1;
      this.sqlite
        .prepare(
          `INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,?,'quiescing',?,?,?)
        ON CONFLICT(owner_id) DO UPDATE SET epoch=excluded.epoch,state='quiescing',operation_id=excluded.operation_id,started_at=excluded.started_at,updated_at=excluded.updated_at,last_error=NULL`
        )
        .run(ownerId, epoch, op, now, now);
      this.sqlite
        .prepare("DELETE FROM kosmora_data_delete_challenges WHERE owner_id=?")
        .run(ownerId);
      this.sqlite.exec("COMMIT");
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
    const report: Record<string, number> = {};
    try {
      // QUIESCE in all required stores, including core, BEFORE destructive operations.
      const receipts = await Promise.all(adapters.map((a) => a.quiesce(ownerId, epoch)));
      if (receipts.some((r) => r?.drained !== true || r.fence_epoch !== epoch))
        throw new PrivacyOperationError("Owner quiesce fence not confirmed");
      this.sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state='deleting',updated_at=? WHERE owner_id=? AND epoch=? AND state='quiescing'"
        )
        .run(iso(), ownerId, epoch);
      // Children first; account-core must be LAST because its parent deletion cascades.
      for (const adapter of [
        ...adapters.filter((a) => a.id !== "account-core"),
        adapters.find((a) => a.id === "account-core")!
      ]) {
        const result = await adapter.delete(ownerId, epoch);
        if (!Number.isSafeInteger(result.deleted_records) || result.deleted_records < 0)
          throw new Error(`${adapter.id}: invalid delete report`);
        report[adapter.id] = result.deleted_records;
      }
      this.sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state='deleted',updated_at=? WHERE owner_id=? AND epoch=? AND state='deleting'"
        )
        .run(iso(), ownerId, epoch);
      return { deleted: true, by_store: report, retained, epoch };
    } catch (e) {
      // Never report success on partial deletion. Keep state fenced to block late writes.
      this.sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state='error',last_error=?,updated_at=? WHERE owner_id=? AND epoch=?"
        )
        .run(e instanceof Error ? e.message.slice(0, 180) : "unknown", iso(), ownerId, epoch);
      throw new PrivacyOperationError(
        "Privacy deletion incomplete; owner remains fenced pending integrator recovery"
      );
    }
  }
}
