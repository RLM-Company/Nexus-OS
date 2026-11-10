import { createHash } from "node:crypto";

export interface ContentDefinedChunk {
  offset: number;
  length: number;
  sha256: string;
}

/**
 * FastCDC Gear-Hash Content-Defined Deduplication Chunker.
 * Uses a 256-entry deterministic 32-bit Gear lookup table and two-level normalized masks
 * (strict mask S before normalSize, relaxed mask L after normalSize) to achieve shift-resilient
 * variable-sized chunking with bounded [minSize, maxSize] chunk lengths.
 */
export class GearFastContentDefinedChunker {
  private static readonly GEAR_TABLE: Uint32Array = (() => {
    const tbl = new Uint32Array(256);
    let state = 0x6c078965;
    for (let i = 0; i < 256; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      tbl[i] = state >>> 0;
    }
    return tbl;
  })();

  public static chunkBuffer(
    payload: Uint8Array,
    options?: {
      minSize?: number;
      normalSize?: number;
      maxSize?: number;
      maskStrict?: number;
      maskRelaxed?: number;
    }
  ): ContentDefinedChunk[] {
    const minSize = options?.minSize ?? 16;
    const normalSize = options?.normalSize ?? 64;
    const maxSize = options?.maxSize ?? 256;
    const maskStrict = options?.maskStrict ?? 0x0000003f; // 6 bits
    const maskRelaxed = options?.maskRelaxed ?? 0x0000000f; // 4 bits

    const chunks: ContentDefinedChunk[] = [];
    let offset = 0;
    const total = payload.length;

    while (offset < total) {
      const remaining = total - offset;
      if (remaining <= minSize) {
        const slice = payload.subarray(offset, total);
        chunks.push({
          offset,
          length: remaining,
          sha256: createHash("sha256").update(slice).digest("hex")
        });
        break;
      }

      const endLimit = Math.min(total, offset + maxSize);
      const normalPoint = Math.min(endLimit, offset + normalSize);
      let fp = 0;
      let cutPoint = endLimit;

      let pos = offset + minSize;
      for (; pos < normalPoint; pos++) {
        fp = ((fp << 1) + GearFastContentDefinedChunker.GEAR_TABLE[payload[pos]!]!) >>> 0;
        if ((fp & maskStrict) === 0) {
          cutPoint = pos + 1;
          break;
        }
      }

      if (cutPoint === endLimit) {
        for (; pos < endLimit; pos++) {
          fp = ((fp << 1) + GearFastContentDefinedChunker.GEAR_TABLE[payload[pos]!]!) >>> 0;
          if ((fp & maskRelaxed) === 0) {
            cutPoint = pos + 1;
            break;
          }
        }
      }

      const len = cutPoint - offset;
      const slice = payload.subarray(offset, cutPoint);
      chunks.push({
        offset,
        length: len,
        sha256: createHash("sha256").update(slice).digest("hex")
      });
      offset = cutPoint;
    }

    return chunks;
  }
}
