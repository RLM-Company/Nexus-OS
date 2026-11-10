/**
 * Kosmora / Nexus-OS Rolling-Hash Content-Defined Chunking (CDC) & Sub-File Deduplication Engine (Wave 21)
 *
 * Implements FastCDC / Gear-based rolling hash Content-Defined Chunking for
 * local Vault documents and Google Drive backup snapshots.
 *
 * Why CDC instead of fixed-size slicing:
 * In fixed-size chunking, inserting 10 bytes at the beginning of a 5 MB file shifts every
 * subsequent byte offset, invalidating 100% of chunk SHA-256 hashes (the "boundary-shift problem").
 * Gear rolling-hash CDC finds data-dependent cut points where `(fingerprint & mask) === 0`,
 * immediately re-synchronizing chunk boundaries after an insertion or deletion and achieving
 * >80% sub-file deduplication across document revisions.
 */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface CdcChunkDescriptor {
  chunkSha256: string;
  byteOffset: number;
  byteLength: number;
  data: Buffer;
}

export interface CdcDeduplicationReport {
  manifestId: string;
  ownerId: string;
  totalBytes: number;
  totalChunks: number;
  newChunksStored: number;
  reusedChunksCount: number;
  bytesSavedByDedup: number;
  deduplicationRatioPercent: number;
  manifestSha256: string;
}

// Deterministic 256-entry 32-bit Gear table generated via Mulberry32 PRNG
const GEAR_TABLE = new Uint32Array(256);
{
  let seed = 0x9e3779b9;
  for (let i = 0; i < 256; i++) {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    GEAR_TABLE[i] = (t ^ (t >>> 14)) >>> 0;
  }
}

export interface CdcChunkerOptions {
  minChunkBytes?: number; // Default 512
  avgChunkBytes?: number; // Default 1024 (power of 2)
  maxChunkBytes?: number; // Default 4096
}

/**
 * Splits a Buffer into variable-size Content-Defined Chunks using a 32-byte sliding Gear rolling hash.
 * Warm-up of 32 bytes prior to `offset + minSize` ensures that the rolling hash state depends
 * strictly on the local 32-byte window, guaranteeing immediate boundary re-synchronization.
 */
export function splitBufferContentDefined(
  input: Buffer | string,
  options?: CdcChunkerOptions
): CdcChunkDescriptor[] {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  const minSize = Math.max(64, options?.minChunkBytes ?? 512);
  const avgSize = Math.max(minSize * 2, options?.avgChunkBytes ?? 1024);
  const maxSize = Math.max(avgSize * 2, options?.maxChunkBytes ?? 4096);

  const bits = Math.max(5, Math.min(16, Math.round(Math.log2(avgSize))));
  // Place mask in the upper bits of the 32-bit Gear word so all 32 window bytes contribute
  const mask = (((1 << bits) - 1) << (30 - bits)) >>> 0;

  const chunks: CdcChunkDescriptor[] = [];
  let offset = 0;
  const totalLen = buf.length;

  while (offset < totalLen) {
    const remaining = totalLen - offset;
    if (remaining <= minSize) {
      const slice = buf.subarray(offset, totalLen);
      chunks.push({
        chunkSha256: createHash("sha256").update(slice).digest("hex"),
        byteOffset: offset,
        byteLength: slice.length,
        data: slice
      });
      break;
    }

    const limit = Math.min(totalLen, offset + maxSize);
    const warmupStart = Math.max(offset, offset + minSize - 32);
    let fp = 0;

    for (let w = warmupStart; w < offset + minSize; w++) {
      fp = ((fp << 1) + GEAR_TABLE[buf[w]]) >>> 0;
    }

    let cursor = offset + minSize;
    while (cursor < limit) {
      fp = ((fp << 1) + GEAR_TABLE[buf[cursor]]) >>> 0;
      if ((fp & mask) === 0) {
        cursor++; // Include boundary byte
        break;
      }
      cursor++;
    }

    const slice = buf.subarray(offset, cursor);
    chunks.push({
      chunkSha256: createHash("sha256").update(slice).digest("hex"),
      byteOffset: offset,
      byteLength: slice.length,
      data: slice
    });
    offset = cursor;
  }

  return chunks;
}

