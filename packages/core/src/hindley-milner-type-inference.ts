export type HmType =
  | { kind: "tvar"; name: string }
  | { kind: "tcon"; name: "Int" | "Bool" | "String" }
  | { kind: "tarrow"; from: HmType; to: HmType };

export type HmExpr =
  | { kind: "lit_int"; value: number }
  | { kind: "lit_bool"; value: boolean }
  | { kind: "lit_str"; value: string }
  | { kind: "var"; name: string }
  | { kind: "abs"; param: string; body: HmExpr }
  | { kind: "app"; fn: HmExpr; arg: HmExpr }
  | { kind: "let"; name: string; value: HmExpr; body: HmExpr };

export interface HmScheme {
  quantifiedVars: string[];
  type: HmType;
}

type Substitution = Map<string, HmType>;

/**
 * Damas-Hindley-Milner Algorithm W Polymorphic Type Inference & Robinson Unification Engine.
 * Infers principal polymorphic types with let-generalization, instantiation, and occurs-check safety.
 */
export class HindleyMilnerAlgorithmWTypeEngine {
  private typeVarCounter = 0;

  private freshTypeVar(): HmType {
    return { kind: "tvar", name: `t${++this.typeVarCounter}` };
  }

  public static formatType(t: HmType): string {
    if (t.kind === "tvar") return t.name;
    if (t.kind === "tcon") return t.name;
    const left =
      t.from.kind === "tarrow"
        ? `(${HindleyMilnerAlgorithmWTypeEngine.formatType(t.from)})`
        : HindleyMilnerAlgorithmWTypeEngine.formatType(t.from);
    return `${left} -> ${HindleyMilnerAlgorithmWTypeEngine.formatType(t.to)}`;
  }

  private static applySubstToType(subst: Substitution, t: HmType): HmType {
    if (t.kind === "tcon") return t;
    if (t.kind === "tvar") {
      const bound = subst.get(t.name);
      return bound ? HindleyMilnerAlgorithmWTypeEngine.applySubstToType(subst, bound) : t;
    }
    return {
      kind: "tarrow",
      from: HindleyMilnerAlgorithmWTypeEngine.applySubstToType(subst, t.from),
      to: HindleyMilnerAlgorithmWTypeEngine.applySubstToType(subst, t.to)
    };
  }

  private static composeSubst(s1: Substitution, s2: Substitution): Substitution {
    const out: Substitution = new Map();
    for (const [k, v] of s2.entries()) {
      out.set(k, HindleyMilnerAlgorithmWTypeEngine.applySubstToType(s1, v));
    }
    for (const [k, v] of s1.entries()) {
      if (!out.has(k)) out.set(k, v);
    }
    return out;
  }

  private static freeTypeVars(t: HmType): Set<string> {
    if (t.kind === "tcon") return new Set();
    if (t.kind === "tvar") return new Set([t.name]);
    const left = HindleyMilnerAlgorithmWTypeEngine.freeTypeVars(t.from);
    for (const v of HindleyMilnerAlgorithmWTypeEngine.freeTypeVars(t.to)) {
      left.add(v);
    }
    return left;
  }

  private static unify(t1: HmType, t2: HmType): Substitution {
    if (t1.kind === "tcon" && t2.kind === "tcon" && t1.name === t2.name) {
      return new Map();
    }
    if (t1.kind === "tvar") {
      return HindleyMilnerAlgorithmWTypeEngine.bindVar(t1.name, t2);
    }
    if (t2.kind === "tvar") {
      return HindleyMilnerAlgorithmWTypeEngine.bindVar(t2.name, t1);
    }
    if (t1.kind === "tarrow" && t2.kind === "tarrow") {
      const s1 = HindleyMilnerAlgorithmWTypeEngine.unify(t1.from, t2.from);
      const s2 = HindleyMilnerAlgorithmWTypeEngine.unify(
        HindleyMilnerAlgorithmWTypeEngine.applySubstToType(s1, t1.to),
        HindleyMilnerAlgorithmWTypeEngine.applySubstToType(s1, t2.to)
      );
      return HindleyMilnerAlgorithmWTypeEngine.composeSubst(s2, s1);
    }
    throw new Error(
      `HM_TYPE_MISMATCH: cannot unify ${HindleyMilnerAlgorithmWTypeEngine.formatType(t1)} with ${HindleyMilnerAlgorithmWTypeEngine.formatType(t2)}`
    );
  }

  private static bindVar(varName: string, t: HmType): Substitution {
    if (t.kind === "tvar" && t.name === varName) {
      return new Map();
    }
    if (HindleyMilnerAlgorithmWTypeEngine.freeTypeVars(t).has(varName)) {
      throw new Error(
        `INFINITE_TYPE_OCCURS_CHECK: ${varName} occurs inside ${HindleyMilnerAlgorithmWTypeEngine.formatType(t)}`
      );
    }
    return new Map([[varName, t]]);
  }

