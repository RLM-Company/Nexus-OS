/**
 * Kosmora / Nexus-OS MinHash & Locality-Sensitive Hashing (LSH) Near-Duplicate Detector (Wave 23)
 *
 * Implements Broder's MinHash (64 independent universal hash permutations over 3-gram character/word
 * shingles) combined with 16-band Locality-Sensitive Hashing (LSH, 4 rows per band) for sub-linear
 * near-duplicate detection across Vault documents, scraped web pages, and context memories.
 *
 * Capabilities:
 * 1. Unbiased Jaccard similarity estimation: `P(MinHash_i(A) === MinHash_i(B)) = |A ∩ B| / |A ∪ B|`.
 * 2. Sub-linear candidate bucketing via 16 LSH bands (`threshold ~ (1/16)^(1/4) ≈ 0.50`).
 * 3. SQLite persistence (`kosmora_minhash_signatures`) for instant cross-corpus deduplication.
 */

import type { DatabaseSync } from "node:sqlite";

export const NUM_MINHASH_PERMUTATIONS = 64;
export const NUM_LSH_BANDS = 16;
export const ROWS_PER_BAND = 4; // 16 * 4 = 64

export interface NearDuplicateMatch {
  docId: string;
  estimatedJaccard: number;
  matchedBands: number;
  metadata?: Record<string, any>;
}

// Deterministic universal hash coefficients (a_i * x + b_i) mod Prime (2^31 - 1)
const MERSENNE_PRIME = 0x7fffffff;
const COEFF_A = new Uint32Array(NUM_MINHASH_PERMUTATIONS);
const COEFF_B = new Uint32Array(NUM_MINHASH_PERMUTATIONS);
{
  let seed = 0x1337c0de;
  const nextRand = () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % MERSENNE_PRIME;
  };
  for (let i = 0; i < NUM_MINHASH_PERMUTATIONS; i++) {
    COEFF_A[i] = Math.max(1, nextRand() | 1);
    COEFF_B[i] = nextRand();
  }
}

function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % MERSENNE_PRIME;
}

/**
 * Extracts normalized 4-character sliding shingles from text.
 */
export function extractTextShingleHashes(text: string, shingleLen = 4): Uint32Array {
  const norm = String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (norm.length === 0) {
    return new Uint32Array([0]);
  }
  if (norm.length <= shingleLen) {
    return new Uint32Array([fnv1a32(norm)]);
  }

  const uniqueHashes = new Set<number>();
  for (let i = 0; i <= norm.length - shingleLen; i++) {
    uniqueHashes.add(fnv1a32(norm.slice(i, i + shingleLen)));
  }
  return new Uint32Array(uniqueHashes);
}

/**
 * Computes a 64-element MinHash signature for the given text.
 */
export function computeMinHashSignature(text: string): Uint32Array {
  const shingleHashes = extractTextShingleHashes(text);
  const sig = new Uint32Array(NUM_MINHASH_PERMUTATIONS);
  sig.fill(0xffffffff);

  for (let sIdx = 0; sIdx < shingleHashes.length; sIdx++) {
    const x = shingleHashes[sIdx];
    for (let p = 0; p < NUM_MINHASH_PERMUTATIONS; p++) {
      // Universal hash: (a * x + b) % PRIME
      const h = Number((BigInt(COEFF_A[p]) * BigInt(x) + BigInt(COEFF_B[p])) % BigInt(MERSENNE_PRIME));
      if (h < sig[p]) {
        sig[p] = h;
      }
    }
  }

  return sig;
}

/**
 * Computes the empirical Jaccard similarity estimate between two MinHash signatures.
 */
export function estimateMinHashJaccard(sigA: Uint32Array, sigB: Uint32Array): number {
  if (sigA.length !== sigB.length || sigA.length === 0) return 0;
  let matches = 0;
  for (let i = 0; i < sigA.length; i++) {
    if (sigA[i] === sigB[i]) {
      matches += 1;
    }
  }
  return Number((matches / sigA.length).toFixed(4));
}

