export interface PetriPlace {
  id: string;
  initialTokens: number;
  capacity?: number; // Optional hard upper bound per place
  isTerminalGoal?: boolean;
}

export interface PetriArc {
  placeId: string;
  weight?: number;
  inhibitor?: boolean; // Only applicable to input arcs: transition enabled only when place has < weight tokens
}

export interface PetriTransition {
  id: string;
  name: string;
  inputs: PetriArc[];
  outputs: PetriArc[];
}

export interface PetriNetDefinition {
  places: PetriPlace[];
  transitions: PetriTransition[];
}

export interface DeadlockTrace {
  marking: Record<string, number>;
  firingSequence: string[];
}

export interface BoundednessViolation {
  placeId: string;
  tokenCount: number;
  boundLimit: number;
  firingSequence: string[];
}

export interface PetriNetVerificationReport {
  valid: boolean;
  exploredMarkingsCount: number;
  stateSpaceExhausted: boolean;
  isDeadlockFree: boolean;
  isKBounded: boolean;
  maxTokensObserved: number;
  deadTransitions: string[];
  deadlocks: DeadlockTrace[];
  boundednessViolations: BoundednessViolation[];
}

/**
 * Formal Petri Net Reachability, Deadlock, Boundedness & Liveness Verifier
 * for concurrent multi-agent workflows and shared OS/Vault mutex locks.
 */
export class PetriNetWorkflowVerifier {
  private readonly places: Map<string, PetriPlace>;
  private readonly orderedPlaceIds: string[];
  private readonly transitions: PetriTransition[];

  constructor(definition: PetriNetDefinition) {
    this.places = new Map();
    for (const p of definition.places) {
      this.places.set(p.id, p);
    }
    this.orderedPlaceIds = Array.from(this.places.keys()).sort();
    this.transitions = definition.transitions;
  }

  public isTransitionEnabled(
    transition: PetriTransition,
    marking: ReadonlyMap<string, number>
  ): boolean {
    for (const input of transition.inputs) {
      const tokens = marking.get(input.placeId) ?? 0;
      const weight = input.weight ?? 1;
      if (input.inhibitor) {
        if (tokens >= weight) return false;
      } else {
        if (tokens < weight) return false;
      }
    }
    return true;
  }

  public fireTransition(
    transition: PetriTransition,
    marking: ReadonlyMap<string, number>
  ): Map<string, number> {
    if (!this.isTransitionEnabled(transition, marking)) {
      throw new Error(`TRANSITION_NOT_ENABLED: ${transition.id}`);
    }
    const next = new Map<string, number>(marking);
    for (const input of transition.inputs) {
      if (input.inhibitor) continue;
      const weight = input.weight ?? 1;
      next.set(input.placeId, (next.get(input.placeId) ?? 0) - weight);
    }
    for (const output of transition.outputs) {
      const weight = output.weight ?? 1;
      next.set(output.placeId, (next.get(output.placeId) ?? 0) + weight);
    }
    return next;
  }

  private serializeMarking(marking: ReadonlyMap<string, number>): string {
    return this.orderedPlaceIds.map((id) => `${id}:${marking.get(id) ?? 0}`).join("|");
  }

  private markingToObject(marking: ReadonlyMap<string, number>): Record<string, number> {
    const obj: Record<string, number> = {};
    for (const id of this.orderedPlaceIds) {
      obj[id] = marking.get(id) ?? 0;
    }
    return obj;
  }

  private isGoalMarking(marking: ReadonlyMap<string, number>): boolean {
    let hasGoalPlaces = false;
    for (const p of this.places.values()) {
      if (p.isTerminalGoal) {
        hasGoalPlaces = true;
        if ((marking.get(p.id) ?? 0) > 0) {
          return true;
        }
      }
    }
    return !hasGoalPlaces;
  }

  /**
   * Explores the reachable state graph R(M0) via BFS to formally verify:
   * 1. Deadlock-freedom (no reachable non-goal marking has 0 enabled transitions)
   * 2. k-Boundedness (no place accumulates > k tokens or exceeds its capacity)
   * 3. L1 Transition Liveness (identifies any transitions that can never fire)
   */
  public verifyReachability(options?: {
    maxStates?: number;
    kBound?: number;
  }): PetriNetVerificationReport {
    const maxStates = options?.maxStates ?? 2000;
    const defaultKBound = options?.kBound ?? 10;

    const initialMarking = new Map<string, number>();
    for (const [id, place] of this.places.entries()) {
      initialMarking.set(id, place.initialTokens);
    }

    const visited = new Set<string>();
    const queue: Array<{ marking: Map<string, number>; trace: string[] }> = [];

    const initKey = this.serializeMarking(initialMarking);
    visited.add(initKey);
    queue.push({ marking: initialMarking, trace: [] });

    const firedTransitions = new Set<string>();
    const deadlocks: DeadlockTrace[] = [];
    const boundednessViolations: BoundednessViolation[] = [];
    let maxTokensObserved = 0;

    while (queue.length > 0 && visited.size <= maxStates) {
      const current = queue.shift()!;
      const { marking, trace } = current;

      // Check k-boundedness on current marking
      let hasViolationHere = false;
      for (const [placeId, count] of marking.entries()) {
        if (count > maxTokensObserved) {
          maxTokensObserved = count;
        }
        const placeSpec = this.places.get(placeId);
        const limit = placeSpec?.capacity ?? defaultKBound;
        if (count > limit) {
          boundednessViolations.push({
            placeId,
            tokenCount: count,
            boundLimit: limit,
            firingSequence: trace
          });
          hasViolationHere = true;
        }
      }
      if (hasViolationHere) {
        continue; // Do not expand unbounded runaway paths further
      }

      const enabledTransitions = this.transitions.filter((t) =>
        this.isTransitionEnabled(t, marking)
      );

      if (enabledTransitions.length === 0) {
        if (!this.isGoalMarking(marking)) {
          deadlocks.push({
            marking: this.markingToObject(marking),
            firingSequence: trace
          });
        }
        continue;
      }

      for (const t of enabledTransitions) {
        firedTransitions.add(t.id);
        const nextMarking = this.fireTransition(t, marking);
        const key = this.serializeMarking(nextMarking);
        if (!visited.has(key)) {
          visited.add(key);
          if (visited.size <= maxStates) {
            queue.push({
              marking: nextMarking,
              trace: [...trace, t.id]
            });
          }
        }
      }
    }

    const deadTransitions = this.transitions
      .map((t) => t.id)
      .filter((id) => !firedTransitions.has(id));

    const isDeadlockFree = deadlocks.length === 0;
    const isKBounded = boundednessViolations.length === 0;
    const valid = isDeadlockFree && isKBounded && deadTransitions.length === 0;

    return {
      valid,
      exploredMarkingsCount: visited.size,
      stateSpaceExhausted: queue.length === 0,
      isDeadlockFree,
      isKBounded,
      maxTokensObserved,
      deadTransitions,
      deadlocks,
      boundednessViolations
    };
  }
}
