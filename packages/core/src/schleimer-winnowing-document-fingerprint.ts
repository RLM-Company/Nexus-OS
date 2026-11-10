export interface WinnowFingerprint {
  hash: number;
  position: number;
}

/**
 * Schleimer, Wilkerson & Aiken (SIGMOD 2003) Winnowing Local Document Fingerprinting Engine.
 * Normalizes text, computes rolling k-gram hashes, slides a window of size w, and selects the
 * rightmost minimum hash in each window. Guarantees detection of any shared substring of length
 * at least t = w + k - 1 while bounding fingerprint density to 2 / (w + 1).
 */
export class SchleimerWinnowingPlagiarismFingerprinter {
  private static hashKgram(gram: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < gram.length; i++) {
      h ^= gram.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  public static extractWinnowFingerprints(
    rawText: string,
    kGramSize: number = 5,
    windowSizeW: number = 4
  ): WinnowFingerprint[] {
    const normalized = rawText.toLowerCase().replace(/[^a-z0-9а-яё]/gi, "");
    if (normalized.length < kGramSize) return [];

    const hashes: number[] = [];
    for (let i = 0; i <= normalized.length - kGramSize; i++) {
      hashes.push(
        SchleimerWinnowingPlagiarismFingerprinter.hashKgram(
          normalized.slice(i, i + kGramSize)
        )
      );
    }

    if (hashes.length <= windowSizeW) {
      let minH = Infinity;
      let minPos = 0;
      hashes.forEach((h, idx) => {
        if (h <= minH) {
          minH = h;
          minPos = idx;
        }
      });
      return [{ hash: minH, position: minPos }];
    }

    const fingerprints: WinnowFingerprint[] = [];
    let lastSelectedPos = -1;

    for (let wStart = 0; wStart <= hashes.length - windowSizeW; wStart++) {
      let minHash = Infinity;
      let minPos = wStart;
      // Rightmost minimum in window [wStart, wStart + windowSizeW - 1]
      for (let j = wStart; j < wStart + windowSizeW; j++) {
        if (hashes[j]! <= minHash) {
          minHash = hashes[j]!;
          minPos = j;
        }
      }
      if (minPos !== lastSelectedPos) {
        fingerprints.push({ hash: minHash, position: minPos });
        lastSelectedPos = minPos;
      }
    }

    return fingerprints;
  }

  public static computeContainmentOverlap(
    docA: string,
    docB: string,
    kGramSize: number = 5,
    windowSizeW: number = 4
  ): {
    sharedFingerprintCount: number;
    jaccardFingerprintOverlap: number;
    containmentInA: number;
  } {
    const fpA = new Set(
      SchleimerWinnowingPlagiarismFingerprinter.extractWinnowFingerprints(
        docA,
        kGramSize,
        windowSizeW
      ).map((f) => f.hash)
    );
    const fpB = new Set(
      SchleimerWinnowingPlagiarismFingerprinter.extractWinnowFingerprints(
        docB,
        kGramSize,
        windowSizeW
      ).map((f) => f.hash)
    );

    if (fpA.size === 0 && fpB.size === 0) {
      return { sharedFingerprintCount: 0, jaccardFingerprintOverlap: 1, containmentInA: 1 };
    }

    let shared = 0;
    for (const h of fpA) {
      if (fpB.has(h)) shared++;
    }
    const union = fpA.size + fpB.size - shared;
    return {
      sharedFingerprintCount: shared,
      jaccardFingerprintOverlap: union > 0 ? Number((shared / union).toFixed(6)) : 0,
      containmentInA: fpA.size > 0 ? Number((shared / fpA.size).toFixed(6)) : 0
    };
  }
}