export class CdcChunkingDeduplicator {
  constructor(private readonly sqlite: DatabaseSync) {
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_cdc_chunk_store (
        owner_id TEXT NOT NULL,
        chunk_sha256 TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        chunk_base64 TEXT NOT NULL,
        ref_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, chunk_sha256)
      );
      CREATE TABLE IF NOT EXISTS kosmora_cdc_manifests (
        manifest_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        total_bytes INTEGER NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        chunk_hashes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, manifest_id)
      );
    `);
  }

  /**
   * Ingests a document/snapshot buffer into the content-addressable CDC chunk store,
   * storing only novel chunks and reusing existing identical sub-file blocks.
   */
  public ingestBuffer(options: {
    ownerId: string;
    manifestId: string;
    payload: Buffer | string;
    chunkerOptions?: CdcChunkerOptions;
  }): CdcDeduplicationReport {
    const buf = Buffer.isBuffer(options.payload)
      ? options.payload
      : Buffer.from(String(options.payload), "utf8");
    const manifestSha256 = createHash("sha256").update(buf).digest("hex");
    const chunks = splitBufferContentDefined(buf, options.chunkerOptions);
    const now = new Date().toISOString();

    let newChunksStored = 0;
    let reusedChunksCount = 0;
    let bytesSavedByDedup = 0;
    const chunkHashes: string[] = [];

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const ch of chunks) {
        chunkHashes.push(ch.chunkSha256);

        const existing = this.sqlite
          .prepare(
            "SELECT byte_length, ref_count FROM kosmora_cdc_chunk_store WHERE owner_id = ? AND chunk_sha256 = ?"
          )
          .get(options.ownerId, ch.chunkSha256) as
          | { byte_length: number; ref_count: number }
          | undefined;

        if (existing) {
          reusedChunksCount += 1;
          bytesSavedByDedup += ch.byteLength;
          this.sqlite
            .prepare(
              "UPDATE kosmora_cdc_chunk_store SET ref_count = ref_count + 1 WHERE owner_id = ? AND chunk_sha256 = ?"
            )
            .run(options.ownerId, ch.chunkSha256);
        } else {
          newChunksStored += 1;
          this.sqlite
            .prepare(
              `INSERT INTO kosmora_cdc_chunk_store (
                owner_id, chunk_sha256, byte_length, chunk_base64, ref_count, created_at
              ) VALUES (?, ?, ?, ?, 1, ?)`
            )
            .run(
              options.ownerId,
              ch.chunkSha256,
              ch.byteLength,
              ch.data.toString("base64"),
              now
            );
        }
      }

      this.sqlite
        .prepare(
          `INSERT INTO kosmora_cdc_manifests (
            manifest_id, owner_id, total_bytes, manifest_sha256, chunk_hashes_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(owner_id, manifest_id) DO UPDATE SET
            total_bytes = excluded.total_bytes,
            manifest_sha256 = excluded.manifest_sha256,
            chunk_hashes_json = excluded.chunk_hashes_json,
            created_at = excluded.created_at`
        )
        .run(
          options.manifestId,
          options.ownerId,
          buf.length,
          manifestSha256,
          JSON.stringify(chunkHashes),
          now
        );

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }

    const dedupRatio =
      buf.length > 0 ? Number(((bytesSavedByDedup / buf.length) * 100).toFixed(2)) : 0;

    return {
      manifestId: options.manifestId,
      ownerId: options.ownerId,
      totalBytes: buf.length,
      totalChunks: chunks.length,
      newChunksStored,
      reusedChunksCount,
      bytesSavedByDedup,
      deduplicationRatioPercent: dedupRatio,
      manifestSha256
    };
  }

  /**
   * Reconstructs the exact byte-for-byte original Buffer from a CDC manifest and verifies SHA-256.
   */
  public assembleManifestBuffer(ownerId: string, manifestId: string): Buffer {
    const manifestRow = this.sqlite
      .prepare(
        "SELECT total_bytes, manifest_sha256, chunk_hashes_json FROM kosmora_cdc_manifests WHERE owner_id = ? AND manifest_id = ?"
      )
      .get(ownerId, manifestId) as
      | { total_bytes: number; manifest_sha256: string; chunk_hashes_json: string }
      | undefined;

    if (!manifestRow) {
      throw new Error(`CDC_MANIFEST_NOT_FOUND: Manifest '${manifestId}' not found`);
    }

    const hashes = JSON.parse(manifestRow.chunk_hashes_json) as string[];
    const parts: Buffer[] = [];

    for (const h of hashes) {
      const chunkRow = this.sqlite
        .prepare(
          "SELECT chunk_base64 FROM kosmora_cdc_chunk_store WHERE owner_id = ? AND chunk_sha256 = ?"
        )
        .get(ownerId, h) as { chunk_base64: string } | undefined;

      if (!chunkRow) {
        throw new Error(`CDC_CHUNK_MISSING: Missing chunk ${h} for manifest '${manifestId}'`);
      }
      parts.push(Buffer.from(chunkRow.chunk_base64, "base64"));
    }

    const assembled = Buffer.concat(parts);
    const actualSha = createHash("sha256").update(assembled).digest("hex");
    if (actualSha !== manifestRow.manifest_sha256) {
      throw new Error("CDC_INTEGRITY_MISMATCH: Assembled buffer SHA-256 does not match manifest");
    }

    return assembled;
  }
}
