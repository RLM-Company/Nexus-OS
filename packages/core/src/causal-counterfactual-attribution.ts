export interface CausalNodeSpec {
  id: string;
  parents: string[];
  baselineExogenous: number;
  /**
   * Structural equation f_i(parents, u_i): computes node value given parent values and exogenous shock u_i.
   * Defaults to u_i + sum(weights * parent_values) if weights are provided.
   */
  weights?: Record<string, number>;
}

export interface CounterfactualAttributionEntry {
  nodeId: string;
  observedValue: number;
  baselineValue: number;
  localExogenousShock: number;
  counterfactualOutcomeIfBaseline: number;
  totalCausalEffectOnOutcome: number;
  normalizedResponsibilityShare: number;
}

export interface CausalAttributionReport {
  outcomeNodeId: string;
  observedOutcome: number;
  baselineOutcome: number;
  totalOutcomeDeviation: number;
  primaryRootCauseNodeId: string | null;
  attributions: CounterfactualAttributionEntry[];
}

/**
 * Structural Causal Model (SCM) Do-Calculus & Counterfactual Root-Cause Attribution Engine.
 * Evaluates Pearl's do(X = x) interventions and attributes workflow latency/cost/error anomalies
 * across DAG ancestors via structural abduction-action-prediction.
 */
export class CausalCounterfactualEngine {
  private readonly nodes = new Map<string, CausalNodeSpec>();
  private readonly topoOrder: string[];

  constructor(specs: CausalNodeSpec[]) {
    for (const s of specs) {
      this.nodes.set(s.id, s);
    }
    this.topoOrder = this.computeTopologicalOrder();
  }

  private computeTopologicalOrder(): string[] {
    const inDegree = new Map<string, number>();
    const children = new Map<string, string[]>();

    for (const [id, spec] of this.nodes.entries()) {
      inDegree.set(id, spec.parents.length);
      for (const p of spec.parents) {
        if (!this.nodes.has(p)) {
          throw new Error(`UNKNOWN_CAUSAL_PARENT: node '${id}' references missing parent '${p}'`);
        }
        const list = children.get(p) ?? [];
        list.push(id);
        children.set(p, list);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      order.push(cur);
      for (const child of children.get(cur) ?? []) {
        const nextDeg = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, nextDeg);
        if (nextDeg === 0) queue.push(child);
      }
    }

    if (order.length !== this.nodes.size) {
      throw new Error("CAUSAL_GRAPH_CYCLE_DETECTED: SCM must be a Directed Acyclic Graph");
    }
    return order;
  }

  /**
   * Evaluates structural equations forward in topological order under optional Pearl do(X = x) interventions
   * and optional custom exogenous variables U.
   */
  public evaluateForward(options?: {
    doInterventions?: Record<string, number>;
    exogenousOverrides?: Record<string, number>;
  }): Record<string, number> {
    const values: Record<string, number> = {};
    const interventions = options?.doInterventions ?? {};
    const exogenous = options?.exogenousOverrides ?? {};

    for (const id of this.topoOrder) {
      if (id in interventions) {
        // Pearl's do(X = x) operator severs incoming parent edges and fixes X = x
        values[id] = interventions[id]!;
        continue;
      }
      const spec = this.nodes.get(id)!;
      const u = id in exogenous ? exogenous[id]! : spec.baselineExogenous;
      let val = u;
      for (const parentId of spec.parents) {
        const w = spec.weights?.[parentId] ?? 1.0;
        val += w * (values[parentId] ?? 0);
      }
      values[id] = Number(val.toFixed(6));
    }

    return values;
  }

  /**
   * Abducts latent exogenous variables U from observed node measurements:
   * u_i = x_i - \sum_{p \in pa(i)} w_{p,i} x_p.
   */
  public abductExogenousVariables(observedValues: Record<string, number>): Record<string, number> {
    const abductedU: Record<string, number> = {};
    for (const id of this.topoOrder) {
      const spec = this.nodes.get(id)!;
      const obs = observedValues[id];
      if (obs === undefined) {
        throw new Error(`MISSING_OBSERVED_NODE: '${id}' is required for abduction`);
      }
      let parentContrib = 0;
      for (const parentId of spec.parents) {
        const w = spec.weights?.[parentId] ?? 1.0;
        parentContrib += w * (observedValues[parentId] ?? 0);
      }
      abductedU[id] = Number((obs - parentContrib).toFixed(6));
    }
    return abductedU;
  }

  /**
   * Performs Pearl's 3-step Counterfactual Root-Cause Attribution (Abduction -> Action -> Prediction)
   * to quantify each node's responsibility for an anomaly in `outcomeNodeId`.
   */
  public attributeOutcomeAnomaly(
    outcomeNodeId: string,
    observedValues: Record<string, number>
  ): CausalAttributionReport {
    if (!this.nodes.has(outcomeNodeId)) {
      throw new Error(`UNKNOWN_OUTCOME_NODE: '${outcomeNodeId}'`);
    }

    const baselineValues = this.evaluateForward();
    const abductedU = this.abductExogenousVariables(observedValues);

    const observedOutcome = observedValues[outcomeNodeId]!;
    const baselineOutcome = baselineValues[outcomeNodeId]!;
    const totalOutcomeDeviation = Number((observedOutcome - baselineOutcome).toFixed(6));

    const entries: CounterfactualAttributionEntry[] = [];
    let sumPositiveEffects = 0;

    for (const id of this.topoOrder) {
      const spec = this.nodes.get(id)!;
      const localShock = Number((abductedU[id]! - spec.baselineExogenous).toFixed(6));

      // Counterfactual query: What would the outcome have been if node `id`'s exogenous noise
      // had remained at its normal baseline while all other nodes kept their abducted shocks?
      const counterfactualU = { ...abductedU, [id]: spec.baselineExogenous };
      const cfValues = this.evaluateForward({ exogenousOverrides: counterfactualU });
      const cfOutcome = cfValues[outcomeNodeId]!;
      const causalEffect = Number((observedOutcome - cfOutcome).toFixed(6));

      if (Math.abs(causalEffect) > 0) {
        sumPositiveEffects += Math.abs(causalEffect);
      }

      entries.push({
        nodeId: id,
        observedValue: observedValues[id]!,
        baselineValue: baselineValues[id]!,
        localExogenousShock: localShock,
        counterfactualOutcomeIfBaseline: cfOutcome,
        totalCausalEffectOnOutcome: causalEffect,
        normalizedResponsibilityShare: 0
      });
    }

    for (const entry of entries) {
      entry.normalizedResponsibilityShare =
        sumPositiveEffects > 1e-9
          ? Number((Math.abs(entry.totalCausalEffectOnOutcome) / sumPositiveEffects).toFixed(4))
          : 0;
    }

    entries.sort(
      (a, b) => Math.abs(b.totalCausalEffectOnOutcome) - Math.abs(a.totalCausalEffectOnOutcome)
    );

    return {
      outcomeNodeId,
      observedOutcome,
      baselineOutcome,
      totalOutcomeDeviation,
      primaryRootCauseNodeId: entries[0]?.nodeId ?? null,
      attributions: entries
    };
  }
}
