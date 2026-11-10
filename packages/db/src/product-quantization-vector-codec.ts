import { DatabaseSync } from "node:sqlite";

export interface PqEncodedEntry {
  id: string;
  codes: Uint8Array; // M bytes (1 byte per subspace)
  metadata?: Record<string, unknown>;
}

export interface PqSearchMatch {
  id: string;
  asymmetricL2DistanceSq: number;
  approximateSimilarity: number;
  metadata?: Record<string, unknown>;
}

/**
 * Product Quantization (PQ) 8-Subspace Vector Compressor & Asymmetric Distance Computation (ADC) Engine.
 * Compresses 64-dimensional Float32 vectors (256 bytes) into 8-byte uint8 codes (32x compression ratio)
 * for high-density in-memory vector search on 1 GB RAM VPS instances.
 */
export class ProductQuantizationCodec {
  public readonly dim: number;
  public readonly subspaces: number;
  public readonly subDim: number;
  public readonly centroidsPerSubspace: number;
  // centroids[m][k] is a Float32Array of length subDim
  private centroids: Float32Array[][] = [];
  private readonly encodedEntries = new Map<string, PqEncodedEntry>();

  constructor(options?: {
    dim?: number;
    subspaces?: number;
    centroidsPerSubspace?: number;
  }) {
    this.dim = options?.dim ?? 64;
    this.subspaces = options?.subspaces ?? 8;
    if (this.dim % this.subspaces !== 0) {
      throw new Error("INVALID_PQ_DIMENSIONS: dim must be divisible by subspaces");
    }
    this.subDim = this.dim / this.subspaces;
    this.centroidsPerSubspace = Math.min(256, Math.max(4, options?.centroidsPerSubspace ?? 16));
  }

  /**
   * Trains subspace K-means codebooks deterministically from a training sample of vectors.
   */
  public trainCodebooks(trainingVectors: number[][], iterations = 8): void {
    if (trainingVectors.length === 0) {
      throw new Error("EMPTY_TRAINING_SET: require at least 1 vector to train PQ codebooks");
    }

    const kCount = Math.min(this.centroidsPerSubspace, trainingVectors.length);
    this.centroids = [];

    for (let m = 0; m < this.subspaces; m++) {
      const offset = m * this.subDim;
      // Initialize K centroids using evenly spaced training samples
      const subCentroids: Float32Array[] = [];
      for (let k = 0; k < kCount; k++) {
        const sampleIdx = Math.floor((k * trainingVectors.length) / kCount);
        const vec = trainingVectors[sampleIdx]!;
        const c = new Float32Array(this.subDim);
        for (let d = 0; d < this.subDim; d++) {
          c[d] = vec[offset + d] ?? 0;
        }
        subCentroids.push(c);
      }

      // Lloyd's K-means refinement per subspace
      for (let iter = 0; iter < iterations; iter++) {
        const sums = Array.from({ length: kCount }, () => new Float64Array(this.subDim));
        const counts = new Int32Array(kCount);

        for (const vec of trainingVectors) {
          let bestK = 0;
          let bestDist = Infinity;
          for (let k = 0; k < kCount; k++) {
            const cent = subCentroids[k]!;
            let dist = 0;
            for (let d = 0; d < this.subDim; d++) {
              const diff = (vec[offset + d] ?? 0) - cent[d]!;
              dist += diff * diff;
            }
            if (dist < bestDist) {
              bestDist = dist;
              bestK = k;
            }
          }
          counts[bestK]!++;
          const sumArr = sums[bestK]!;
          for (let d = 0; d < this.subDim; d++) {
            sumArr[d] += vec[offset + d] ?? 0;
          }
        }

        for (let k = 0; k < kCount; k++) {
          if (counts[k]! > 0) {
            const cent = subCentroids[k]!;
            const sumArr = sums[k]!;
            for (let d = 0; d < this.subDim; d++) {
              cent[d] = sumArr[d]! / counts[k]!;
            }
          }
        }
      }

      this.centroids.push(subCentroids);
    }
  }

  public encodeVector(vector: number[]): Uint8Array {
    if (this.centroids.length !== this.subspaces) {
      throw new Error("PQ_CODEBOOK_NOT_TRAINED: call trainCodebooks() before encoding");
    }
    const codes = new Uint8Array(this.subspaces);
    for (let m = 0; m < this.subspaces; m++) {
      const offset = m * this.subDim;
      const subCentroids = this.centroids[m]!;
      let bestK = 0;
      let bestDist = Infinity;
      for (let k = 0; k < subCentroids.length; k++) {
        const cent = subCentroids[k]!;
        let dist = 0;
        for (let d = 0; d < this.subDim; d++) {
          const diff = (vector[offset + d] ?? 0) - cent[d]!;
          dist += diff * diff;
        }
        if (dist < bestDist) {
          bestDist = dist;
          bestK = k;
        }
      }
      codes[m] = bestK;
    }
    return codes;
  }

  public reconstructVector(codes: Uint8Array): number[] {
    const out = new Array<number>(this.dim);
    for (let m = 0; m < this.subspaces; m++) {
      const offset = m * this.subDim;
      const code = codes[m]!;
      const cent = this.centroids[m]![code]!;
      for (let d = 0; d < this.subDim; d++) {
        out[offset + d] = cent[d]!;
      }
    }
    return out;
  }

