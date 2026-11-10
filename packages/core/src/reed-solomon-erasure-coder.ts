import { LinUcbContextualBandit } from "./linucb-contextual-bandit.ts";

/**
 * Galois Field GF(2^8) Reed-Solomon Erasure Coding Engine (irreducible polynomial x^8 + x^4 + x^3 + x + 1 = 0x11d).
 * Encodes k data shards into (k + m) shards using a systematic Vandermonde matrix over GF(2^8)
 * and reconstructs all k original shards from any k surviving shards via GF(2^8) Gauss-Jordan inversion.
 */
export class ReedSolomonGaloisErasureCoder {
  private static readonly EXP_TABLE = new Uint8Array(512);
  private static readonly LOG_TABLE = new Uint8Array(256);
  private static tablesInitialized = false;

  public readonly dataShardCountK: number;
  public readonly parityShardCountM: number;
  public readonly totalShardCountN: number;
  private readonly codingMatrix: number[][];

  private static initGaloisTables(): void {
    if (ReedSolomonGaloisErasureCoder.tablesInitialized) return;
    let x = 1;
    for (let i = 0; i < 255; i++) {
      ReedSolomonGaloisErasureCoder.EXP_TABLE[i] = x;
      ReedSolomonGaloisErasureCoder.EXP_TABLE[i + 255] = x;
      ReedSolomonGaloisErasureCoder.LOG_TABLE[x] = i;
      x <<= 1;
      if ((x & 0x100) !== 0) {
        x ^= 0x11d;
      }
    }
    ReedSolomonGaloisErasureCoder.LOG_TABLE[0] = 0;
    ReedSolomonGaloisErasureCoder.tablesInitialized = true;
  }

  public static gfAdd(a: number, b: number): number {
    return (a ^ b) & 0xff;
  }

  public static gfMul(a: number, b: number): number {
    ReedSolomonGaloisErasureCoder.initGaloisTables();
    if (a === 0 || b === 0) return 0;
    const logA = ReedSolomonGaloisErasureCoder.LOG_TABLE[a & 0xff]!;
    const logB = ReedSolomonGaloisErasureCoder.LOG_TABLE[b & 0xff]!;
    return ReedSolomonGaloisErasureCoder.EXP_TABLE[logA + logB]!;
  }

  public static gfDiv(a: number, b: number): number {
    ReedSolomonGaloisErasureCoder.initGaloisTables();
    if (b === 0) throw new Error("GF256_DIVIDE_BY_ZERO");
    if (a === 0) return 0;
    const logA = ReedSolomonGaloisErasureCoder.LOG_TABLE[a & 0xff]!;
    const logB = ReedSolomonGaloisErasureCoder.LOG_TABLE[b & 0xff]!;
    return ReedSolomonGaloisErasureCoder.EXP_TABLE[logA + 255 - logB]!;
  }

  public static gfPow(a: number, n: number): number {
    ReedSolomonGaloisErasureCoder.initGaloisTables();
    if (n === 0) return 1;
    if (a === 0) return 0;
    const logA = ReedSolomonGaloisErasureCoder.LOG_TABLE[a & 0xff]!;
    return ReedSolomonGaloisErasureCoder.EXP_TABLE[(logA * n) % 255]!;
  }

  public static gfInvertMatrix(matrix: number[][]): number[][] {
    ReedSolomonGaloisErasureCoder.initGaloisTables();
    const n = matrix.length;
    const aug = matrix.map((row, i) => [
      ...row,
      ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
    ]);

    for (let col = 0; col < n; col++) {
      let pivotRow = col;
      while (pivotRow < n && aug[pivotRow]![col] === 0) {
        pivotRow++;
      }
      if (pivotRow === n) {
        throw new Error("GF256_SINGULAR_MATRIX");
      }
      if (pivotRow !== col) {
        const tmp = aug[col]!;
        aug[col] = aug[pivotRow]!;
        aug[pivotRow] = tmp;
      }

      const pivotVal = aug[col]![col]!;
      const invPivot = ReedSolomonGaloisErasureCoder.gfDiv(1, pivotVal);
      for (let j = 0; j < 2 * n; j++) {
        aug[col]![j] = ReedSolomonGaloisErasureCoder.gfMul(aug[col]![j]!, invPivot);
      }

      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = aug[r]![col]!;
        if (factor === 0) continue;
        for (let j = 0; j < 2 * n; j++) {
          aug[r]![j] = ReedSolomonGaloisErasureCoder.gfAdd(
            aug[r]![j]!,
            ReedSolomonGaloisErasureCoder.gfMul(factor, aug[col]![j]!)
          );
        }
      }
    }

