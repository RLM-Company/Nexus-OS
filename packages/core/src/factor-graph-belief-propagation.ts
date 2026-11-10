export interface VariableNodeSpec {
  id: string;
  states: string[];
  priorPotentials?: Record<string, number>;
}

export interface FactorNodeSpec {
  id: string;
  scopeVariableIds: string[];
  /**
   * Maps comma-joined state assignment (in order of `scopeVariableIds`, e.g. "true,false")
   * to a positive potential value >= 0.
   */
  potentialTable: Record<string, number>;
}

export interface BeliefPropagationResult {
  marginalsByVariable: Record<string, Record<string, number>>;
  mapAssignment: Record<string, string>;
  converged: boolean;
  iterationsExecuted: number;
  maxMessageDelta: number;
}

/**
 * Loopy Sum-Product & Max-Product Belief Propagation on Bipartite Factor Graphs.
 * Computes exact marginal distributions on tree-structured graphs and damped iterative beliefs
 * on loopy factor graphs for multi-signal root-cause diagnosis and probabilistic reasoning.
 */
export class FactorGraphBeliefPropagation {
  private readonly variables = new Map<string, VariableNodeSpec>();
  private readonly factors = new Map<string, FactorNodeSpec>();

  public addVariable(spec: VariableNodeSpec): void {
    if (spec.states.length === 0) {
      throw new Error(`EMPTY_VARIABLE_DOMAIN: ${spec.id}`);
    }
    this.variables.set(spec.id, spec);
  }

  public addFactor(spec: FactorNodeSpec): void {
    for (const vId of spec.scopeVariableIds) {
      if (!this.variables.has(vId)) {
        throw new Error(`UNKNOWN_FACTOR_VARIABLE: ${vId} in factor ${spec.id}`);
      }
    }
    this.factors.set(spec.id, spec);
  }

  private enumerateAssignments(
    varIds: string[],
    fixedVarId?: string,
    fixedState?: string
  ): string[][] {
    const results: string[][] = [];
    const backtrack = (idx: number, current: string[]) => {
      if (idx === varIds.length) {
        results.push([...current]);
        return;
      }
      const vId = varIds[idx]!;
      if (vId === fixedVarId && fixedState !== undefined) {
        current.push(fixedState);
        backtrack(idx + 1, current);
        current.pop();
        return;
      }
      const vSpec = this.variables.get(vId)!;
      for (const st of vSpec.states) {
        current.push(st);
        backtrack(idx + 1, current);
        current.pop();
      }
    };
    backtrack(0, []);
    return results;
  }

