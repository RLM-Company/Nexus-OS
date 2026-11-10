export type BooleanFormulaAst =
  | { kind: "const"; value: boolean }
  | { kind: "var"; name: string }
  | { kind: "not"; inner: BooleanFormulaAst }
  | { kind: "and"; left: BooleanFormulaAst; right: BooleanFormulaAst }
  | { kind: "or"; left: BooleanFormulaAst; right: BooleanFormulaAst }
  | { kind: "imp"; left: BooleanFormulaAst; right: BooleanFormulaAst }
  | { kind: "iff"; left: BooleanFormulaAst; right: BooleanFormulaAst };

export interface RobddNode {
  id: number; // 0 = FALSE terminal, 1 = TRUE terminal, >= 2 = internal decision node
  varIndex: number; // Infinity for terminals
  varName: string;
  lowId: number; // false branch
  highId: number; // true branch
}

/**
 * Bryant's Canonical Reduced Ordered Binary Decision Diagram (ROBDD) Engine.
 * Enforces Reduction Rule 1 (no duplicate isomorphic nodes via hash-consing Unique Table)
 * and Reduction Rule 2 (no redundant nodes where lowId === highId).
 * Guarantees that any two logically equivalent Boolean formulas over the same variable ordering
 * compile to the exact same canonical ROBDD root node ID!
 */
export class ReducedOrderedBinaryDecisionDiagram {
  public readonly variableOrder: string[];
  private readonly varIndexMap = new Map<string, number>();
  private readonly nodes: RobddNode[] = [];
  private readonly uniqueTable = new Map<string, number>();

  constructor(variableOrder: string[]) {
    this.variableOrder = [...variableOrder];
    variableOrder.forEach((v, idx) => this.varIndexMap.set(v, idx));

    // Terminal 0 = FALSE, Terminal 1 = TRUE
    this.nodes.push({
      id: 0,
      varIndex: Infinity,
      varName: "FALSE",
      lowId: 0,
      highId: 0
    });
    this.nodes.push({
      id: 1,
      varIndex: Infinity,
      varName: "TRUE",
      lowId: 1,
      highId: 1
    });
  }

  public mkNode(varIndex: number, lowId: number, highId: number): number {
    // Reduction Rule 2: Eliminate redundant decision test
    if (lowId === highId) {
      return lowId;
    }

    // Reduction Rule 1: Share isomorphic subgraphs via Unique Table
    const key = `${varIndex}:${lowId}:${highId}`;
    const existing = this.uniqueTable.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const id = this.nodes.length;
    this.nodes.push({
      id,
      varIndex,
      varName: this.variableOrder[varIndex]!,
      lowId,
      highId
    });
    this.uniqueTable.set(key, id);
    return id;
  }

  private evaluateWithPartialAssignment(
    ast: BooleanFormulaAst,
    env: Record<string, boolean>
  ): boolean {
    if (ast.kind === "const") return ast.value;
    if (ast.kind === "var") return Boolean(env[ast.name]);
    if (ast.kind === "not") return !this.evaluateWithPartialAssignment(ast.inner, env);
    if (ast.kind === "and") {
      return (
        this.evaluateWithPartialAssignment(ast.left, env) &&
        this.evaluateWithPartialAssignment(ast.right, env)
      );
    }
    if (ast.kind === "or") {
      return (
        this.evaluateWithPartialAssignment(ast.left, env) ||
        this.evaluateWithPartialAssignment(ast.right, env)
      );
    }
    if (ast.kind === "imp") {
      return (
        !this.evaluateWithPartialAssignment(ast.left, env) ||
        this.evaluateWithPartialAssignment(ast.right, env)
      );
    }
    return (
      this.evaluateWithPartialAssignment(ast.left, env) ===
      this.evaluateWithPartialAssignment(ast.right, env)
    );
  }

  /**
   * Compiles a Boolean formula AST into its canonical ROBDD root node ID via Shannon Expansion:
   * f = (~x_i & f|_{x_i=0}) | (x_i & f|_{x_i=1}).
   */
  public compileFormula(ast: BooleanFormulaAst): number {
    const build = (varIdx: number, env: Record<string, boolean>): number => {
      if (varIdx >= this.variableOrder.length) {
        return this.evaluateWithPartialAssignment(ast, env) ? 1 : 0;
      }
      const varName = this.variableOrder[varIdx]!;
      const lowId = build(varIdx + 1, { ...env, [varName]: false });
      const highId = build(varIdx + 1, { ...env, [varName]: true });
      return this.mkNode(varIdx, lowId, highId);
    };

    return build(0, {});
  }

  public areEquivalent(astA: BooleanFormulaAst, astB: BooleanFormulaAst): boolean {
    return this.compileFormula(astA) === this.compileFormula(astB);
  }

  public isTautology(rootId: number): boolean {
    return rootId === 1;
  }

  public isContradiction(rootId: number): boolean {
    return rootId === 0;
  }

  /**
   * Exact #SAT model counting in O(|G|) time over the ROBDD DAG.
   */
  public countSatisfyingAssignments(rootId: number): number {
    const totalVars = this.variableOrder.length;
    const memo = new Map<number, number>();

    const countPathsToOne = (nodeId: number): number => {
      if (nodeId === 0) return 0;
      if (nodeId === 1) return 1;
      if (memo.has(nodeId)) return memo.get(nodeId)!;

      const node = this.nodes[nodeId]!;
      const lowNode = this.nodes[node.lowId]!;
      const highNode = this.nodes[node.highId]!;

      const lowSkippedVars =
        (node.lowId <= 1 ? totalVars : lowNode.varIndex) - (node.varIndex + 1);
      const highSkippedVars =
        (node.highId <= 1 ? totalVars : highNode.varIndex) - (node.varIndex + 1);

      const lowCount = Math.pow(2, lowSkippedVars) * countPathsToOne(node.lowId);
      const highCount = Math.pow(2, highSkippedVars) * countPathsToOne(node.highId);

      const total = lowCount + highCount;
      memo.set(nodeId, total);
      return total;
    };

    if (rootId === 0) return 0;
    if (rootId === 1) return Math.pow(2, totalVars);
    const rootNode = this.nodes[rootId]!;
    const rootSkipped = rootNode.varIndex;
    return Math.pow(2, rootSkipped) * countPathsToOne(rootId);
  }
}
