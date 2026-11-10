export type PcfgRule =
  | { kind: "terminal"; lhs: string; terminal: string; probability: number }
  | { kind: "binary"; lhs: string; rightA: string; rightB: string; probability: number };

export interface CykParseTree {
  symbol: string;
  probability: number;
  terminal?: string;
  left?: CykParseTree;
  right?: CykParseTree;
}

/**
 * Cocke-Younger-Kasami (CYK) Probabilistic Context-Free Grammar (PCFG) Inside-Viterbi Chart Parser.
 * Finds the maximum-likelihood parse tree in O(N^3 * |R|) time over Chomsky Normal Form (CNF) rules.
 */
export class ProbabilisticCykGrammarParser {
  private readonly startSymbol: string;
  private readonly rules: PcfgRule[];

  constructor(startSymbol: string, rules: PcfgRule[]) {
    this.startSymbol = startSymbol;
    this.rules = rules;
  }

  public parseMostLikelyTree(tokens: string[]): {
    accepted: boolean;
    bestProbability: number;
    tree: CykParseTree | null;
  } {
    const n = tokens.length;
    if (n === 0) {
      return { accepted: false, bestProbability: 0, tree: null };
    }

    // table[length - 1][startIdx].get(nonTerminal) -> CykParseTree
    const table: Array<Array<Map<string, CykParseTree>>> = Array.from(
      { length: n },
      (_, l) => Array.from({ length: n - l }, () => new Map())
    );

    // Span length = 1 (terminal rules)
    for (let i = 0; i < n; i++) {
      const tok = tokens[i]!;
      for (const r of this.rules) {
        if (r.kind === "terminal" && r.terminal === tok) {
          const prev = table[0]![i]!.get(r.lhs);
          if (!prev || r.probability > prev.probability) {
            table[0]![i]!.set(r.lhs, {
              symbol: r.lhs,
              probability: r.probability,
              terminal: tok
            });
          }
        }
      }
    }

    // Span lengths 2..n (binary rules A -> B C)
    for (let len = 2; len <= n; len++) {
      for (let i = 0; i <= n - len; i++) {
        const cell = table[len - 1]![i]!;
        for (let split = 1; split < len; split++) {
          const leftCell = table[split - 1]![i]!;
          const rightCell = table[len - split - 1]![i + split]!;

          for (const r of this.rules) {
            if (r.kind !== "binary") continue;
            const leftSub = leftCell.get(r.rightA);
            const rightSub = rightCell.get(r.rightB);
            if (!leftSub || !rightSub) continue;

            const candProb = r.probability * leftSub.probability * rightSub.probability;
            const existing = cell.get(r.lhs);
            if (!existing || candProb > existing.probability) {
              cell.set(r.lhs, {
                symbol: r.lhs,
                probability: Number(candProb.toFixed(9)),
                left: leftSub,
                right: rightSub
              });
            }
          }
        }
      }
    }

    const rootTree = table[n - 1]![0]!.get(this.startSymbol) ?? null;
    return {
      accepted: rootTree !== null,
      bestProbability: rootTree ? rootTree.probability : 0,
      tree: rootTree
    };
  }
}
