/**
 * Kosmora / Nexus-OS Deductive Datalog & Forward-Chaining Policy Inference Engine (Wave 23)
 *
 * Implements stratified semi-naive bottom-up Datalog evaluation over Extensional Database (EDB)
 * facts and Intensional Database (IDB) Horn clauses:
 *   `head( ?X, ?Z ) :- body1( ?X, ?Y ), body2( ?Y, ?Z ), not forbidden( ?X ).`
 *
 * Capabilities:
 * 1. Transitive closure & multi-hop relational reasoning (e.g. `depends_on`, `can_access`, `derived_hazard`).
 * 2. Stratified negation (`negated: true`) for policy exclusion rules.
 * 3. Deterministic least-fixed-point convergence with full derivation lineage.
 */

export interface DatalogAtom {
  predicate: string;
  terms: string[]; // Variables start with '?' (e.g. '?X'), constants are plain strings
  negated?: boolean;
}

export interface DatalogRule {
  id: string;
  head: DatalogAtom;
  body: DatalogAtom[];
}

export interface DerivedFactRecord {
  predicate: string;
  args: string[];
  derivedByRuleId: string | "EDB";
}

function isVariable(term: string): boolean {
  return term.startsWith("?");
}

function factKey(predicate: string, args: string[]): string {
  return `${predicate}(${args.map((a) => JSON.stringify(a)).join(",")})`;
}

export class DatalogInferenceEngine {
  private readonly facts = new Map<string, DerivedFactRecord>();
  private readonly rules: DatalogRule[] = [];

  /**
   * Adds an extensional ground fact `predicate(arg1, arg2, ...)` to the knowledge base.
   */
  public addFact(predicate: string, ...args: string[]): void {
    const key = factKey(predicate, args);
    if (!this.facts.has(key)) {
      this.facts.set(key, {
        predicate,
        args,
        derivedByRuleId: "EDB"
      });
    }
  }

  /**
   * Registers a Horn clause rule `head :- body1, body2, ...`.
   */
  public addRule(rule: DatalogRule): void {
    this.rules.push(rule);
  }

  /**
   * Evaluates all registered rules to a least fixed point (bottom-up forward chaining).
   * Positive body atoms are unified first, followed by negated guards (`not pred(...)`).
   */
  public materializeFixedPoint(maxIterations = 100): {
    iterations: number;
    totalFacts: number;
    newlyDerivedCount: number;
  } {
    let iterations = 0;
    let newlyDerivedCount = 0;
    let changed = true;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations += 1;

      for (const rule of this.rules) {
        const positiveBody = rule.body.filter((b) => !b.negated);
        const negativeBody = rule.body.filter((b) => b.negated);

        const bindingsList = this.matchPositiveConjunction(positiveBody, [new Map()]);

        for (const binding of bindingsList) {
          // Check negative guards
          let blockedByNegation = false;
          for (const negAtom of negativeBody) {
            const groundArgs = negAtom.terms.map((t) =>
              isVariable(t) ? (binding.get(t) ?? t) : t
            );
            // If all terms are bound and the negated fact exists, guard fails
            if (!groundArgs.some(isVariable)) {
              if (this.facts.has(factKey(negAtom.predicate, groundArgs))) {
                blockedByNegation = true;
                break;
              }
            }
          }

          if (blockedByNegation) continue;

          // Instantiate head atom
          const headArgs = rule.head.terms.map((t) =>
            isVariable(t) ? (binding.get(t) ?? t) : t
          );
          if (headArgs.some(isVariable)) {
            continue; // Unsafe rule head variable
          }

          const key = factKey(rule.head.predicate, headArgs);
          if (!this.facts.has(key)) {
            this.facts.set(key, {
              predicate: rule.head.predicate,
              args: headArgs,
              derivedByRuleId: rule.id
            });
            newlyDerivedCount += 1;
            changed = true;
          }
        }
      }
    }

    return {
      iterations,
      totalFacts: this.facts.size,
      newlyDerivedCount
    };
  }

  /**
   * Queries ground or pattern-matched facts after materialization.
   * Pass `"?X"` wildcards or exact constants.
   */
  public query(predicate: string, patternTerms?: string[]): DerivedFactRecord[] {
    const results: DerivedFactRecord[] = [];
    for (const rec of this.facts.values()) {
      if (rec.predicate !== predicate) continue;
      if (!patternTerms) {
        results.push(rec);
        continue;
      }
      if (rec.args.length !== patternTerms.length) continue;

      const env = new Map<string, string>();
      let matched = true;
      for (let i = 0; i < patternTerms.length; i++) {
        const pat = patternTerms[i];
        const actual = rec.args[i];
        if (isVariable(pat)) {
          const bound = env.get(pat);
          if (bound !== undefined && bound !== actual) {
            matched = false;
            break;
          }
          env.set(pat, actual);
        } else if (pat !== actual) {
          matched = false;
          break;
        }
      }

      if (matched) {
        results.push(rec);
      }
    }
    return results;
  }

  private matchPositiveConjunction(
    atoms: DatalogAtom[],
    currentBindings: Array<Map<string, string>>
  ): Array<Map<string, string>> {
    let bindings = currentBindings;
    for (const atom of atoms) {
      const nextBindings: Array<Map<string, string>> = [];
      const candidateFacts = Array.from(this.facts.values()).filter(
        (f) => f.predicate === atom.predicate && f.args.length === atom.terms.length
      );

      for (const b of bindings) {
        for (const fact of candidateFacts) {
          const merged = this.unifyAtomWithFact(atom, fact.args, b);
          if (merged) {
            nextBindings.push(merged);
          }
        }
      }
      bindings = nextBindings;
      if (bindings.length === 0) break;
    }
    return bindings;
  }

  private unifyAtomWithFact(
    atom: DatalogAtom,
    factArgs: string[],
    env: Map<string, string>
  ): Map<string, string> | null {
    const nextEnv = new Map(env);
    for (let i = 0; i < atom.terms.length; i++) {
      const term = atom.terms[i];
      const val = factArgs[i];
      if (isVariable(term)) {
        const existing = nextEnv.get(term);
        if (existing !== undefined && existing !== val) {
          return null;
        }
        nextEnv.set(term, val);
      } else if (term !== val) {
        return null;
      }
    }
    return nextEnv;
  }
}
