/**
 * Stage 13 (F385-F416): Neuro-Symbolic Datalog Stratified Fixed-Point Deductive Reasoner,
 * Exact Davis-Putnam-Logemann-Loveland (DPLL) Boolean SAT Solver with Unit Propagation &
 * Pure Literal Elimination, Robinson First-Order Unification with Occurs-Check &
 * Deontic Policy Conflict / Subsumption Verifier.
 */

import { createHash } from "node:crypto";

export interface DatalogAtom {
  predicate: string;
  terms: string[]; // Constants start with lowercase/digits; Variables start with '?'
  negated?: boolean;
}

export interface DatalogRule {
  rule_id: string;
  head: DatalogAtom;
  body: DatalogAtom[];
}

export interface DatalogEvaluationResult {
  iterations_to_fixpoint: number;
  initial_edb_facts_count: number;
  total_materialized_facts_count: number;
  derived_facts: string[];
  proof_trees: Record<string, string>; // fact_str -> rule_id + bindings
  fixpoint_digest: string;
}

export type SatLiteral = number; // Positive int = var_i, Negative int = NOT var_i
export type SatClause = SatLiteral[];

export interface DpllSatResult {
  satisfiable: boolean;
  assignment: Record<number, boolean>;
  unit_propagations_count: number;
  pure_literals_eliminated: number;
  decision_branches: number;
  verified_all_clauses: boolean;
  sat_digest: string;
}

export type FirstOrderTerm =
  | { kind: "var"; name: string } // e.g., ?x
  | { kind: "const"; value: string } // e.g., agent_alpha
  | { kind: "func"; symbol: string; args: FirstOrderTerm[] }; // e.g., route(?x, gemini)

export interface UnificationResult {
  unifiable: boolean;
  occurs_check_failed: boolean;
  mgu_bindings: Record<string, string>;
  unified_term_str: string;
}

export interface DeonticNormSpec {
  norm_id: string;
  modality: "obligation" | "permission" | "prohibition";
  action: string;
  role: string;
  condition: string;
}

export interface DeonticConflictReport {
  consistent: boolean;
  deontic_conflicts: Array<{
    norm_a: string;
    norm_b: string;
    role: string;
    action: string;
    reason: string;
  }>;
  subsumed_norm_ids: string[];
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function isVariable(term: string): boolean {
  return term.startsWith("?");
}

function formatAtom(predicate: string, terms: string[]): string {
  return `${predicate}(${terms.join(",")})`;
}

export class KosmoraNeurosymbolicSatEngine {
  // ==========================================================================
  // F385-F392: Bottom-Up Stratified Datalog Fixed-Point Deductive Engine
  // ==========================================================================

  public evaluateDatalogFixpoint(params: {
    edb_facts: Array<{ predicate: string; terms: string[] }>;
    rules: DatalogRule[];
    max_iterations?: number;
  }): DatalogEvaluationResult {
    const maxIter = params.max_iterations ?? 64;
    const factStore = new Map<string, { predicate: string; terms: string[] }>();
    const derivedFacts: string[] = [];
    const proofTrees: Record<string, string> = {};

    for (const f of params.edb_facts) {
      const key = formatAtom(f.predicate, f.terms);
      factStore.set(key, { predicate: f.predicate, terms: [...f.terms] });
      proofTrees[key] = "EDB_AXIOM";
    }

    const initialCount = factStore.size;
    let iterations = 0;
    let changed = true;

    while (changed && iterations < maxIter) {
      changed = false;
      iterations += 1;

      for (const rule of params.rules) {
        const positiveBody = rule.body.filter((b) => !b.negated);
        const negativeBody = rule.body.filter((b) => b.negated);

        // Find all variable bindings satisfying positiveBody
        let bindingsList: Array<Record<string, string>> = [{}];

        for (const atom of positiveBody) {
          const nextBindings: Array<Record<string, string>> = [];
          for (const env of bindingsList) {
            for (const cand of factStore.values()) {
              if (cand.predicate !== atom.predicate || cand.terms.length !== atom.terms.length) {
                continue;
              }
              const merged = { ...env };
              let compatible = true;
              for (let i = 0; i < atom.terms.length; i++) {
                const pat = atom.terms[i]!;
                const val = cand.terms[i]!;
                if (isVariable(pat)) {
                  if (merged[pat] !== undefined && merged[pat] !== val) {
                    compatible = false;
                    break;
                  }
                  merged[pat] = val;
                } else if (pat !== val) {
                  compatible = false;
                  break;
                }
              }
              if (compatible) {
                nextBindings.push(merged);
              }
            }
          }
          bindingsList = nextBindings;
          if (bindingsList.length === 0) break;
        }

        // Filter bindings by negated-as-failure body atoms
        for (const env of bindingsList) {
          let negSatisfied = true;
          for (const negAtom of negativeBody) {
            const groundedTerms = negAtom.terms.map((t) => (isVariable(t) ? env[t] ?? t : t));
            const negKey = formatAtom(negAtom.predicate, groundedTerms);
            if (factStore.has(negKey)) {
              negSatisfied = false;
              break;
            }
          }
          if (!negSatisfied) continue;

          const headTerms = rule.head.terms.map((t) => (isVariable(t) ? env[t] ?? t : t));
          if (headTerms.some((t) => isVariable(t))) continue; // Range-restricted safety check

          const headKey = formatAtom(rule.head.predicate, headTerms);
          if (!factStore.has(headKey)) {
            factStore.set(headKey, { predicate: rule.head.predicate, terms: headTerms });
            derivedFacts.push(headKey);
            proofTrees[headKey] = `${rule.rule_id}:${JSON.stringify(env)}`;
            changed = true;
          }
        }
      }
    }

    return {
      iterations_to_fixpoint: iterations,
      initial_edb_facts_count: initialCount,
      total_materialized_facts_count: factStore.size,
      derived_facts: derivedFacts,
      proof_trees: proofTrees,
      fixpoint_digest: sha256Hex(JSON.stringify([...factStore.keys()].sort()))
    };
  }

