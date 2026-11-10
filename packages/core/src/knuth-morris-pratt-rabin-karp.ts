export interface ContentDefinedChunk {
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  byteLength: number;
  rollingHashSignature: number;
  content: string;
}

/**
 * Knuth-Morris-Pratt (KMP) Prefix-Function Linear Matcher &
 * Content-Defined Chunking (CDC) Rolling Rabin-Karp Hash Boundary Splitter.
 */
export class KmpAndRabinKarpChunker {
  public static buildKmpPrefixTable(pattern: string): Int32Array {
    const m = pattern.length;
    const pi = new Int32Array(m);
    let k = 0;
    for (let q = 1; q < m; q++) {
      while (k > 0 && pattern[k] !== pattern[q]) {
        k = pi[k - 1]!;
      }
      if (pattern[k] === pattern[q]) {
        k++;
      }
      pi[q] = k;
    }
    return pi;
  }

  public static kmpSearchAll(text: string, pattern: string): number[] {
    if (pattern.length === 0 || text.length < pattern.length) return [];
    const pi = KmpAndRabinKarpChunker.buildKmpPrefixTable(pattern);
    const matches: number[] = [];
    let q = 0;

    for (let i = 0; i < text.length; i++) {
      while (q > 0 && pattern[q] !== text[i]) {
        q = pi[q - 1]!;
      }
      if (pattern[q] === text[i]) {
        q++;
      }
      if (q === pattern.length) {
        matches.push(i - pattern.length + 1);
        q = pi[q - 1]!;
      }
    }
    return matches;
  }

  /**
   * Content-Defined Chunking (CDC): cuts `payload` into variable-sized chunks at rolling hash
   * cutpoints (`(rollingHash & mask) === mask`) within `[minChunkSize, maxChunkSize]` so local insertions
   * only affect the single modified chunk!
   */
  public static splitContentDefinedChunks(
    payload: string,
    options?: { minChunkSize?: number; maxChunkSize?: number; cutpointMask?: number }
  ): ContentDefinedChunk[] {
    const minSize = Math.max(8, options?.minChunkSize ?? 16);
    const maxSize = Math.max(minSize + 8, options?.maxChunkSize ?? 64);
    const mask = options?.cutpointMask ?? 0x0f; // average 16-byte cut window after minSize

    const chunks: ContentDefinedChunk[] = [];
    let startOffset = 0;
    let rolling = 0;

    for (let i = 0; i < payload.length; i++) {
      rolling = (Math.imul(rolling, 257) + payload.charCodeAt(i)) >>> 0;
      const curLen = i - startOffset + 1;

      const isCutpoint = curLen >= minSize && (rolling & mask) === mask;
      const isMaxCap = curLen >= maxSize;
      const isEnd = i === payload.length - 1;

      if (isCutpoint || isMaxCap || isEnd) {
        chunks.push({
          chunkIndex: chunks.length,
          startOffset,
          endOffset: i + 1,
          byteLength: curLen,
          rollingHashSignature: rolling,
          content: payload.slice(startOffset, i + 1)
        });
        startOffset = i + 1;
        rolling = 0;
      }
    }

    return chunks;
  }
}