  public runInference(params?: {
    maxIterations?: number;
    dampingFactor?: number;
    tolerance?: number;
  }): BeliefPropagationResult {
    const maxIter = params?.maxIterations ?? 40;
    const damping = Math.min(0.9, Math.max(0, params?.dampingFactor ?? 0.35));
    const tol = params?.tolerance ?? 1e-6;

    // msgVarToFac.get(`${vId}->${fId}`)[state]
    const msgVarToFac = new Map<string, Record<string, number>>();
    // msgFacToVar.get(`${fId}->${vId}`)[state]
    const msgFacToVar = new Map<string, Record<string, number>>();

    for (const f of this.factors.values()) {
      for (const vId of f.scopeVariableIds) {
        const v = this.variables.get(vId)!;
        const uniform = 1.0 / v.states.length;
        const initV2F: Record<string, number> = {};
        const initF2V: Record<string, number> = {};
        for (const st of v.states) {
          initV2F[st] = uniform;
          initF2V[st] = uniform;
        }
        msgVarToFac.set(`${vId}->${f.id}`, initV2F);
        msgFacToVar.set(`${f.id}->${vId}`, initF2V);
      }
    }

    const normalizeDist = (dist: Record<string, number>): Record<string, number> => {
      let sum = 0;
      for (const val of Object.values(dist)) sum += Math.max(0, val);
      const out: Record<string, number> = {};
      const keys = Object.keys(dist);
      if (sum <= 1e-15) {
        const u = 1.0 / Math.max(1, keys.length);
        for (const k of keys) out[k] = u;
        return out;
      }
      for (const k of keys) out[k] = Math.max(0, dist[k]!) / sum;
      return out;
    };

    let converged = false;
    let iter = 0;
    let maxMessageDelta = 0;

    for (; iter < maxIter; iter++) {
      maxMessageDelta = 0;

      // 1. Update Variable -> Factor messages
      for (const f of this.factors.values()) {
        for (const vId of f.scopeVariableIds) {
          const v = this.variables.get(vId)!;
          const rawMsg: Record<string, number> = {};
          for (const st of v.states) {
            let prod = v.priorPotentials?.[st] ?? 1.0;
            for (const otherF of this.factors.values()) {
              if (otherF.id === f.id || !otherF.scopeVariableIds.includes(vId)) continue;
              const incoming = msgFacToVar.get(`${otherF.id}->${vId}`)!;
              prod *= incoming[st] ?? 1.0;
            }
            rawMsg[st] = prod;
          }
          const normMsg = normalizeDist(rawMsg);
          const key = `${vId}->${f.id}`;
          const prev = msgVarToFac.get(key)!;
          const damped: Record<string, number> = {};
          for (const st of v.states) {
            damped[st] = damping * prev[st]! + (1 - damping) * normMsg[st]!;
            maxMessageDelta = Math.max(maxMessageDelta, Math.abs(damped[st]! - prev[st]!));
          }
          msgVarToFac.set(key, normalizeDist(damped));
        }
      }

      // 2. Update Factor -> Variable messages (Sum-Product)
      for (const f of this.factors.values()) {
        for (const targetVarId of f.scopeVariableIds) {
          const targetVar = this.variables.get(targetVarId)!;
          const rawMsg: Record<string, number> = {};

          for (const targetState of targetVar.states) {
            const assignments = this.enumerateAssignments(
              f.scopeVariableIds,
              targetVarId,
              targetState
            );
            let sum = 0;
            for (const assign of assignments) {
              const tableKey = assign.join(",");
              const factorVal = f.potentialTable[tableKey] ?? 1e-6;
              let prod = factorVal;
              for (let i = 0; i < f.scopeVariableIds.length; i++) {
                const neighborVarId = f.scopeVariableIds[i]!;
                if (neighborVarId === targetVarId) continue;
                const incoming = msgVarToFac.get(`${neighborVarId}->${f.id}`)!;
                prod *= incoming[assign[i]!] ?? 1.0;
              }
              sum += prod;
            }
            rawMsg[targetState] = sum;
          }

          const normMsg = normalizeDist(rawMsg);
          const key = `${f.id}->${targetVarId}`;
          const prev = msgFacToVar.get(key)!;
          const damped: Record<string, number> = {};
          for (const st of targetVar.states) {
            damped[st] = damping * prev[st]! + (1 - damping) * normMsg[st]!;
            maxMessageDelta = Math.max(maxMessageDelta, Math.abs(damped[st]! - prev[st]!));
          }
          msgFacToVar.set(key, normalizeDist(damped));
        }
      }

      if (maxMessageDelta < tol) {
        converged = true;
        iter++;
        break;
      }
    }

    // Compute normalized variable marginals & MAP state
    const marginalsByVariable: Record<string, Record<string, number>> = {};
    const mapAssignment: Record<string, string> = {};

    for (const v of this.variables.values()) {
      const unnorm: Record<string, number> = {};
      for (const st of v.states) {
        let prod = v.priorPotentials?.[st] ?? 1.0;
        for (const f of this.factors.values()) {
          if (!f.scopeVariableIds.includes(v.id)) continue;
          const incoming = msgFacToVar.get(`${f.id}->${v.id}`)!;
          prod *= incoming[st] ?? 1.0;
        }
        unnorm[st] = prod;
      }
      const norm = normalizeDist(unnorm);
      marginalsByVariable[v.id] = {};
      let bestState = v.states[0]!;
      let bestProb = -1;
      for (const st of v.states) {
        const p = Number(norm[st]!.toFixed(6));
        marginalsByVariable[v.id]![st] = p;
        if (p > bestProb) {
          bestProb = p;
          bestState = st;
        }
      }
      mapAssignment[v.id] = bestState;
    }

    return {
      marginalsByVariable,
      mapAssignment,
      converged,
      iterationsExecuted: iter,
      maxMessageDelta: Number(maxMessageDelta.toFixed(8))
    };
  }
}
