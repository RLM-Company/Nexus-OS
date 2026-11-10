import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

function hashPair64(input: string): [number, number] {
  const digest = createHash("sha256").update(input, "utf8").digest();
  const h1 = digest.readUInt32LE(0);
  const h2 = digest.readUInt32LE(4) || 0x9e3779b9;
  return [h1 >>> 0, h2 >>> 0];
}

/**
 * Optimal Double-Hashed Partitioned Bloom Filter with configurable capacity and false-positive rate.
 */
export class PartitionedBloomFilter {
  public readonly bitCount: number;
  public readonly hashCount: number;
  private readonly words: Uint32Array;
  private insertedCount = 0;

  constructor(options?: {
    expectedItems?: number;
    falsePositiveRate?: number;
    bitCount?: number;
    hashCount?: number;
    words?: Uint32Array;
    insertedCount?: number;
  }) {
    if (options?.bitCount && options?.hashCount && options?.words) {
      this.bitCount = options.bitCount;
      this.hashCount = options.hashCount;
      this.words = new Uint32Array(options.words);
      this.insertedCount = options.insertedCount ?? 0;
      return;
    }

    const n = Math.max(16, options?.expectedItems ?? 1024);
    const p = Math.min(0.25, Math.max(1e-6, options?.falsePositiveRate ?? 0.01));
    const rawBits = Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2));
    // Round up to multiple of 32
    this.bitCount = Math.ceil(rawBits / 32) * 32;
    this.hashCount = Math.max(1, Math.min(16, Math.round((this.bitCount / n) * Math.LN2)));
    this.words = new Uint32Array(this.bitCount / 32);
  }

  public add(item: string): void {
    const [h1, h2] = hashPair64(item);
    for (let i = 0; i < this.hashCount; i++) {
      const combined = (h1 + Math.imul(i, h2)) >>> 0;
      const bitIndex = combined % this.bitCount;
      const wordIdx = bitIndex >>> 5;
      const bitMask = 1 << (bitIndex & 31);
      this.words[wordIdx] = (this.words[wordIdx]! | bitMask) >>> 0;
    }
    this.insertedCount++;
  }

  public mightContain(item: string): boolean {
    const [h1, h2] = hashPair64(item);
    for (let i = 0; i < this.hashCount; i++) {
      const combined = (h1 + Math.imul(i, h2)) >>> 0;
      const bitIndex = combined % this.bitCount;
      const wordIdx = bitIndex >>> 5;
      const bitMask = 1 << (bitIndex & 31);
      if ((this.words[wordIdx]! & bitMask) === 0) {
        return false;
      }
    }
    return true;
  }

  public get count(): number {
    return this.insertedCount;
  }

  public estimateFalsePositiveRate(): number {
    const expTerm = Math.exp((-this.hashCount * this.insertedCount) / this.bitCount);
    return Math.pow(1 - expTerm, this.hashCount);
  }

  public serialize(): {
    bitCount: number;
    hashCount: number;
    insertedCount: number;
    wordsBase64: string;
  } {
    const buf = Buffer.from(this.words.buffer, this.words.byteOffset, this.words.byteLength);
    return {
      bitCount: this.bitCount,
      hashCount: this.hashCount,
      insertedCount: this.insertedCount,
      wordsBase64: buf.toString("base64")
    };
  }

  public static deserialize(data: {
    bitCount: number;
    hashCount: number;
    insertedCount: number;
    wordsBase64: string;
  }): PartitionedBloomFilter {
    const buf = Buffer.from(data.wordsBase64, "base64");
    const words = new Uint32Array(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
    return new PartitionedBloomFilter({
      bitCount: data.bitCount,
      hashCount: data.hashCount,
      words,
      insertedCount: data.insertedCount
    });
  }
}

/**
 * Dynamic Cuckoo Filter supporting O(1) lookups, high load factor, and exact O(1) deletions
 * via partial-key cuckoo hashing (b = 4 slots per bucket, 16-bit non-zero fingerprints).
 */
export class CuckooFilterIndex {
  public readonly bucketCount: number;
  public readonly bucketSize = 4;
  private readonly maxKicks = 128;
  private readonly buckets: Uint16Array;
  private itemCount = 0;

  constructor(options?: {
    capacity?: number;
    bucketCount?: number;
    buckets?: Uint16Array;
    itemCount?: number;
  }) {
    if (options?.bucketCount && options?.buckets) {
      this.bucketCount = options.bucketCount;
      this.buckets = new Uint16Array(options.buckets);
      this.itemCount = options.itemCount ?? 0;
      return;
    }

    const desiredCapacity = Math.max(16, options?.capacity ?? 1024);
    // Power-of-two bucket count for clean XOR alternate index invariance: (i1 ^ hash(fp)) % bucketCount
    let pow2 = 8;
    while (pow2 * this.bucketSize < desiredCapacity * 1.25) {
      pow2 <<= 1;
    }
    this.bucketCount = pow2;
    this.buckets = new Uint16Array(this.bucketCount * this.bucketSize);
  }

  private fingerprint16(h2: number): number {
    const fp = h2 & 0xffff;
    return fp === 0 ? 1 : fp; // 0 is reserved for empty slot
  }

  private hashFingerprint(fp: number): number {
    // MurmurHash3 32-bit finalizer mix on 16-bit fingerprint
    let h = fp >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }

