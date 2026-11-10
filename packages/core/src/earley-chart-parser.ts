export interface CfgProductionRule {
  lhs: string;
  rhs: string[]; // Non-terminals and terminals
}

export interface EarleyParseResult {
  accepted: boolean;
  completedRootCount: number;
  expectedNextSymbols: string[];
  chartSizesByPosition: number[];
}

interface EarleyItem {
  lhs: string;
  rhs: string[];
  dot: number;
  origin: number;
}

function itemKey(item: EarleyItem): string {
  return `${item.lhs}->${item.rhs.join(" ")}@${item.dot}#${item.origin}`;
}

/**
 * General Context-Free Grammar (CFG) Earley Chart Parser (Predictor, Scanner, Completer).
 * Parses arbitrary context-free grammars (including left-recursive and ambiguous grammars)
 * and computes valid next-token syntax completions at the cursor position.
 */
export class EarleyChartParser {
  private readonly startSymbol: string;
  private readonly rules: CfgProductionRule[];
  private readonly nonTerminals: Set<string>;

  constructor(startSymbol: string, rules: CfgProductionRule[]) {
    this.startSymbol = startSymbol;
    this.rules = rules;
    this.nonTerminals = new Set(rules.map((r) => r.lhs));
  }

  public parse(tokens: string[]): EarleyParseResult {
    const n = tokens.length;
    const chart: EarleyItem[][] = Array.from({ length: n + 1 }, () => []);
    const chartSets: Set<string>[] = Array.from({ length: n + 1 }, () => new Set<string>());

    const addToChart = (pos: number, item: EarleyItem): boolean => {
      const k = itemKey(item);
      if (chartSets[pos]!.has(k)) return false;
      chartSets[pos]!.add(k);
      chart[pos]!.push(item);
      return true;
    };

    // Seed chart[0] with start symbol productions
    for (const r of this.rules) {
      if (r.lhs === this.startSymbol) {
        addToChart(0, { lhs: r.lhs, rhs: r.rhs, dot: 0, origin: 0 });
      }
    }

    for (let i = 0; i <= n; i++) {
      // Process queue at chart[i] dynamically as Predictor and Completer append items
      for (let idx = 0; idx < chart[i]!.length; idx++) {
        const state = chart[i]![idx]!;
        const isComplete = state.dot >= state.rhs.length;

        if (!isComplete) {
          const nextSym = state.rhs[state.dot]!;
          if (this.nonTerminals.has(nextSym)) {
            // PREDICTOR: expand non-terminal at position i
            for (const rule of this.rules) {
              if (rule.lhs === nextSym) {
                addToChart(i, {
                  lhs: rule.lhs,
                  rhs: rule.rhs,
                  dot: 0,
                  origin: i
                });
              }
            }
          } else if (i < n && tokens[i] === nextSym) {
            // SCANNER: match terminal token at position i and advance into chart[i + 1]
            addToChart(i + 1, {
              lhs: state.lhs,
              rhs: state.rhs,
              dot: state.dot + 1,
              origin: state.origin
            });
          }
        } else {
          // COMPLETER: advance all items in chart[state.origin] waiting for state.lhs
          const originBucket = chart[state.origin]!;
          for (let j = 0; j < originBucket.length; j++) {
            const prevItem = originBucket[j]!;
            if (prevItem.dot < prevItem.rhs.length && prevItem.rhs[prevItem.dot] === state.lhs) {
              addToChart(i, {
                lhs: prevItem.lhs,
                rhs: prevItem.rhs,
                dot: prevItem.dot + 1,
                origin: prevItem.origin
              });
            }
          }
        }
      }
    }

    const finalBucket = chart[n]!;
    let completedRootCount = 0;
    const expectedNextSet = new Set<string>();

    for (const item of finalBucket) {
      if (item.lhs === this.startSymbol && item.origin === 0 && item.dot === item.rhs.length) {
        completedRootCount++;
      }
      if (item.dot < item.rhs.length) {
        const nextSym = item.rhs[item.dot]!;
        if (!this.nonTerminals.has(nextSym)) {
          expectedNextSet.add(nextSym);
        }
      }
    }

    return {
      accepted: completedRootCount > 0,
      completedRootCount,
      expectedNextSymbols: Array.from(expectedNextSet).sort(),
      chartSizesByPosition: chart.map((c) => c.length)
    };
  }
}
