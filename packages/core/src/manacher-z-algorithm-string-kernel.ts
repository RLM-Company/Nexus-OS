/**
 * Glenn Manacher's O(N) All-Centers Palindromic Radius Engine & Gusfield's O(N) Z-Algorithm.
 * - Manacher's algorithm transforms string S of length N into #S_0#S_1#...# of length 2N+1
 *   and reuses mirror radii within the rightmost palindrome box [L, R] in strict O(N) time.
 * - Z-Algorithm computes Z[i] = length of longest common prefix between S and S[i..N-1] in O(N) time.
 */
export class ManacherAndZAlgorithmStringKernel {
  public static longestPalindromicSubstring(text: string): {
    palindrome: string;
    startIndex: number;
    length: number;
  } {
    if (text.length === 0) return { palindrome: "", startIndex: 0, length: 0 };

    const t = "#" + text.split("").join("#") + "#";
    const m = t.length;
    const p = new Int32Array(m);
    let center = 0;
    let right = 0;

    let maxLen = 0;
    let bestCenter = 0;

    for (let i = 0; i < m; i++) {
      const mirror = 2 * center - i;
      if (i < right) {
        p[i] = Math.min(right - i, p[mirror]!);
      }
      while (
        i + p[i]! + 1 < m &&
        i - p[i]! - 1 >= 0 &&
        t[i + p[i]! + 1] === t[i - p[i]! - 1]
      ) {
        p[i]!++;
      }
      if (i + p[i]! > right) {
        center = i;
        right = i + p[i]!;
      }
      if (p[i]! > maxLen) {
        maxLen = p[i]!;
        bestCenter = i;
      }
    }

    const startIndex = Math.floor((bestCenter - maxLen) / 2);
    return {
      palindrome: text.slice(startIndex, startIndex + maxLen),
      startIndex,
      length: maxLen
    };
  }

  public static computeZArray(s: string): number[] {
    const n = s.length;
    if (n === 0) return [];
    const z = new Array<number>(n).fill(0);
    z[0] = n;
    let l = 0;
    let r = 0;

    for (let i = 1; i < n; i++) {
      if (i <= r) {
        z[i] = Math.min(r - i + 1, z[i - l]!);
      }
      while (i + z[i]! < n && s[z[i]!] === s[i + z[i]!]) {
        z[i]!++;
      }
      if (i + z[i]! - 1 > r) {
        l = i;
        r = i + z[i]! - 1;
      }
    }
    return z;
  }

  public static findExactPatternOccurrencesZ(text: string, pattern: string): number[] {
    if (pattern.length === 0) return [];
    const combined = `${pattern}\u0000${text}`;
    const z = ManacherAndZAlgorithmStringKernel.computeZArray(combined);
    const pLen = pattern.length;
    const hits: number[] = [];
    for (let i = pLen + 1; i < combined.length; i++) {
      if (z[i] === pLen) {
        hits.push(i - pLen - 1);
      }
    }
    return hits;
  }
}
