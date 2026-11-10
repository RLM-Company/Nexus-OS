export interface BitapApproximateHit {
  endIndex: number;
  editDistance: number;
}

/**
 * Baeza-Yates & Gonnet / Wu-Manber Bitap (Shift-And) Bit-Parallel Approximate String Matcher.
 * Maintains k + 1 64-bit state bitmasks R[0..k] where bit j of R[d] is 1 iff prefix P[0..j]
 * matches a suffix of T[0..i] with at most d Levenshtein edits (insert, delete, substitute).
 */
export class BitapShiftOrApproximateMatcher {
  public static searchApproximate(
    text: string,
    pattern: string,
    maxEditsK: number = 1
  ): BitapApproximateHit[] {
    const m = pattern.length;
    if (m === 0 || m > 60) {
      throw new Error("Bitap pattern length must be in 1..60 for 64-bit word parallelism");
    }

    const charMasks = new Map<string, bigint>();
    for (let j = 0; j < m; j++) {
      const ch = pattern[j]!;
      charMasks.set(ch, (charMasks.get(ch) ?? 0n) | (1n << BigInt(j)));
    }

    const R = new Array<bigint>(maxEditsK + 1).fill(0n);
    const acceptBit = 1n << BigInt(m - 1);
    const hits: BitapApproximateHit[] = [];

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const pm = charMasks.get(ch) ?? 0n;

      let prevRd = R[0]!;
      R[0] = ((R[0]! << 1n) | 1n) & pm;

      for (let d = 1; d <= maxEditsK; d++) {
        const currRd = R[d]!;
        const exactMatchStep = ((currRd << 1n) | 1n) & pm;
        const insertionStep = prevRd; // insert into text
        const substitutionStep = (prevRd << 1n) | 1n;
        const deletionStep = (R[d - 1]! << 1n) | 1n; // delete from pattern

        R[d] = exactMatchStep | insertionStep | substitutionStep | deletionStep;
        prevRd = currRd;
      }

      for (let d = 0; d <= maxEditsK; d++) {
        if ((R[d]! & acceptBit) !== 0n) {
          hits.push({ endIndex: i, editDistance: d });
          break;
        }
      }
    }

    return hits;
  }
}
