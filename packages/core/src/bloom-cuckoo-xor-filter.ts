/**
 * Graf & Lemire's 16-Bit Xor Filter Static Membership Index (~1.23x table size).
 * Uses 3-way hypergraph peeling to assign 16-bit fingerprints into three segmented banks
 * such that B[h0(k)] ^ B[h1(k)] ^ B[h2(k)] == fingerprint16(k) for every member key k,
 * guaranteeing 0% false negatives and ~1/65536 false positive rate in 3 array lookups.
 */
export class XorFilterStaticMembershipIndex {
  public readonly segmentLength: number;
  public readonly totalSlots: number;
  public readonly seed: number;
  private readonly fingerprints: Uint16Array;

  constructor(keys: string[]) {
    const uniqueKeys = Array.from(new Set(keys));
    const n = Math.max(1, uniqueKeys.length);
    const capacity = Math.max(12, Math.floor(1.23 * n) + 32);
    this.segmentLength = Math.ceil(capacity / 3);
    this.totalSlots = this.segmentLength * 3;

    let builtSeed = 1337;
    let builtTable: Uint16Array | null = null;

    for (let attempt = 0; attempt < 30; attempt++) {
      const candidateSeed = (1337 + attempt * 7919) >>> 0;
      const table = this.tryBuildPeelingTable(uniqueKeys, candidateSeed);
      if (table !== null) {
        builtSeed = candidateSeed;
        builtTable = table;
        break;
      }
    }

    if (!builtTable) {
      throw new Error("XOR_FILTER_PEELING_FAILED_AFTER_RETRIES");
    }

    this.seed = builtSeed;
    this.fingerprints = builtTable;
  }

  private static mixHash(key: string, salt: number): number {
    let h = (2166136261 ^ salt) >>> 0;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    return h >>> 0;
  }

  private getHashesAndFingerprint(
    key: string,
    seed: number
  ): { h0: number; h1: number; h2: number; fp: number } {
    const seg = this.segmentLength;
    const h0 = XorFilterStaticMembershipIndex.mixHash(key, seed ^ 0x11111111) % seg;
    const h1 = seg + (XorFilterStaticMembershipIndex.mixHash(key, seed ^ 0x22222222) % seg);
    const h2 = 2 * seg + (XorFilterStaticMembershipIndex.mixHash(key, seed ^ 0x33333333) % seg);
    const fp = (XorFilterStaticMembershipIndex.mixHash(key, seed ^ 0x99999999) & 0xffff) || 1;
    return { h0, h1, h2, fp };
  }

  private tryBuildPeelingTable(keys: string[], seed: number): Uint16Array | null {
    const count = new Int32Array(this.totalSlots);
    const xorKeyIdx = new Int32Array(this.totalSlots);

    const keyHashes = keys.map((k) => this.getHashesAndFingerprint(k, seed));

    for (let i = 0; i < keyHashes.length; i++) {
      const { h0, h1, h2 } = keyHashes[i]!;
      count[h0]!++;
      xorKeyIdx[h0]! ^= i;
      count[h1]!++;
      xorKeyIdx[h1]! ^= i;
      count[h2]!++;
      xorKeyIdx[h2]! ^= i;
    }

    const queue: number[] = [];
    for (let slot = 0; slot < this.totalSlots; slot++) {
      if (count[slot] === 1) {
        queue.push(slot);
      }
    }

    const peelingStack: Array<{ keyIndex: number; pivotSlot: number }> = [];

    while (queue.length > 0) {
      const slot = queue.pop()!;
      if (count[slot] !== 1) continue;

      const keyIndex = xorKeyIdx[slot]!;
      peelingStack.push({ keyIndex, pivotSlot: slot });

      const { h0, h1, h2 } = keyHashes[keyIndex]!;
      for (const h of [h0, h1, h2]) {
        count[h]!--;
        xorKeyIdx[h]! ^= keyIndex;
        if (count[h] === 1) {
          queue.push(h);
        }
      }
    }

    if (peelingStack.length !== keys.length) {
      return null;
    }

    const B = new Uint16Array(this.totalSlots);
    while (peelingStack.length > 0) {
      const { keyIndex, pivotSlot } = peelingStack.pop()!;
      const { h0, h1, h2, fp } = keyHashes[keyIndex]!;
      B[pivotSlot] = 0;
      B[pivotSlot] = (fp ^ B[h0]! ^ B[h1]! ^ B[h2]!) & 0xffff;
    }

    return B;
  }

  public mightContain(key: string): boolean {
    const { h0, h1, h2, fp } = this.getHashesAndFingerprint(key, this.seed);
    return ((this.fingerprints[h0]! ^ this.fingerprints[h1]! ^ this.fingerprints[h2]!) & 0xffff) === fp;
  }
}