    return aug.map((row) => row.slice(n, 2 * n));
  }

  constructor(dataShardCountK = 4, parityShardCountM = 2) {
    ReedSolomonGaloisErasureCoder.initGaloisTables();
    this.dataShardCountK = Math.max(1, dataShardCountK);
    this.parityShardCountM = Math.max(1, parityShardCountM);
    this.totalShardCountN = this.dataShardCountK + this.parityShardCountM;

    // Build systematic coding matrix: top KxK is Identity, bottom MxK is Cauchy/Vandermonde
    this.codingMatrix = [];
    for (let r = 0; r < this.dataShardCountK; r++) {
      this.codingMatrix.push(
        Array.from({ length: this.dataShardCountK }, (_, c) => (r === c ? 1 : 0))
      );
    }
    // Cauchy parity rows: 1 / (x_r XOR y_c) over GF(2^8), guaranteed MDS (every submatrix invertible)
    for (let p = 0; p < this.parityShardCountM; p++) {
      const x = this.dataShardCountK + p + 1;
      const row: number[] = [];
      for (let c = 0; c < this.dataShardCountK; c++) {
        const y = c + 1;
        row.push(ReedSolomonGaloisErasureCoder.gfDiv(1, x ^ y));
      }
      this.codingMatrix.push(row);
    }
    void LinUcbContextualBandit;
  }

  public encodePayload(payload: Uint8Array): {
    shards: Uint8Array[];
    shardByteLength: number;
    originalByteLength: number;
  } {
    const k = this.dataShardCountK;
    const shardByteLength = Math.max(1, Math.ceil(payload.length / k));
    const padded = new Uint8Array(shardByteLength * k);
    padded.set(payload, 0);

    const shards: Uint8Array[] = [];
    for (let i = 0; i < k; i++) {
      shards.push(padded.slice(i * shardByteLength, (i + 1) * shardByteLength));
    }

    for (let p = 0; p < this.parityShardCountM; p++) {
      const parityRow = this.codingMatrix[k + p]!;
      const parityShard = new Uint8Array(shardByteLength);
      for (let byteIdx = 0; byteIdx < shardByteLength; byteIdx++) {
        let acc = 0;
        for (let c = 0; c < k; c++) {
          acc = ReedSolomonGaloisErasureCoder.gfAdd(
            acc,
            ReedSolomonGaloisErasureCoder.gfMul(parityRow[c]!, shards[c]![byteIdx]!)
          );
        }
        parityShard[byteIdx] = acc;
      }
      shards.push(parityShard);
    }

    return {
      shards,
      shardByteLength,
      originalByteLength: payload.length
    };
  }

  public reconstructPayload(
    maybeShards: Array<Uint8Array | null>,
    originalByteLength: number
  ): Uint8Array {
    const k = this.dataShardCountK;
    const survivingIndices: number[] = [];
    for (let i = 0; i < maybeShards.length && survivingIndices.length < k; i++) {
      if (maybeShards[i] !== null && maybeShards[i] !== undefined) {
        survivingIndices.push(i);
      }
    }

    if (survivingIndices.length < k) {
      throw new Error(
        `REED_SOLOMON_TOO_MANY_ERASURES: need ${k} shards, only ${survivingIndices.length} survived`
      );
    }

    const subMatrix = survivingIndices.map((idx) => [...this.codingMatrix[idx]!]);
    const decodeMatrix = ReedSolomonGaloisErasureCoder.gfInvertMatrix(subMatrix);
    const shardByteLength = maybeShards[survivingIndices[0]!]!.length;

    const recoveredDataShards: Uint8Array[] = Array.from(
      { length: k },
      () => new Uint8Array(shardByteLength)
    );

    for (let d = 0; d < k; d++) {
      const decRow = decodeMatrix[d]!;
      const outShard = recoveredDataShards[d]!;
      for (let byteIdx = 0; byteIdx < shardByteLength; byteIdx++) {
        let acc = 0;
        for (let s = 0; s < k; s++) {
          const survivingShard = maybeShards[survivingIndices[s]!]!;
          acc = ReedSolomonGaloisErasureCoder.gfAdd(
            acc,
            ReedSolomonGaloisErasureCoder.gfMul(decRow[s]!, survivingShard[byteIdx]!)
          );
        }
        outShard[byteIdx] = acc;
      }
    }

    const combined = new Uint8Array(k * shardByteLength);
    for (let d = 0; d < k; d++) {
      combined.set(recoveredDataShards[d]!, d * shardByteLength);
    }

    return combined.slice(0, originalByteLength);
  }
}
