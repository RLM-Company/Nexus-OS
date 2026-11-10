export interface LocalAlignmentResult {
  maxScore: number;
  alignedSubsequenceA: string;
  alignedSubsequenceB: string;
  startIndexA: number;
  endIndexA: number;
  startIndexB: number;
  endIndexB: number;
}

/**
 * Smith-Waterman Local Sequence Alignment Engine.
 * Identifies the highest-scoring conserved local substring/token region between two sequences
 * even when surrounded by unrelated prefixes or suffixes.
 */
export class SmithWatermanLocalAligner {
  public static alignStrings(
    seqA: string,
    seqB: string,
    options?: { matchScore?: number; mismatchPenalty?: number; gapPenalty?: number }
  ): LocalAlignmentResult {
    const match = options?.matchScore ?? 3;
    const mismatch = options?.mismatchPenalty ?? -2;
    const gap = options?.gapPenalty ?? -2;

    const n = seqA.length;
    const m = seqB.length;

    const H: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    // Trace: 0 = stop, 1 = diag, 2 = up (delete from A), 3 = left (insert from B)
    const trace: Uint8Array[] = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));

    let maxScore = 0;
    let bestI = 0;
    let bestJ = 0;

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const sDiag =
          H[i - 1]![j - 1]! + (seqA[i - 1] === seqB[j - 1] ? match : mismatch);
        const sUp = H[i - 1]![j]! + gap;
        const sLeft = H[i]![j - 1]! + gap;

        let best = 0;
        let dir = 0;
        if (sDiag > best) {
          best = sDiag;
          dir = 1;
        }
        if (sUp > best) {
          best = sUp;
          dir = 2;
        }
        if (sLeft > best) {
          best = sLeft;
          dir = 3;
        }

        H[i]![j] = best;
        trace[i]![j] = dir;

        if (best > maxScore) {
          maxScore = best;
          bestI = i;
          bestJ = j;
        }
      }
    }

    let i = bestI;
    let j = bestJ;
    const charsA: string[] = [];
    const charsB: string[] = [];

    while (i > 0 && j > 0 && H[i]![j]! > 0) {
      const dir = trace[i]![j]!;
      if (dir === 1) {
        charsA.push(seqA[i - 1]!);
        charsB.push(seqB[j - 1]!);
        i--;
        j--;
      } else if (dir === 2) {
        charsA.push(seqA[i - 1]!);
        charsB.push("-");
        i--;
      } else if (dir === 3) {
        charsA.push("-");
        charsB.push(seqB[j - 1]!);
        j--;
      } else {
        break;
      }
    }

    return {
      maxScore,
      alignedSubsequenceA: charsA.reverse().join(""),
      alignedSubsequenceB: charsB.reverse().join(""),
      startIndexA: i,
      endIndexA: bestI,
      startIndexB: j,
      endIndexB: bestJ
    };
  }
}
