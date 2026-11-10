/**
 * Boyer-Moore-Horspool Sub-Linear O(N / M) Bad-Character Skip String Matcher.
 * Precomputes a bad-character shift table to leap over non-matching text windows in large buffers.
 */
export class BoyerMooreHorspoolMatcher {
  public static searchAll(text: string, pattern: string): {
    matchIndices: number[];
    characterComparisonsExecuted: number;
  } {
    const n = text.length;
    const m = pattern.length;
    if (m === 0 || n < m) {
      return { matchIndices: [], characterComparisonsExecuted: 0 };
    }

    // Build bad-character shift table for pattern[0..m-2]
    const shiftTable = new Map<string, number>();
    for (let i = 0; i < m - 1; i++) {
      shiftTable.set(pattern[i]!, m - 1 - i);
    }

    const matchIndices: number[] = [];
    let characterComparisonsExecuted = 0;
    let offset = 0;

    while (offset <= n - m) {
      let j = m - 1;
      while (j >= 0) {
        characterComparisonsExecuted++;
        if (text[offset + j] !== pattern[j]) {
          break;
        }
        j--;
      }

      if (j < 0) {
        matchIndices.push(offset);
      }

      const lastWindowChar = text[offset + m - 1]!;
      const shift = shiftTable.get(lastWindowChar) ?? m;
      offset += Math.max(1, shift);
    }

    return {
      matchIndices,
      characterComparisonsExecuted
    };
  }
}
