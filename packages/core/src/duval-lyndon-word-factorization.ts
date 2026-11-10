/**
 * Jean-Pierre Duval's O(N) Chen-Fox-Lyndon Word Factorization & Lexicographically Minimal
 * Circular String Rotation Canonicalizer.
 * - Factorizes any string S uniquely into Lyndon words L_1 >= L_2 >= ... >= L_m in O(N) time
 *   and O(1) auxiliary space.
 * - Finds the lexicographically smallest cyclic shift of S in O(N) time by running Duval's
 *   algorithm on S + S.
 */
export class DuvalLyndonFactorizationEngine {
  public static factorizeLyndonWords(s: string): string[] {
    const n = s.length;
    const factors: string[] = [];
    let i = 0;

    while (i < n) {
      let j = i + 1;
      let k = i;
      while (j < n && s[k]! <= s[j]!) {
        if (s[k]! < s[j]!) {
          k = i;
        } else {
          k++;
        }
        j++;
      }
      const period = j - k;
      while (i <= k) {
        factors.push(s.slice(i, i + period));
        i += period;
      }
    }

    return factors;
  }

  public static minimalCyclicRotation(s: string): {
    canonicalRotation: string;
    rotationOffset: number;
  } {
    const n = s.length;
    if (n === 0) return { canonicalRotation: "", rotationOffset: 0 };

    const doubled = s + s;
    let i = 0;
    let ans = 0;

    while (i < n) {
      ans = i;
      let j = i + 1;
      let k = i;
      while (j < 2 * n && doubled[k]! <= doubled[j]!) {
        if (doubled[k]! < doubled[j]!) {
          k = i;
        } else {
          k++;
        }
        j++;
      }
      const period = j - k;
      while (i <= k) {
        i += period;
      }
    }

    return {
      canonicalRotation: doubled.slice(ans, ans + n),
      rotationOffset: ans
    };
  }
}
