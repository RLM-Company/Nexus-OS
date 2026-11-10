import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

function hash64Pair(item: string): [number, number] {
  const digest = createHash("sha256").update(item, "utf8").digest();
  return [digest.readUInt32LE(0) >>> 0, digest.readUInt32LE(4) >>> 0];
}

function countLeadingZeros32(x: number): number {
  return Math.clz32(x >>> 0);
}

/**
 * Sub-Linear HyperLogLog (HLL, m=256 registers = 256 bytes RAM) Cardinality Estimator
 * + 4-Row Count-Min Sketch (CMS) Heavy-Hitter Frequency Estimator with SQLite persistence.
 */
export class HyperLogLogAndCountMinSketch {
  public readonly hllBitsP = 8;
  public readonly hllRegistersCount = 256; // 2^8
  private readonly hllRegisters: Uint8Array;
  public readonly cmsDepth = 4;
  public readonly cmsWidth = 256;
  private readonly cmsMatrix: Uint32Array[];

  constructor(options?: {
    hllRegisters?: Uint8Array;
    cmsMatrix?: Uint32Array[];
  }) {
    this.hllRegisters = options?.hllRegisters
      ? new Uint8Array(options.hllRegisters)
      : new Uint8Array(this.hllRegistersCount);

    this.cmsMatrix = options?.cmsMatrix
      ? options.cmsMatrix.map((row) => new Uint32Array(row))
      : Array.from({ length: this.cmsDepth }, () => new Uint32Array(this.cmsWidth));
  }

  public observe(item: string, count = 1): void {
    const [h1, h2] = hash64Pair(item);

    // 1. HyperLogLog update: low 8 bits select register idx [0..255], remaining bits give rho (position of first 1-bit)
    const regIdx = h1 & 0xff;
    const remainingBits = (h1 >>> 8) | (h2 << 24);
    const rho = Math.min(32, countLeadingZeros32(remainingBits) + 1);
    if (rho > this.hllRegisters[regIdx]!) {
      this.hllRegisters[regIdx] = rho;
    }

    // 2. Count-Min Sketch update across 4 independent hash rows
    const inc = Math.max(1, Math.floor(count));
    for (let d = 0; d < this.cmsDepth; d++) {
      const col = ((h1 + Math.imul(d + 1, h2)) >>> 0) & (this.cmsWidth - 1);
      this.cmsMatrix[d]![col] = (this.cmsMatrix[d]![col]! + inc) >>> 0;
    }
  }

  /**
   * Estimates distinct item cardinality using HyperLogLog harmonic mean with
   * small-range LinearCounting correction.
   */
  public estimateDistinctCardinality(): number {
    const m = this.hllRegistersCount;
    const alphaM = 0.7213 / (1 + 1.079 / m);

    let sumInvPow2 = 0;
    let zeroRegisters = 0;
    for (let i = 0; i < m; i++) {
      const val = this.hllRegisters[i]!;
      sumInvPow2 += Math.pow(2, -val);
      if (val === 0) zeroRegisters++;
    }

    let estimate = (alphaM * m * m) / sumInvPow2;

    // Small-range LinearCounting correction when estimate <= 2.5 * m and zeroRegisters > 0
    if (estimate <= 2.5 * m && zeroRegisters > 0) {
      estimate = m * Math.log(m / zeroRegisters);
    }

    return Math.round(estimate);
  }

  /**
   * Returns the Count-Min Sketch point frequency estimate: min_{d} CMS[d][h_d(item)].
   */
  public estimateItemFrequency(item: string): number {
    const [h1, h2] = hash64Pair(item);
    let minCount = Infinity;
    for (let d = 0; d < this.cmsDepth; d++) {
      const col = ((h1 + Math.imul(d + 1, h2)) >>> 0) & (this.cmsWidth - 1);
      const val = this.cmsMatrix[d]![col]!;
      if (val < minCount) minCount = val;
    }
    return minCount === Infinity ? 0 : minCount;
  }

  public saveToSqlite(sqlite: DatabaseSync, ownerId: string, namespace = "default"): string {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_stream_sketch_snapshots (
        sketch_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        hll_registers_base64 TEXT NOT NULL,
        cms_matrix_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, namespace)
      );
    `);

    const sketchId = `sketch_${ownerId}_${namespace}`;
    const hllBase64 = Buffer.from(this.hllRegisters).toString("base64");
    const cmsJson = JSON.stringify(this.cmsMatrix.map((r) => Array.from(r)));

    sqlite
      .prepare(
        `INSERT INTO kosmora_stream_sketch_snapshots
          (sketch_id, owner_id, namespace, hll_registers_base64, cms_matrix_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, namespace) DO UPDATE SET
          hll_registers_base64 = excluded.hll_registers_base64,
          cms_matrix_json = excluded.cms_matrix_json,
          updated_at = excluded.updated_at`
      )
      .run(sketchId, ownerId, namespace, hllBase64, cmsJson, new Date().toISOString());

    return sketchId;
  }

  public static loadFromSqlite(
    sqlite: DatabaseSync,
    ownerId: string,
    namespace = "default"
  ): HyperLogLogAndCountMinSketch | null {
    const row = sqlite
      .prepare(
        `SELECT hll_registers_base64, cms_matrix_json
         FROM kosmora_stream_sketch_snapshots
         WHERE owner_id = ? AND namespace = ?`
      )
      .get(ownerId, namespace) as
      | { hll_registers_base64: string; cms_matrix_json: string }
      | undefined;

    if (!row) return null;

    const hllRegisters = new Uint8Array(Buffer.from(row.hll_registers_base64, "base64"));
    const parsedMatrix = JSON.parse(row.cms_matrix_json) as number[][];
    const cmsMatrix = parsedMatrix.map((r) => new Uint32Array(r));

    return new HyperLogLogAndCountMinSketch({ hllRegisters, cmsMatrix });
  }
}
