export interface WorkingMemoryFact {
  subject: string; // e.g. "?x" or "service-api"
  attribute: string;
  value: string | number | boolean;
}

export interface ReteConditionPattern {
  subjectVarOrConst: string; // Starts with "?" for variable binding, e.g. "?svc"
  attribute: string;
  valueVarOrConst: string | number | boolean;
}

export interface ReteProductionRule {
  ruleId: string;
  saliencePriority: number;
  conditions: ReteConditionPattern[];
  thenInferFact: (bindings: Record<string, string | number | boolean>) => WorkingMemoryFact;
}

/**
 * Forgy's Rete Forward-Chaining Production Rule Engine with Alpha-Memory Filtering,
 * Beta-Network Variable Binding Unification, Salience Conflict Resolution, and Refraction Control.
 */
export class ForgyReteRuleEngine {
  private readonly facts: WorkingMemoryFact[] = [];
  private readonly rules: ReteProductionRule[] = [];
  private readonly firedActivationKeys = new Set<string>();

  public addFact(fact: WorkingMemoryFact): boolean {
    const exists = this.facts.some(
      (f) =>
        f.subject === fact.subject &&
        f.attribute === fact.attribute &&
        f.value === fact.value
    );
    if (exists) return false;
    this.facts.push({ ...fact });
    return true;
  }

  public addRule(rule: ReteProductionRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.saliencePriority - a.saliencePriority);
  }

  private matchConditionAgainstFact(
    cond: ReteConditionPattern,
    fact: WorkingMemoryFact,
    currentBindings: Record<string, string | number | boolean>
  ): Record<string, string | number | boolean> | null {
    if (cond.attribute !== fact.attribute) return null;

    const nextBindings = { ...currentBindings };

    // Subject check / bind
    if (cond.subjectVarOrConst.startsWith("?")) {
      const existing = nextBindings[cond.subjectVarOrConst];
      if (existing !== undefined && existing !== fact.subject) return null;
      nextBindings[cond.subjectVarOrConst] = fact.subject;
    } else if (cond.subjectVarOrConst !== fact.subject) {
      return null;
    }

    // Value check / bind
    if (typeof cond.valueVarOrConst === "string" && cond.valueVarOrConst.startsWith("?")) {
      const existing = nextBindings[cond.valueVarOrConst];
      if (existing !== undefined && existing !== fact.value) return null;
      nextBindings[cond.valueVarOrConst] = fact.value;
    } else if (cond.valueVarOrConst !== fact.value) {
      return null;
    }

    return nextBindings;
  }

  private evaluateBetaJoin(
    conditions: ReteConditionPattern[],
    condIdx: number,
    bindings: Record<string, string | number | boolean>
  ): Array<Record<string, string | number | boolean>> {
    if (condIdx >= conditions.length) {
      return [bindings];
    }

    const cond = conditions[condIdx]!;
    const out: Array<Record<string, string | number | boolean>> = [];

    for (const fact of this.facts) {
      const merged = this.matchConditionAgainstFact(cond, fact, bindings);
      if (merged !== null) {
        out.push(...this.evaluateBetaJoin(conditions, condIdx + 1, merged));
      }
    }
    return out;
  }

  public runToFixpoint(maxIterations = 50): {
    inferredFactsCount: number;
    rulesFired: string[];
    allFacts: WorkingMemoryFact[];
  } {
    let inferredFactsCount = 0;
    const rulesFired: string[] = [];

    for (let iter = 0; iter < maxIterations; iter++) {
      let firedInPass = false;

      for (const rule of this.rules) {
        const activations = this.evaluateBetaJoin(rule.conditions, 0, {});
        for (const bind of activations) {
          const actKey = `${rule.ruleId}::${JSON.stringify(bind)}`;
          if (this.firedActivationKeys.has(actKey)) continue;

          this.firedActivationKeys.add(actKey);
          const newFact = rule.thenInferFact(bind);
          if (this.addFact(newFact)) {
            inferredFactsCount++;
            firedInPass = true;
          }
          rulesFired.push(rule.ruleId);
        }
      }

      if (!firedInPass) break;
    }

    return {
      inferredFactsCount,
      rulesFired,
      allFacts: [...this.facts]
    };
  }
}