  // ==========================================================================
  // F393-F400: Exact DPLL Boolean SAT Solver (Unit Propagation + Pure Literal)
  // ==========================================================================

  public solveDpllBooleanSat(params: {
    num_vars: number;
    clauses: SatClause[];
  }): DpllSatResult {
    let unitPropagations = 0;
    let pureEliminations = 0;
    let branches = 0;

    const simplifyClauses = (
      clauses: SatClause[],
      lit: SatLiteral
    ): SatClause[] | null => {
      const next: SatClause[] = [];
      for (const c of clauses) {
        if (c.includes(lit)) {
          continue; // Clause satisfied
        }
        if (c.includes(-lit)) {
          const reduced = c.filter((x) => x !== -lit);
          if (reduced.length === 0) {
            return null; // Conflict (empty clause)
          }
          next.push(reduced);
        } else {
          next.push(c);
        }
      }
      return next;
    };

    const dpllSearch = (
      currentClauses: SatClause[],
      currentAssign: Record<number, boolean>
    ): Record<number, boolean> | null => {
      let clauses = currentClauses;
      const assign = { ...currentAssign };

      // 1. Unit Propagation loop
      while (true) {
        const unitClause = clauses.find((c) => c.length === 1);
        if (!unitClause) break;
        const unitLit = unitClause[0]!;
        const varId = Math.abs(unitLit);
        assign[varId] = unitLit > 0;
        unitPropagations += 1;

        const simplified = simplifyClauses(clauses, unitLit);
        if (simplified === null) return null;
        clauses = simplified;
      }

      if (clauses.length === 0) {
        return assign;
      }

      // 2. Pure Literal Elimination
      const literalPolarity = new Map<number, Set<number>>();
      for (const c of clauses) {
        for (const lit of c) {
          const v = Math.abs(lit);
          const s = literalPolarity.get(v) ?? new Set<number>();
          s.add(lit > 0 ? 1 : -1);
          literalPolarity.set(v, s);
        }
      }

      for (const [v, signs] of literalPolarity.entries()) {
        if (signs.size === 1) {
          const sign = [...signs][0]!;
          const pureLit = sign * v;
          assign[v] = pureLit > 0;
          pureEliminations += 1;
          const simplified = simplifyClauses(clauses, pureLit);
          if (simplified === null) return null;
          clauses = simplified;
        }
      }

      if (clauses.length === 0) {
        return assign;
      }

      // 3. Choose unassigned variable from shortest clause (MOMS heuristic)
      const shortest = [...clauses].sort((a, b) => a.length - b.length)[0]!;
      const chosenLit = shortest[0]!;
      const chosenVar = Math.abs(chosenLit);

      branches += 1;
      const posTry = simplifyClauses(clauses, chosenVar);
      if (posTry !== null) {
        const resPos = dpllSearch(posTry, { ...assign, [chosenVar]: true });
        if (resPos !== null) return resPos;
      }

      const negTry = simplifyClauses(clauses, -chosenVar);
      if (negTry !== null) {
        const resNeg = dpllSearch(negTry, { ...assign, [chosenVar]: false });
        if (resNeg !== null) return resNeg;
      }

      return null;
    };

    const rawSolution = dpllSearch(params.clauses, {});
    if (rawSolution === null) {
      return {
        satisfiable: false,
        assignment: {},
        unit_propagations_count: unitPropagations,
        pure_literals_eliminated: pureEliminations,
        decision_branches: branches,
        verified_all_clauses: false,
        sat_digest: sha256Hex(JSON.stringify({ sat: false, clauses: params.clauses }))
      };
    }

    // Fill any unconstrained variables with false
    for (let v = 1; v <= params.num_vars; v++) {
      if (rawSolution[v] === undefined) {
        rawSolution[v] = false;
      }
    }

    // Verify assignment against all original clauses
    const verified = params.clauses.every((clause) =>
      clause.some((lit) => {
        const val = rawSolution[Math.abs(lit)] ?? false;
        return lit > 0 ? val === true : val === false;
      })
    );

    return {
      satisfiable: true,
      assignment: rawSolution,
      unit_propagations_count: unitPropagations,
      pure_literals_eliminated: pureEliminations,
      decision_branches: branches,
      verified_all_clauses: verified,
      sat_digest: sha256Hex(JSON.stringify({ sat: true, rawSolution }))
    };
  }

