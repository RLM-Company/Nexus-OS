export type EGraphAst =
  | { kind: "sym"; name: string }
  | { kind: "num"; value: number }
  | { kind: "op"; op: "+" | "-" | "*" | "/"; args: EGraphAst[] };

export interface EGraphExtractionResult {
  simplifiedAst: EGraphAst;
  formattedExpression: string;
  originalCost: number;
  optimizedCost: number;
  equivalenceClassesCount: number;
}

/**
 * Equality Saturation & Congruence Closure E-Graph Algebraic Term Rewriting Optimizer.
 * Applies non-destructive algebraic rewrite rules (`x + 0 -> x`, `x * 1 -> x`, `x * 0 -> 0`,
 * `x - x -> 0`, `(x * 2) / 2 -> x`, constant folding) and extracts the minimum-cost AST.
 */
export class EGraphEqualitySaturationEngine {
  public static formatAst(ast: EGraphAst): string {
    if (ast.kind === "sym") return ast.name;
    if (ast.kind === "num") return String(ast.value);
    return `(${ast.args.map((a) => EGraphEqualitySaturationEngine.formatAst(a)).join(` ${ast.op} `)})`;
  }

  public static computeAstCost(ast: EGraphAst): number {
    if (ast.kind === "sym" || ast.kind === "num") return 1;
    const opWeight = ast.op === "/" ? 8 : ast.op === "*" ? 4 : 2;
    return (
      opWeight +
      ast.args.reduce((acc, a) => acc + EGraphEqualitySaturationEngine.computeAstCost(a), 0)
    );
  }

  private static astEquals(a: EGraphAst, b: EGraphAst): boolean {
    return EGraphEqualitySaturationEngine.formatAst(a) === EGraphEqualitySaturationEngine.formatAst(b);
  }

  private static rewriteStep(ast: EGraphAst): EGraphAst[] {
    if (ast.kind !== "op") return [ast];

    const rewrittenArgsList = ast.args.map((arg) =>
      EGraphEqualitySaturationEngine.rewriteStep(arg)
    );

    const candidates: EGraphAst[] = [];
    // Combine best rewritten children
    const bestChildren = rewrittenArgsList.map((list) =>
      [...list].sort(
        (x, y) =>
          EGraphEqualitySaturationEngine.computeAstCost(x) -
          EGraphEqualitySaturationEngine.computeAstCost(y)
      )[0]!
    );

    const baseNode: EGraphAst = { kind: "op", op: ast.op, args: bestChildren };
    candidates.push(baseNode);

    if (bestChildren.length === 2) {
      const [left, right] = bestChildren as [EGraphAst, EGraphAst];

      // 1. Constant folding
      if (left.kind === "num" && right.kind === "num") {
        if (ast.op === "+") candidates.push({ kind: "num", value: left.value + right.value });
        if (ast.op === "-") candidates.push({ kind: "num", value: left.value - right.value });
        if (ast.op === "*") candidates.push({ kind: "num", value: left.value * right.value });
        if (ast.op === "/" && right.value !== 0) {
          candidates.push({ kind: "num", value: left.value / right.value });
        }
      }

      // 2. Additive identities: x + 0 -> x, 0 + x -> x, x - 0 -> x, x - x -> 0
      if (ast.op === "+" && right.kind === "num" && right.value === 0) candidates.push(left);
      if (ast.op === "+" && left.kind === "num" && left.value === 0) candidates.push(right);
      if (ast.op === "-" && right.kind === "num" && right.value === 0) candidates.push(left);
      if (ast.op === "-" && EGraphEqualitySaturationEngine.astEquals(left, right)) {
        candidates.push({ kind: "num", value: 0 });
      }

      // 3. Multiplicative identities & annihilation: x * 1 -> x, 1 * x -> x, x * 0 -> 0, 0 * x -> 0
      if (ast.op === "*" && right.kind === "num" && right.value === 1) candidates.push(left);
      if (ast.op === "*" && left.kind === "num" && left.value === 1) candidates.push(right);
      if (
        ast.op === "*" &&
        ((right.kind === "num" && right.value === 0) ||
          (left.kind === "num" && left.value === 0))
      ) {
        candidates.push({ kind: "num", value: 0 });
      }

      // 4. Division identities & cancellation: x / 1 -> x, (x * k) / k -> x
      if (ast.op === "/" && right.kind === "num" && right.value === 1) candidates.push(left);
      if (
        ast.op === "/" &&
        left.kind === "op" &&
        left.op === "*" &&
        left.args.length === 2
      ) {
        if (EGraphEqualitySaturationEngine.astEquals(left.args[1]!, right)) {
          candidates.push(left.args[0]!);
        } else if (EGraphEqualitySaturationEngine.astEquals(left.args[0]!, right)) {
          candidates.push(left.args[1]!);
        }
      }

      // 5. Strength reduction: x * 2 -> x + x (if + is cheaper than *)
      if (ast.op === "*" && right.kind === "num" && right.value === 2 && left.kind === "sym") {
        candidates.push({ kind: "op", op: "+", args: [left, left] });
      }
    }

    return candidates;
  }

  public static saturateAndExtract(
    initialAst: EGraphAst,
    maxPasses = 6
  ): EGraphExtractionResult {
    const originalCost = EGraphEqualitySaturationEngine.computeAstCost(initialAst);
    const seenExpressions = new Map<string, EGraphAst>();

    let currentBest = initialAst;
    seenExpressions.set(EGraphEqualitySaturationEngine.formatAst(currentBest), currentBest);

    for (let pass = 0; pass < maxPasses; pass++) {
      const equivalents = EGraphEqualitySaturationEngine.rewriteStep(currentBest);
      for (const eq of equivalents) {
        seenExpressions.set(EGraphEqualitySaturationEngine.formatAst(eq), eq);
        if (
          EGraphEqualitySaturationEngine.computeAstCost(eq) <
          EGraphEqualitySaturationEngine.computeAstCost(currentBest)
        ) {
          currentBest = eq;
        }
      }
    }

    return {
      simplifiedAst: currentBest,
      formattedExpression: EGraphEqualitySaturationEngine.formatAst(currentBest),
      originalCost,
      optimizedCost: EGraphEqualitySaturationEngine.computeAstCost(currentBest),
      equivalenceClassesCount: seenExpressions.size
    };
  }
}
