export interface LshDuplicateMatch {
  docId: string;
  estimatedJaccard: number;
}

/**
 * Broder k-Shingle MinHash Signatures + Banded Locality-Sensitive Hashing (LSH)
 * Near-Duplicate Document & Prompt Detector.
 */
export class MinHashLshNearDuplicateIndex {
  public readonly numHashes: number;
  public readonly numBands: number;
  public readonly rowsPerBand: number;
  private readonly signatures = new Map<string, Uint32Array>();
  // bandBuckets[bandIdx].get(bandHash) -> Set<docId>
  private readonly bandBuckets: Array<Map<string, Set<string>>>;

  constructor(params?: { numBands?: number; rowsPerBand?: number }) {
    this.numBands = Math.max(2, params?.numBands ?? 16);
    this.rowsPerBand = Math.max(2, params?.rowsPerBand ?? 4);
    this.numHashes = this.numBands * this.rowsPerBand;
    this.bandBuckets = Array.from({ length: this.numBands }, () => new Map());
  }

  public static extractShingles(text: string, k = 3): Set<string> {
    const clean = text.toLowerCase().replace(/\s+/g, " ").trim();
    const words = clean.split(" ").filter(Boolean);
    const shingles = new Set<string>();
    if (words.length <= k) {
      shingles.add(words.join(" "));
      return shingles;
    }
    for (let i = 0; i <= words.length - k; i++) {
      shingles.add(words.slice(i, i + k).join(" "));
    }
    return shingles;
  }

  private hashShingleWithSeed(shingle: string, seed: number): number {
    let h = (2166136261 ^ seed) >>> 0;
    for (let i = 0; i < shingle.length; i++) {
      h ^= shingle.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  public computeSignature(text: string): Uint32Array {
    const shingles = MinHashLshNearDuplicateIndex.extractShingles(text, 3);
    const sig = new Uint32Array(this.numHashes);
    sig.fill(0xffffffff);

    for (let i = 0; i < this.numHashes; i++) {
      const seed = Math.imul(i + 1, 2654435761) >>> 0;
      for (const sh of shingles) {
        const h = this.hashShingleWithSeed(sh, seed);
        if (h < sig[i]!) {
          sig[i] = h;
        }
      }
    }
    return sig;
  }

  public indexDocument(docId: string, text: string): void {
    const sig = this.computeSignature(text);
    this.signatures.set(docId, sig);

    for (let b = 0; b < this.numBands; b++) {
      const start = b * this.rowsPerBand;
      const bandSlice = Array.from(sig.subarray(start, start + this.rowsPerBand)).join(":");
      let bucket = this.bandBuckets[b]!.get(bandSlice);
      if (!bucket) {
        bucket = new Set();
        this.bandBuckets[b]!.set(bandSlice, bucket);
      }
      bucket.add(docId);
    }
  }

  public queryNearDuplicates(text: string, minJaccard = 0.5): LshDuplicateMatch[] {
    const querySig = this.computeSignature(text);
    const candidateDocIds = new Set<string>();

    for (let b = 0; b < this.numBands; b++) {
      const start = b * this.rowsPerBand;
      const bandSlice = Array.from(querySig.subarray(start, start + this.rowsPerBand)).join(":");
      const bucket = this.bandBuckets[b]!.get(bandSlice);
      if (bucket) {
        for (const id of bucket) candidateDocIds.add(id);
      }
    }

    const matches: LshDuplicateMatch[] = [];
    for (const candId of candidateDocIds) {
      const candSig = this.signatures.get(candId)!;
      let equalCount = 0;
      for (let i = 0; i < this.numHashes; i++) {
        if (querySig[i] === candSig[i]) equalCount++;
      }
      const estJaccard = Number((equalCount / this.numHashes).toFixed(4));
      if (estJaccard >= minJaccard) {
        matches.push({ docId: candId, estimatedJaccard: estJaccard });
      }
    }

    return matches.sort((a, b) => b.estimatedJaccard - a.estimatedJaccard);
  }
}
