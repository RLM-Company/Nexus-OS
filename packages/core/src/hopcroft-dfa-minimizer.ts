export interface DfaAutomatonSpec {
  states: string[];
  alphabet: string[];
  startState: string;
  acceptStates: string[];
  transitions: Record<string, Record<string, string>>;
}

export interface MinimizedDfaResult {
  originalStateCount: number;
  minimizedStateCount: number;
  equivalencePartitions: string[][];
  minimizedDfa: DfaAutomatonSpec;
}

/**
 * Hopcroft Partition-Refinement DFA Minimization & Linear-Time O(N) Non-Backtracking Automaton Runner.
 * Collapses indistinguishable DFA states into minimal equivalence classes and executes
 * pattern matching in guaranteed O(N) time with zero backtracking (100% immune to ReDoS).
 */
export class RegexNfaToMinDfaCompiler {
  public static minimizeDfa(dfa: DfaAutomatonSpec): MinimizedDfaResult {
    // 1. Prune unreachable states via BFS from startState
    const reachable = new Set<string>([dfa.startState]);
    const queue: string[] = [dfa.startState];
    while (queue.length > 0) {
      const s = queue.shift()!;
      for (const sym of dfa.alphabet) {
        const next = dfa.transitions[s]?.[sym];
        if (next && !reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }

    const activeStates = dfa.states.filter((s) => reachable.has(s));
    const acceptSet = new Set(dfa.acceptStates.filter((s) => reachable.has(s)));
    const nonAcceptStates = activeStates.filter((s) => !acceptSet.has(s));

    let partitions: string[][] = [];
    if (acceptSet.size > 0) partitions.push(Array.from(acceptSet).sort());
    if (nonAcceptStates.length > 0) partitions.push(nonAcceptStates.sort());

    // 2. Iterative Hopcroft Equivalence Partition Refinement
    let changed = true;
    while (changed) {
      changed = false;
      const stateToPartIdx = new Map<string, number>();
      for (let i = 0; i < partitions.length; i++) {
        for (const st of partitions[i]!) {
          stateToPartIdx.set(st, i);
        }
      }

      const nextPartitions: string[][] = [];
      for (const group of partitions) {
        if (group.length <= 1) {
          nextPartitions.push(group);
          continue;
        }

        const subGroups = new Map<string, string[]>();
        for (const st of group) {
          const sig = dfa.alphabet
            .map((sym) => {
              const target = dfa.transitions[st]?.[sym];
              return target !== undefined ? String(stateToPartIdx.get(target) ?? -1) : "-1";
            })
            .join("|");
          const bucket = subGroups.get(sig) ?? [];
          bucket.push(st);
          subGroups.set(sig, bucket);
        }

        if (subGroups.size > 1) {
          changed = true;
        }
        for (const sub of subGroups.values()) {
          nextPartitions.push(sub.sort());
        }
      }
      partitions = nextPartitions;
    }

    // 3. Construct canonical minimized DFA from equivalence classes
    const repByState = new Map<string, string>();
    for (const part of partitions) {
      const repName = part.join("_");
      for (const st of part) {
        repByState.set(st, repName);
      }
    }

    const minStates = partitions.map((p) => p.join("_"));
    const minStart = repByState.get(dfa.startState)!;
    const minAccepts = Array.from(
      new Set(Array.from(acceptSet).map((s) => repByState.get(s)!))
    );
    const minTransitions: Record<string, Record<string, string>> = {};

    for (const part of partitions) {
      const rep = part.join("_");
      const sampleState = part[0]!;
      minTransitions[rep] = {};
      for (const sym of dfa.alphabet) {
        const t = dfa.transitions[sampleState]?.[sym];
        if (t && repByState.has(t)) {
          minTransitions[rep]![sym] = repByState.get(t)!;
        }
      }
    }

    return {
      originalStateCount: dfa.states.length,
      minimizedStateCount: minStates.length,
      equivalencePartitions: partitions,
      minimizedDfa: {
        states: minStates,
        alphabet: [...dfa.alphabet],
        startState: minStart,
        acceptStates: minAccepts,
        transitions: minTransitions
      }
    };
  }

  public static executeLinearDfa(dfa: DfaAutomatonSpec, inputSymbols: string[]): boolean {
    let current = dfa.startState;
    for (const sym of inputSymbols) {
      const next = dfa.transitions[current]?.[sym];
      if (!next) return false;
      current = next;
    }
    return dfa.acceptStates.includes(current);
  }
}