  private instantiate(scheme: HmScheme): HmType {
    const subst: Substitution = new Map();
    for (const qv of scheme.quantifiedVars) {
      subst.set(qv, this.freshTypeVar());
    }
    return HindleyMilnerAlgorithmWTypeEngine.applySubstToType(subst, scheme.type);
  }

  private static generalize(env: Map<string, HmScheme>, t: HmType): HmScheme {
    const envFree = new Set<string>();
    for (const sch of env.values()) {
      const boundSet = new Set(sch.quantifiedVars);
      for (const fv of HindleyMilnerAlgorithmWTypeEngine.freeTypeVars(sch.type)) {
        if (!boundSet.has(fv)) envFree.add(fv);
      }
    }
    const quantifiedVars: string[] = [];
    for (const fv of HindleyMilnerAlgorithmWTypeEngine.freeTypeVars(t)) {
      if (!envFree.has(fv)) quantifiedVars.push(fv);
    }
    return { quantifiedVars, type: t };
  }

  private applySubstToEnv(subst: Substitution, env: Map<string, HmScheme>): Map<string, HmScheme> {
    const next = new Map<string, HmScheme>();
    for (const [k, sch] of env.entries()) {
      const filteredSubst: Substitution = new Map(subst);
      for (const qv of sch.quantifiedVars) filteredSubst.delete(qv);
      next.set(k, {
        quantifiedVars: [...sch.quantifiedVars],
        type: HindleyMilnerAlgorithmWTypeEngine.applySubstToType(filteredSubst, sch.type)
      });
    }
    return next;
  }

  private inferW(
    env: Map<string, HmScheme>,
    expr: HmExpr
  ): { subst: Substitution; type: HmType } {
    if (expr.kind === "lit_int") {
      return { subst: new Map(), type: { kind: "tcon", name: "Int" } };
    }
    if (expr.kind === "lit_bool") {
      return { subst: new Map(), type: { kind: "tcon", name: "Bool" } };
    }
    if (expr.kind === "lit_str") {
      return { subst: new Map(), type: { kind: "tcon", name: "String" } };
    }
    if (expr.kind === "var") {
      const scheme = env.get(expr.name);
      if (!scheme) {
        throw new Error(`UNBOUND_IDENTIFIER: ${expr.name}`);
      }
      return { subst: new Map(), type: this.instantiate(scheme) };
    }
    if (expr.kind === "abs") {
      const tv = this.freshTypeVar();
      const nextEnv = new Map(env);
      nextEnv.set(expr.param, { quantifiedVars: [], type: tv });
      const bodyRes = this.inferW(nextEnv, expr.body);
      return {
        subst: bodyRes.subst,
        type: {
          kind: "tarrow",
          from: HindleyMilnerAlgorithmWTypeEngine.applySubstToType(bodyRes.subst, tv),
          to: bodyRes.type
        }
      };
    }
    if (expr.kind === "app") {
      const resultTv = this.freshTypeVar();
      const fnRes = this.inferW(env, expr.fn);
      const argRes = this.inferW(this.applySubstToEnv(fnRes.subst, env), expr.arg);
      const s3 = HindleyMilnerAlgorithmWTypeEngine.unify(
        HindleyMilnerAlgorithmWTypeEngine.applySubstToType(argRes.subst, fnRes.type),
        { kind: "tarrow", from: argRes.type, to: resultTv }
      );
      const composed = HindleyMilnerAlgorithmWTypeEngine.composeSubst(
        s3,
        HindleyMilnerAlgorithmWTypeEngine.composeSubst(argRes.subst, fnRes.subst)
      );
      return {
        subst: composed,
        type: HindleyMilnerAlgorithmWTypeEngine.applySubstToType(s3, resultTv)
      };
    }

    // let-polymorphism: let name = value in body
    const valRes = this.inferW(env, expr.value);
    const envAfterVal = this.applySubstToEnv(valRes.subst, env);
    const polyScheme = HindleyMilnerAlgorithmWTypeEngine.generalize(envAfterVal, valRes.type);
    const bodyEnv = new Map(envAfterVal);
    bodyEnv.set(expr.name, polyScheme);
    const bodyRes = this.inferW(bodyEnv, expr.body);
    return {
      subst: HindleyMilnerAlgorithmWTypeEngine.composeSubst(bodyRes.subst, valRes.subst),
      type: bodyRes.type
    };
  }

  public inferExpressionType(
    expr: HmExpr,
    initialEnv?: Map<string, HmScheme>
  ): { inferredType: HmType; formattedType: string } {
    const res = this.inferW(initialEnv ?? new Map(), expr);
    const finalType = HindleyMilnerAlgorithmWTypeEngine.applySubstToType(res.subst, res.type);
    return {
      inferredType: finalType,
      formattedType: HindleyMilnerAlgorithmWTypeEngine.formatType(finalType)
    };
  }
}