  private altIndex(index: number, fp: number): number {
    const mask = this.bucketCount - 1;
    // Ensure non-zero offset so altIndex != index when desirable, while preserving involution: alt(alt(i, fp), fp) == i
    const fpHash = (this.hashFingerprint(fp) & mask) || 1;
    return (index ^ fpHash) & mask;
  }

  private computeLocations(item: string): { i1: number; i2: number; fp: number } {
    const [h1, h2] = hashPair64(item);
    const fp = this.fingerprint16(h2);
    const i1 = h1 & (this.bucketCount - 1);
    const i2 = this.altIndex(i1, fp);
    return { i1, i2, fp };
  }

  public insert(item: string): boolean {
    const { i1, i2, fp } = this.computeLocations(item);

    if (this.insertIntoBucket(i1, fp) || this.insertIntoBucket(i2, fp)) {
      this.itemCount++;
      return true;
    }

    // Relocation loop (deterministic kick selection using item hash)
    let curIndex = (fp & 1) === 0 ? i1 : i2;
    let curFp = fp;

    for (let kick = 0; kick < this.maxKicks; kick++) {
      const slotOffset = kick & (this.bucketSize - 1);
      const pos = curIndex * this.bucketSize + slotOffset;
      const evictedFp = this.buckets[pos]!;
      this.buckets[pos] = curFp;
      curFp = evictedFp;
      curIndex = this.altIndex(curIndex, curFp);

      if (this.insertIntoBucket(curIndex, curFp)) {
        this.itemCount++;
        return true;
      }
    }

    return false; // Filter full
  }

  public lookup(item: string): boolean {
    const { i1, i2, fp } = this.computeLocations(item);
    return this.bucketContains(i1, fp) || this.bucketContains(i2, fp);
  }

  /**
   * Deletes one instance of `item` from the Cuckoo filter in O(1) time.
   */
  public delete(item: string): boolean {
    const { i1, i2, fp } = this.computeLocations(item);
    if (this.removeFromBucket(i1, fp) || this.removeFromBucket(i2, fp)) {
      this.itemCount = Math.max(0, this.itemCount - 1);
      return true;
    }
    return false;
  }

  public get count(): number {
    return this.itemCount;
  }

  public get loadFactor(): number {
    return this.itemCount / (this.bucketCount * this.bucketSize);
  }

  private insertIntoBucket(bucketIdx: number, fp: number): boolean {
    const base = bucketIdx * this.bucketSize;
    for (let s = 0; s < this.bucketSize; s++) {
      if (this.buckets[base + s] === 0) {
        this.buckets[base + s] = fp;
        return true;
      }
    }
    return false;
  }

  private bucketContains(bucketIdx: number, fp: number): boolean {
    const base = bucketIdx * this.bucketSize;
    for (let s = 0; s < this.bucketSize; s++) {
      if (this.buckets[base + s] === fp) {
        return true;
      }
    }
    return false;
  }

  private removeFromBucket(bucketIdx: number, fp: number): boolean {
    const base = bucketIdx * this.bucketSize;
    for (let s = 0; s < this.bucketSize; s++) {
      if (this.buckets[base + s] === fp) {
        this.buckets[base + s] = 0;
        return true;
      }
    }
    return false;
  }

  public serialize(): {
    bucketCount: number;
    itemCount: number;
    bucketsBase64: string;
  } {
    const buf = Buffer.from(
      this.buckets.buffer,
      this.buckets.byteOffset,
      this.buckets.byteLength
    );
    return {
      bucketCount: this.bucketCount,
      itemCount: this.itemCount,
      bucketsBase64: buf.toString("base64")
    };
  }

  public static deserialize(data: {
    bucketCount: number;
    itemCount: number;
    bucketsBase64: string;
  }): CuckooFilterIndex {
    const buf = Buffer.from(data.bucketsBase64, "base64");
    const buckets = new Uint16Array(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
    return new CuckooFilterIndex({
      bucketCount: data.bucketCount,
      buckets,
      itemCount: data.itemCount
    });
  }

  public saveToSqlite(sqlite: DatabaseSync, ownerId: string, namespace = "default"): string {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_probabilistic_filter_snapshots (
        snapshot_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        filter_type TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, namespace, filter_type)
      );
    `);

    const snapshotId = `cuckoo_${ownerId}_${namespace}`;
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO kosmora_probabilistic_filter_snapshots
          (snapshot_id, owner_id, namespace, filter_type, item_count, payload_json, updated_at)
         VALUES (?, ?, ?, 'cuckoo', ?, ?, ?)
         ON CONFLICT(owner_id, namespace, filter_type) DO UPDATE SET
          item_count = excluded.item_count,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at`
      )
      .run(snapshotId, ownerId, namespace, this.itemCount, JSON.stringify(this.serialize()), now);

    return snapshotId;
  }

  public static loadFromSqlite(
    sqlite: DatabaseSync,
    ownerId: string,
    namespace = "default"
  ): CuckooFilterIndex | null {
    const row = sqlite
      .prepare(
        `SELECT payload_json FROM kosmora_probabilistic_filter_snapshots
         WHERE owner_id = ? AND namespace = ? AND filter_type = 'cuckoo'`
      )
      .get(ownerId, namespace) as { payload_json: string } | undefined;

    if (!row) return null;
    return CuckooFilterIndex.deserialize(JSON.parse(row.payload_json));
  }
}
