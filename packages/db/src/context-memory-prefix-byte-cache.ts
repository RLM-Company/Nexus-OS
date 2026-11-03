export interface PackableMemoryEntry {
  id: string;
  ownerId: string;
  version: number;
  scope: "personal" | "chat" | "project";
  kind: "fact" | "preference" | "decision" | "constraint" | "hypothesis";
  title: string;
  content: string;
  pinned: boolean;
  source: Record<string, unknown>;
  updatedAt: string;
}

export interface LinearPackResult {
  packedEntries: PackableMemoryEntry[];
  totalUtf8Bytes: number;
  omittedCount: number;
  mandatoryOmittedCount: number;
  cacheHits: number;
  cacheMisses: number;
}

export class MandatoryPrefixBudgetError extends Error {
  readonly code = "MANDATORY_PREFIX_BUDGET_EXCEEDED";
  constructor(
    public readonly requiredBytes: number,
    public readonly maxBudgetBytes: number
  ) {
    super(
      `MANDATORY_PREFIX_BUDGET_EXCEEDED: Mandatory pinned memory prefix requires ${requiredBytes} UTF-8 bytes, exceeding budget of ${maxBudgetBytes} bytes.`
    );
  }
}

interface CacheBucketEntry {
  version: number;
  serializedJson: string;
  utf8Bytes: number;
}

/**
 * Owner-Isolated, Version-Invalidated O(N) Incremental Context Memory Prefix Packer & Cache
 * (closes the cross-request/owner caching item in PR #427 `KOSMORA_MEMORY_PACKING_2026-11-02_RU.md`).
 *
 * Guarantees:
 * 1. Strictly owner-isolated Map buckets (`Map<ownerId, Map<entryId, CacheBucketEntry>>`) so no
 *    byte measurement or serialized representation is ever shared across owners.
 * 2. Automatic version invalidation when `entry.version` increments, plus bounded LRU eviction
 *    (`maxEntriesPerOwner = 512`).
 * 3. Single-pass `O(N)` linear UTF-8 byte accounting (`{"entries":[...]}` envelope + `,` separators).
 * 4. Throws `MandatoryPrefixBudgetError` (`MANDATORY_PREFIX_BUDGET_EXCEEDED`) when mandatory/pinned
 *    entries exceed `maxBudgetBytes` on an empty or fresh turn instead of silently overflowing.
 */
export class ContextMemoryPrefixByteCache {
  private readonly ownerBuckets = new Map<string, Map<string, CacheBucketEntry>>();
  private readonly maxEntriesPerOwner: number;

  constructor(options?: { maxEntriesPerOwner?: number }) {
    this.maxEntriesPerOwner = Math.max(options?.maxEntriesPerOwner ?? 512, 16);
  }

  private getOrCreateOwnerBucket(ownerId: string): Map<string, CacheBucketEntry> {
    let bucket = this.ownerBuckets.get(ownerId);
    if (!bucket) {
      bucket = new Map();
      this.ownerBuckets.set(ownerId, bucket);
    }
    return bucket;
  }

  measureEntryOnce(entry: PackableMemoryEntry): {
    serializedJson: string;
    utf8Bytes: number;
    fromCache: boolean;
  } {
    const bucket = this.getOrCreateOwnerBucket(entry.ownerId);
    const cached = bucket.get(entry.id);
    if (cached && cached.version === entry.version) {
      // Refresh LRU order
      bucket.delete(entry.id);
      bucket.set(entry.id, cached);
      return {
        serializedJson: cached.serializedJson,
        utf8Bytes: cached.utf8Bytes,
        fromCache: true
      };
    }

    const wireObject = {
      id: entry.id,
      scope: entry.scope,
      kind: entry.kind,
      title: entry.title,
      content: entry.content,
      pinned: entry.pinned,
      source: entry.source
    };
    const serializedJson = JSON.stringify(wireObject);
    const utf8Bytes = Buffer.byteLength(serializedJson, "utf8");

    if (bucket.size >= this.maxEntriesPerOwner) {
      const oldestKey = bucket.keys().next().value;
      if (oldestKey !== undefined) {
        bucket.delete(oldestKey);
      }
    }

    bucket.set(entry.id, {
      version: entry.version,
      serializedJson,
      utf8Bytes
    });

    return {
      serializedJson,
      utf8Bytes,
      fromCache: false
    };
  }

  invalidateOwnerCache(ownerId: string): void {
    this.ownerBuckets.delete(ownerId);
  }

  /**
   * Packs candidate entries in O(N) time with mandatory-first ordering, deduplication,
   * exact UTF-8 byte tracking, and strict mandatory prefix budget enforcement.
   */
  packLinearWithPrefixBudget(options: {
    ownerId: string;
    entries: PackableMemoryEntry[];
    maxItems?: number;
    maxBudgetBytes?: number;
    strictMandatoryPrefix?: boolean;
  }): LinearPackResult {
    const maxItems = Math.min(Math.max(options.maxItems ?? 32, 1), 32);
    const maxBudgetBytes = Math.min(Math.max(options.maxBudgetBytes ?? 6000, 128), 12000);
    const strictMandatoryPrefix = options.strictMandatoryPrefix ?? true;

    // Deduplicate by id while preserving mandatory-first (pinned or constraint) stable order
    const seenIds = new Set<string>();
    const mandatoryList: PackableMemoryEntry[] = [];
    const optionalList: PackableMemoryEntry[] = [];

    for (const e of options.entries) {
      if (e.ownerId !== options.ownerId) {
        throw new Error("CROSS_OWNER_MEMORY_PACK_REJECTED");
      }
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      if (e.pinned || e.kind === "constraint") {
        mandatoryList.push(e);
      } else {
        optionalList.push(e);
      }
    }

    const ordered = [...mandatoryList, ...optionalList];
    const ENVELOPE_OVERHEAD_BYTES = Buffer.byteLength('{"entries":[]}', "utf8"); // 14 bytes

    let currentBytes = ENVELOPE_OVERHEAD_BYTES;
    let mandatoryRequiredBytes = ENVELOPE_OVERHEAD_BYTES;
    let cacheHits = 0;
    let cacheMisses = 0;
    let omittedCount = 0;
    let mandatoryOmittedCount = 0;
    const packedEntries: PackableMemoryEntry[] = [];

    for (const entry of ordered) {
      const measured = this.measureEntryOnce(entry);
      if (measured.fromCache) cacheHits++;
      else cacheMisses++;

      const isMandatory = entry.pinned || entry.kind === "constraint";
      const separatorBytes = packedEntries.length > 0 ? 1 : 0; // ','
      const candidateCost = measured.utf8Bytes + separatorBytes;

      if (isMandatory) {
        const mandatorySep = mandatoryRequiredBytes > ENVELOPE_OVERHEAD_BYTES ? 1 : 0;
        mandatoryRequiredBytes += measured.utf8Bytes + mandatorySep;
      }

      if (
        packedEntries.length >= maxItems ||
        currentBytes + candidateCost > maxBudgetBytes
      ) {
        omittedCount++;
        if (isMandatory) {
          mandatoryOmittedCount++;
        }
        continue;
      }

      packedEntries.push(entry);
      currentBytes += candidateCost;
    }

    if (strictMandatoryPrefix && mandatoryOmittedCount > 0) {
      throw new MandatoryPrefixBudgetError(mandatoryRequiredBytes, maxBudgetBytes);
    }

    return {
      packedEntries,
      totalUtf8Bytes: currentBytes,
      omittedCount,
      mandatoryOmittedCount,
      cacheHits,
      cacheMisses
    };
  }
}
