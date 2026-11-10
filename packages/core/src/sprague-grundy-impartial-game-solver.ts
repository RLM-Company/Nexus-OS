export interface ImpartialDagGameGraph {
  transitions: Record<string, string[]>;
}

export interface CompositeGameAnalysis {
  grundyByNode: Record<string, number>;
  compositeXorNimSum: number;
  firstPlayerHasWinningStrategy: boolean;
  winningMove: { componentIndex: number; fromState: string; toState: string } | null;
}

/**
 * Sprague-Grundy Theorem & Minimum Excluded (mex) Nimber Solver for impartial DAG games.
 * Evaluates Grundy values G(u) = mex({ G(v) : (u -> v) }) and solves disjunctive sums
 * of independent games via Bouton's XOR nim-sum theorem.
 */
export class SpragueGrundyNimberGameEngine {
  public static mex(values: Iterable<number>): number {
    const present = new Set<number>(values);
    let m = 0;
    while (present.has(m)) {
      m++;
    }
    return m;
  }

  public static computeGrundyValues(game: ImpartialDagGameGraph): Record<string, number> {
    const memo = new Map<string, number>();
    const visiting = new Set<string>();

    const evalState = (u: string): number => {
      if (memo.has(u)) return memo.get(u)!;
      if (visiting.has(u)) {
        throw new Error(`Cycle detected in impartial game graph at state '${u}'`);
      }
      visiting.add(u);
      const nextStates = game.transitions[u] ?? [];
      const childNimbers = nextStates.map((v) => evalState(v));
      const g = SpragueGrundyNimberGameEngine.mex(childNimbers);
      visiting.delete(u);
      memo.set(u, g);
      return g;
    };

    for (const state of Object.keys(game.transitions)) {
      evalState(state);
    }

    return Object.fromEntries(memo.entries());
  }

  public static analyzeCompositeDisjunctiveGame(
    game: ImpartialDagGameGraph,
    componentStates: string[]
  ): CompositeGameAnalysis {
    const grundyByNode = SpragueGrundyNimberGameEngine.computeGrundyValues(game);

    let xorSum = 0;
    for (const s of componentStates) {
      xorSum ^= grundyByNode[s] ?? 0;
    }

    if (xorSum === 0) {
      return {
        grundyByNode,
        compositeXorNimSum: 0,
        firstPlayerHasWinningStrategy: false,
        winningMove: null
      };
    }

    // Find a move in some component i from s_i -> s'_i such that G(s'_i) == G(s_i) ^ xorSum
    for (let i = 0; i < componentStates.length; i++) {
      const current = componentStates[i]!;
      const currentG = grundyByNode[current] ?? 0;
      const targetG = currentG ^ xorSum;
      for (const nextState of game.transitions[current] ?? []) {
        if ((grundyByNode[nextState] ?? 0) === targetG) {
          return {
            grundyByNode,
            compositeXorNimSum: xorSum,
            firstPlayerHasWinningStrategy: true,
            winningMove: {
              componentIndex: i,
              fromState: current,
              toState: nextState
            }
          };
        }
      }
    }

    return {
      grundyByNode,
      compositeXorNimSum: xorSum,
      firstPlayerHasWinningStrategy: true,
      winningMove: null
    };
  }
}
