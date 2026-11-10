/**
 * Jaro-Winkler Prefix-Boosted Similarity & Soundex/Metaphone Phonetic Entity Profiler.
 * Computes Jaro similarity J(s1, s2) = 1/3 * (m/|s1| + m/|s2| + (m - t)/m) and
 * Winkler prefix boost JW = J + l * p * (1 - J) for l <= 4 common prefix chars.
 */
export class JaroWinklerAndPhoneticCodeProfiler {
  public static jaroSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1;
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0;

    const matchDistance = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
    const s1Matches = new Array<boolean>(len1).fill(false);
    const s2Matches = new Array<boolean>(len2).fill(false);

    let matches = 0;
    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, len2);
      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0;

    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    const m = matches;
    const jaro = (m / len1 + m / len2 + (m - transpositions / 2) / m) / 3;
    return Number(jaro.toFixed(6));
  }

  public static jaroWinklerSimilarity(
    s1: string,
    s2: string,
    prefixScalingP: number = 0.1
  ): number {
    const jaro = JaroWinklerAndPhoneticCodeProfiler.jaroSimilarity(s1, s2);
    let prefixLen = 0;
    const maxPrefix = Math.min(4, s1.length, s2.length);
    while (prefixLen < maxPrefix && s1[prefixLen] === s2[prefixLen]) {
      prefixLen++;
    }
    return Number((jaro + prefixLen * prefixScalingP * (1 - jaro)).toFixed(6));
  }

  public static americanSoundex(word: string): string {
    const clean = word.toUpperCase().replace(/[^A-Z]/g, "");
    if (clean.length === 0) return "0000";

    const firstLetter = clean[0]!;
    const mapChar = (c: string): string => {
      if ("BFPV".includes(c)) return "1";
      if ("CGJKQSXZ".includes(c)) return "2";
      if ("DT".includes(c)) return "3";
      if (c === "L") return "4";
      if ("MN".includes(c)) return "5";
      if (c === "R") return "6";
      return "0";
    };

    let code = firstLetter;
    let prevDigit = mapChar(firstLetter);

    for (let i = 1; i < clean.length && code.length < 4; i++) {
      const ch = clean[i]!;
      if ("HW".includes(ch)) continue;
      const digit = mapChar(ch);
      if (digit !== "0" && digit !== prevDigit) {
        code += digit;
      }
      prevDigit = digit;
    }

    return code.padEnd(4, "0");
  }
}
