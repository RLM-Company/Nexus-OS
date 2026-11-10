interface BkTreeNode {
  word: string;
  childrenByDistance: Map<number, BkTreeNode>;
}

/**
 * Optimal String Alignment / Restricted Damerau-Levenshtein Distance (including Adjacent Transpositions)
 * + Burkhard-Keller (BK-Tree) Metric Space Index for Sub-Linear Fuzzy Typo Correction.
 */
export class DamerauLevenshteinFuzzyAutomaton {
  private root: BkTreeNode | null = null;

  public static distance(a: string, b: string): number {
    const n = a.length;
    const m = b.length;
    if (n === 0) return m;
    if (m === 0) return n;

    const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = 0; i <= n; i++) dp[i]![0] = i;
    for (let j = 0; j <= m; j++) dp[0]![j] = j;

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let best = Math.min(
          dp[i - 1]![j]! + 1, // deletion
          dp[i]![j - 1]! + 1, // insertion
          dp[i - 1]![j - 1]! + cost // substitution
        );

        // Adjacent transposition check
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          best = Math.min(best, dp[i - 2]![j - 2]! + 1);
        }
        dp[i]![j] = best;
      }
    }

    return dp[n]![m]!;
  }

  public addWord(word: string): void {
    if (this.root === null) {
      this.root = { word, childrenByDistance: new Map() };
      return;
    }

    let curr = this.root;
    while (true) {
      const d = DamerauLevenshteinFuzzyAutomaton.distance(word, curr.word);
      if (d === 0) return;
      const next = curr.childrenByDistance.get(d);
      if (!next) {
        curr.childrenByDistance.set(d, { word, childrenByDistance: new Map() });
        return;
      }
      curr = next;
    }
  }

  public searchWithinDistance(
    query: string,
    maxEditDistance: number
  ): Array<{ word: string; editDistance: number }> {
    if (this.root === null) return [];
    const matches: Array<{ word: string; editDistance: number }> = [];

    const visit = (node: BkTreeNode) => {
      const d = DamerauLevenshteinFuzzyAutomaton.distance(query, node.word);
      if (d <= maxEditDistance) {
        matches.push({ word: node.word, editDistance: d });
      }
      const minChildDist = Math.max(1, d - maxEditDistance);
      const maxChildDist = d + maxEditDistance;
      for (const [edgeDist, child] of node.childrenByDistance.entries()) {
        if (edgeDist >= minChildDist && edgeDist <= maxChildDist) {
          visit(child);
        }
      }
    };

    visit(this.root);
    return matches.sort(
      (a, b) => a.editDistance - b.editDistance || a.word.localeCompare(b.word)
    );
  }
}
