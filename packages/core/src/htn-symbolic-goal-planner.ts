export interface PrimitiveOperator {
  name: string;
  preconditions: string[]; // Facts that must be present in current state
  negatedPreconditions?: string[]; // Facts that must NOT be present
  addEffects: string[]; // Facts added to state after execution
  deleteEffects?: string[]; // Facts removed from state after execution
  cost?: number;
}

export interface CompoundTaskMethod {
  compoundTaskName: string;
  methodName: string;
  preconditions: string[];
  subtasks: string[]; // Can reference either compound task names or primitive operator names
}

export interface SynthesizedHtnPlan {
  achievable: boolean;
  orderedOperatorNames: string[];
  finalStateFacts: string[];
  totalCost: number;
  expandedNodes: number;
}

/**
 * Hierarchical Task Network (HTN) & STRIPS/PDDL Symbolic Goal Planner.
 * Decomposes high-level compound tasks into primitive operators while verifying
 * precondition-effect state transitions and finding minimum-cost A* plans to reach goal facts.
 */
export class HtnSymbolicGoalPlanner {
  private readonly operators = new Map<string, PrimitiveOperator>();
  private readonly methodsByCompound = new Map<string, CompoundTaskMethod[]>();

  constructor(params: {
    operators: PrimitiveOperator[];
    methods?: CompoundTaskMethod[];
  }) {
    for (const op of params.operators) {
      this.operators.set(op.name, op);
    }
    for (const m of params.methods ?? []) {
      const list = this.methodsByCompound.get(m.compoundTaskName) ?? [];
      list.push(m);
      this.methodsByCompound.set(m.compoundTaskName, list);
    }
  }

  private static stateHasAll(state: ReadonlySet<string>, required: string[], negated?: string[]): boolean {
    for (const req of required) {
      if (!state.has(req)) return false;
    }
    for (const neg of negated ?? []) {
      if (state.has(neg)) return false;
    }
    return true;
  }

  private static applyOperatorEffects(state: ReadonlySet<string>, op: PrimitiveOperator): Set<string> {
    const next = new Set(state);
    for (const del of op.deleteEffects ?? []) {
      next.delete(del);
    }
    for (const add of op.addEffects) {
      next.add(add);
    }
    return next;
  }

  /**
   * Decomposes an initial task network `taskQueue` from `initialStateFacts` using HTN total-order
   * forward decomposition with backtracking.
   */
  public decomposeHtnTaskNetwork(params: {
    initialStateFacts: string[];
    taskQueue: string[];
    maxExpansions?: number;
  }): SynthesizedHtnPlan {
    const maxExpansions = params.maxExpansions ?? 2000;
    let expandedNodes = 0;

    const search = (
      state: Set<string>,
      remainingTasks: string[],
      accumulatedOps: string[],
      accumulatedCost: number
    ): SynthesizedHtnPlan | null => {
      if (expandedNodes >= maxExpansions) return null;
      expandedNodes++;

      if (remainingTasks.length === 0) {
        return {
          achievable: true,
          orderedOperatorNames: accumulatedOps,
          finalStateFacts: Array.from(state).sort(),
          totalCost: accumulatedCost,
          expandedNodes
        };
      }

      const [currentTask, ...restTasks] = remainingTasks;

      // Case 1: Primitive operator
      const primitive = this.operators.get(currentTask!);
      if (primitive) {
        if (!HtnSymbolicGoalPlanner.stateHasAll(state, primitive.preconditions, primitive.negatedPreconditions)) {
          return null;
        }
        const nextState = HtnSymbolicGoalPlanner.applyOperatorEffects(state, primitive);
        return search(
          nextState,
          restTasks,
          [...accumulatedOps, primitive.name],
          accumulatedCost + (primitive.cost ?? 1)
        );
      }

      // Case 2: Compound task -> try each applicable method
      const methods = this.methodsByCompound.get(currentTask!) ?? [];
      for (const method of methods) {
        if (HtnSymbolicGoalPlanner.stateHasAll(state, method.preconditions)) {
          const res = search(
            state,
            [...method.subtasks, ...restTasks],
            accumulatedOps,
            accumulatedCost
          );
          if (res) return res;
        }
      }

      return null;
    };

    const result = search(new Set(params.initialStateFacts), params.taskQueue, [], 0);
    if (!result) {
      return {
        achievable: false,
        orderedOperatorNames: [],
        finalStateFacts: params.initialStateFacts,
        totalCost: 0,
        expandedNodes
      };
    }
    return result;
  }

  /**
   * Classical STRIPS A* Heuristic Goal Planner: finds the shortest/lowest-cost sequence
   * of primitive operators to achieve all `goalFacts` from `initialStateFacts`.
   */
  public planToGoalAStar(params: {
    initialStateFacts: string[];
    goalFacts: string[];
    maxExpansions?: number;
  }): SynthesizedHtnPlan {
    const maxExpansions = params.maxExpansions ?? 2000;
    const goalList = params.goalFacts;

    const heuristic = (state: ReadonlySet<string>): number => {
      let unsatisfied = 0;
      for (const g of goalList) {
        if (!state.has(g)) unsatisfied++;
      }
      return unsatisfied;
    };

    const serializeState = (state: ReadonlySet<string>): string =>
      Array.from(state).sort().join("|");

    const initSet = new Set(params.initialStateFacts);
    const openQueue: Array<{
      state: Set<string>;
      ops: string[];
      gCost: number;
      fScore: number;
    }> = [
      {
        state: initSet,
        ops: [],
        gCost: 0,
        fScore: heuristic(initSet)
      }
    ];

    const bestGByState = new Map<string, number>();
    bestGByState.set(serializeState(initSet), 0);
    let expandedNodes = 0;

    while (openQueue.length > 0 && expandedNodes < maxExpansions) {
      openQueue.sort((a, b) => a.fScore - b.fScore);
      const current = openQueue.shift()!;
      expandedNodes++;

      if (HtnSymbolicGoalPlanner.stateHasAll(current.state, goalList)) {
        return {
          achievable: true,
          orderedOperatorNames: current.ops,
          finalStateFacts: Array.from(current.state).sort(),
          totalCost: current.gCost,
          expandedNodes
        };
      }

      for (const op of this.operators.values()) {
        if (
          !HtnSymbolicGoalPlanner.stateHasAll(
            current.state,
            op.preconditions,
            op.negatedPreconditions
          )
        ) {
          continue;
        }
        const nextState = HtnSymbolicGoalPlanner.applyOperatorEffects(current.state, op);
        const key = serializeState(nextState);
        const nextG = current.gCost + (op.cost ?? 1);
        const prevBestG = bestGByState.get(key);

        if (prevBestG === undefined || nextG < prevBestG) {
          bestGByState.set(key, nextG);
          openQueue.push({
            state: nextState,
            ops: [...current.ops, op.name],
            gCost: nextG,
            fScore: nextG + heuristic(nextState)
          });
        }
      }
    }

    return {
      achievable: false,
      orderedOperatorNames: [],
      finalStateFacts: params.initialStateFacts,
      totalCost: 0,
      expandedNodes
    };
  }
}