  public upsertVector(id: string, vector: number[], metadata?: Record<string, unknown>): Uint8Array {
    const codes = this.encodeVector(vector);
    this.encodedEntries.set(id, { id, codes, metadata });
    return codes;
  }

  /**
   * Executes Asymmetric Distance Computation (ADC): precomputes an M x K distance lookup table
   * for the uncompressed query vector and evaluates each candidate in M table lookups!
   */
  public searchAsymmetricTopK(queryVector: number[], topK = 5): PqSearchMatch[] {
    if (this.centroids.length !== this.subspaces) {
      throw new Error("PQ_CODEBOOK_NOT_TRAINED");
    }

    // Precompute M x K squared L2 distance lookup table
    const distanceTable: Float32Array[] = [];
    for (let m = 0; m < this.subspaces; m++) {
      const offset = m * this.subDim;
      const subCentroids = this.centroids[m]!;
      const tableM = new Float32Array(subCentroids.length);
      for (let k = 0; k < subCentroids.length; k++) {
        const cent = subCentroids[k]!;
        let dist = 0;
        for (let d = 0; d < this.subDim; d++) {
          const diff = (queryVector[offset + d] ?? 0) - cent[d]!;
          dist += diff * diff;
        }
        tableM[k] = dist;
      }
      distanceTable.push(tableM);
    }

    const matches: PqSearchMatch[] = [];
    for (const entry of this.encodedEntries.values()) {
      let distSq = 0;
      for (let m = 0; m < this.subspaces; m++) {
        distSq += distanceTable[m]![entry.codes[m]!]!;
      }
      matches.push({
        id: entry.id,
        asymmetricL2DistanceSq: Number(distSq.toFixed(6)),
        // For unit-normalized vectors, cos(theta) = 1 - ||x - y||^2 / 2
        approximateSimilarity: Number((1 - distSq / 2).toFixed(6)),
        metadata: entry.metadata
      });
    }

    matches.sort((a, b) => a.asymmetricL2DistanceSq - b.asymmetricL2DistanceSq);
    return matches.slice(0, topK);
  }

  public get compressionRatio(): number {
    const rawFloat32Bytes = this.dim * 4;
    const pqBytes = this.subspaces;
    return rawFloat32Bytes / pqBytes;
  }

  public saveToSqlite(sqlite: DatabaseSync, ownerId: string, namespace = "default"): string {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_pq_codebooks (
        codebook_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        subspaces INTEGER NOT NULL,
        centroids_per_subspace INTEGER NOT NULL,
        codebook_json TEXT NOT NULL,
        codes_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, namespace)
      );
    `);

    const codebookId = `pq_${ownerId}_${namespace}`;
    const serializedCentroids = this.centroids.map((sub) => sub.map((c) => Array.from(c)));
    const serializedCodes = Array.from(this.encodedEntries.values()).map((e) => ({
      id: e.id,
      codes: Array.from(e.codes),
      metadata: e.metadata
    }));

    sqlite
      .prepare(
        `INSERT INTO kosmora_pq_codebooks
          (codebook_id, owner_id, namespace, subspaces, centroids_per_subspace, codebook_json, codes_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, namespace) DO UPDATE SET
          codebook_json = excluded.codebook_json,
          codes_json = excluded.codes_json,
          updated_at = excluded.updated_at`
      )
      .run(
        codebookId,
        ownerId,
        namespace,
        this.subspaces,
        this.centroidsPerSubspace,
        JSON.stringify({ dim: this.dim, centroids: serializedCentroids }),
        JSON.stringify(serializedCodes),
        new Date().toISOString()
      );

    return codebookId;
  }

  public static loadFromSqlite(
    sqlite: DatabaseSync,
    ownerId: string,
    namespace = "default"
  ): ProductQuantizationCodec | null {
    const row = sqlite
      .prepare(
        `SELECT subspaces, centroids_per_subspace, codebook_json, codes_json
         FROM kosmora_pq_codebooks WHERE owner_id = ? AND namespace = ?`
      )
      .get(ownerId, namespace) as
      | {
          subspaces: number;
          centroids_per_subspace: number;
          codebook_json: string;
          codes_json: string;
        }
      | undefined;

    if (!row) return null;

    const cbData = JSON.parse(row.codebook_json) as { dim: number; centroids: number[][][] };
    const codesData = JSON.parse(row.codes_json) as Array<{
      id: string;
      codes: number[];
      metadata?: Record<string, unknown>;
    }>;

    const pq = new ProductQuantizationCodec({
      dim: cbData.dim,
      subspaces: row.subspaces,
      centroidsPerSubspace: row.centroids_per_subspace
    });

    pq.centroids = cbData.centroids.map((sub) => sub.map((c) => new Float32Array(c)));
    for (const item of codesData) {
      pq.encodedEntries.set(item.id, {
        id: item.id,
        codes: new Uint8Array(item.codes),
        metadata: item.metadata
      });
    }

    return pq;
  }
}