/**
 * Computes 16 LSH band bucket keys from a 64-element MinHash signature.
 */
export function computeLshBandKeys(sig: Uint32Array): string[] {
  const keys: string[] = [];
  for (let b = 0; b < NUM_LSH_BANDS; b++) {
    const offset = b * ROWS_PER_BAND;
    const bandSlice = `${sig[offset]}_${sig[offset + 1]}_${sig[offset + 2]}_${sig[offset + 3]}`;
    keys.push(`b${b}:${bandSlice}`);
  }
  return keys;
}

export class MinHashLshDeduplicator {
  private readonly signatures = new Map<string, { sig: Uint32Array; metadata?: Record<string, any> }>();
  private readonly lshBuckets = new Map<string, Set<string>>(); // bandKey -> Set<docId>

  constructor(private readonly sqlite?: DatabaseSync) {
    if (this.sqlite) {
      this.ensureSchema();
    }
  }

  ensureSchema(): void {
    if (!this.sqlite) return;
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_minhash_signatures (
        doc_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        sig_base64 TEXT NOT NULL,
        band_keys_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, doc_id)
      );
    `);
  }

  public indexDocument(
    docId: string,
    text: string,
    options?: { ownerId?: string; metadata?: Record<string, any> }
  ): Uint32Array {
    const sig = computeMinHashSignature(text);
    const bandKeys = computeLshBandKeys(sig);

    this.signatures.set(docId, { sig, metadata: options?.metadata });
    for (const bk of bandKeys) {
      let bucket = this.lshBuckets.get(bk);
      if (!bucket) {
        bucket = new Set<string>();
        this.lshBuckets.set(bk, bucket);
      }
      bucket.add(docId);
    }

    if (this.sqlite && options?.ownerId) {
      const sigBase64 = Buffer.from(sig.buffer, sig.byteOffset, sig.byteLength).toString("base64");
      this.sqlite
        .prepare(
          `INSERT INTO kosmora_minhash_signatures (
            doc_id, owner_id, sig_base64, band_keys_json, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(owner_id, doc_id) DO UPDATE SET
            sig_base64 = excluded.sig_base64,
            band_keys_json = excluded.band_keys_json,
            metadata_json = excluded.metadata_json`
        )
        .run(
          docId,
          options.ownerId,
          sigBase64,
          JSON.stringify(bandKeys),
          JSON.stringify(options.metadata ?? {}),
          new Date().toISOString()
        );
    }

    return sig;
  }

  /**
   * Queries LSH buckets in O(1) per band to find near-duplicate candidates and ranks them
   * by exact MinHash Jaccard similarity.
   */
  public findNearDuplicates(
    queryText: string,
    options?: { minJaccardThreshold?: number; excludeDocId?: string }
  ): NearDuplicateMatch[] {
    const threshold = options?.minJaccardThreshold ?? 0.5;
    const querySig = computeMinHashSignature(queryText);
    const bandKeys = computeLshBandKeys(querySig);

    const candidateBandCounts = new Map<string, number>();
    for (const bk of bandKeys) {
      const bucket = this.lshBuckets.get(bk);
      if (!bucket) continue;
      for (const candId of bucket) {
        if (candId === options?.excludeDocId) continue;
        candidateBandCounts.set(candId, (candidateBandCounts.get(candId) ?? 0) + 1);
      }
    }

    const matches: NearDuplicateMatch[] = [];
    for (const [candId, matchedBands] of candidateBandCounts.entries()) {
      const entry = this.signatures.get(candId);
      if (!entry) continue;
      const jaccard = estimateMinHashJaccard(querySig, entry.sig);
      if (jaccard >= threshold) {
        matches.push({
          docId: candId,
          estimatedJaccard: jaccard,
          matchedBands,
          metadata: entry.metadata
        });
      }
    }

    matches.sort((a, b) => b.estimatedJaccard - a.estimatedJaccard);
    return matches;
  }
}