  // ==========================================================================
  // F401-F408: Robinson First-Order Unification with Occurs-Check
  // ==========================================================================

  public unifyFirstOrderTerms(
    t1: FirstOrderTerm,
    t2: FirstOrderTerm
  ): UnificationResult {
    const subst = new Map<string, FirstOrderTerm>();
    let occursCheckFailed = false;

    const applySubst = (term: FirstOrderTerm): FirstOrderTerm => {
      if (term.kind === "const") return term;
      if (term.kind === "var") {
        const bound = subst.get(term.name);
        return bound ? applySubst(bound) : term;
      }
      return {
        kind: "func",
        symbol: term.symbol,
        args: term.args.map((a) => applySubst(a))
      };
    };

    const occursIn = (varName: string, term: FirstOrderTerm): boolean => {
      const resolved = applySubst(term);
      if (resolved.kind === "var") return resolved.name === varName;
      if (resolved.kind === "const") return false;
      return resolved.args.some((a) => occursIn(varName, a));
    };

    const unify = (a: FirstOrderTerm, b: FirstOrderTerm): boolean => {
      const left = applySubst(a);
      const right = applySubst(b);

      if (left.kind === "var" && right.kind === "var" && left.name === right.name) {
        return true;
      }
      if (left.kind === "var") {
        if (occursIn(left.name, right)) {
          occursCheckFailed = true;
          return false;
        }
        subst.set(left.name, right);
        return true;
      }
      if (right.kind === "var") {
        if (occursIn(right.name, left)) {
          occursCheckFailed = true;
          return false;
        }
        subst.set(right.name, left);
        return true;
      }
      if (left.kind === "const" && right.kind === "const") {
        return left.value === right.value;
      }
      if (left.kind === "func" && right.kind === "func") {
        if (left.symbol !== right.symbol || left.args.length !== right.args.length) {
          return false;
        }
        for (let i = 0; i < left.args.length; i++) {
          if (!unify(left.args[i]!, right.args[i]!)) return false;
        }
        return true;
      }
      return false;
    };

    const formatTerm = (t: FirstOrderTerm): string => {
      const res = applySubst(t);
      if (res.kind === "var") return res.name;
      if (res.kind === "const") return res.value;
      return `${res.symbol}(${res.args.map(formatTerm).join(",")})`;
    };

    const ok = unify(t1, t2);
    const bindingsObj: Record<string, string> = {};
    for (const [k, v] of subst.entries()) {
      bindingsObj[k] = formatTerm(v);
    }

    return {
      unifiable: ok,
      occurs_check_failed: occursCheckFailed,
      mgu_bindings: ok ? bindingsObj : {},
      unified_term_str: ok ? formatTerm(t1) : "UNIFICATION_FAILED"
    };
  }

  // ==========================================================================
  // F409-F416: Deontic Policy Conflict & Subsumption Verifier
  // ==========================================================================

  public verifyDeonticPolicyConsistency(
    norms: DeonticNormSpec[]
  ): DeonticConflictReport {
    const conflicts: DeonticConflictReport["deontic_conflicts"] = [];
    const subsumed = new Set<string>();

    for (let i = 0; i < norms.length; i++) {
      for (let j = i + 1; j < norms.length; j++) {
        const a = norms[i]!;
        const b = norms[j]!;
        if (a.role === b.role && a.action === b.action) {
          const sameOrGlobalCond =
            a.condition === b.condition || a.condition === "*" || b.condition === "*";
          if (!sameOrGlobalCond) continue;

          // Deontic contradiction: Obligation vs Prohibition or Permission vs Prohibition
          const isConflict =
            (a.modality === "obligation" && b.modality === "prohibition") ||
            (a.modality === "prohibition" && b.modality === "obligation") ||
            (a.modality === "permission" && b.modality === "prohibition") ||
            (a.modality === "prohibition" && b.modality === "permission");

          if (isConflict) {
            conflicts.push({
              norm_a: a.norm_id,
              norm_b: b.norm_id,
              role: a.role,
              action: a.action,
              reason: `Deontic contradiction between ${a.modality} (${a.norm_id}) and ${b.modality} (${b.norm_id})`
            });
          } else if (a.modality === b.modality) {
            if (a.condition === "*" && b.condition !== "*") {
              subsumed.add(b.norm_id);
            } else if (b.condition === "*" && a.condition !== "*") {
              subsumed.add(a.norm_id);
            }
          }
        }
      }
    }

    return {
      consistent: conflicts.length === 0,
      deontic_conflicts: conflicts,
      subsumed_norm_ids: [...subsumed]
    };
  }
}
