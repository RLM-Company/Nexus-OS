export interface OrderedAstNode {
  label: string;
  children?: OrderedAstNode[];
}

export interface TreeEditOperation {
  kind: "match" | "relabel" | "insert" | "delete";
  sourceLabel?: string;
  targetLabel?: string;
  cost: number;
}

export interface TreeDiffResult {
  editDistance: number;
  normalizedSimilarity: number;
  operations: TreeEditOperation[];
}

/**
 * Ordered AST / DOM Tree Edit Distance and Minimal Edit Script Generator.
 * Computes exact ordered tree edit distance (insert node, delete node, relabel node)
 * via recursive forest dynamic programming (Selkow / Zhang-Shasha ordered subtree alignment).
 */
export class OrderedTreeEditDistanceDiffer {
  public static countNodes(node: OrderedAstNode): number {
    let count = 1;
    for (const child of node.children ?? []) {
      count += OrderedTreeEditDistanceDiffer.countNodes(child);
    }
    return count;
  }

  public static computeTreeDiff(
    sourceTree: OrderedAstNode,
    targetTree: OrderedAstNode
  ): TreeDiffResult {
    const solveSubtree = (
      a: OrderedAstNode,
      b: OrderedAstNode
    ): { cost: number; ops: TreeEditOperation[] } => {
      const aChildren = a.children ?? [];
      const bChildren = b.children ?? [];
      const m = aChildren.length;
      const n = bChildren.length;

      // Precomputesubtree deletion/insertion costs and pairwise child alignments
      const deleteTree = (node: OrderedAstNode): { cost: number; ops: TreeEditOperation[] } => {
        const ops: TreeEditOperation[] = [{ kind: "delete", sourceLabel: node.label, cost: 1 }];
        let cost = 1;
        for (const c of node.children ?? []) {
          const sub = deleteTree(c);
          cost += sub.cost;
          ops.push(...sub.ops);
        }
        return { cost, ops };
      };

      const insertTree = (node: OrderedAstNode): { cost: number; ops: TreeEditOperation[] } => {
        const ops: TreeEditOperation[] = [{ kind: "insert", targetLabel: node.label, cost: 1 }];
        let cost = 1;
        for (const c of node.children ?? []) {
          const sub = insertTree(c);
          cost += sub.cost;
          ops.push(...sub.ops);
        }
        return { cost, ops };
      };

      const dp: Array<Array<{ cost: number; ops: TreeEditOperation[] }>> = Array.from(
        { length: m + 1 },
        () => Array.from({ length: n + 1 }, () => ({ cost: 0, ops: [] }))
      );

      for (let i = 1; i <= m; i++) {
        const del = deleteTree(aChildren[i - 1]!);
        dp[i]![0] = {
          cost: dp[i - 1]![0]!.cost + del.cost,
          ops: [...dp[i - 1]![0]!.ops, ...del.ops]
        };
      }
      for (let j = 1; j <= n; j++) {
        const ins = insertTree(bChildren[j - 1]!);
        dp[0]![j] = {
          cost: dp[0]![j - 1]!.cost + ins.cost,
          ops: [...dp[0]![j - 1]!.ops, ...ins.ops]
        };
      }

      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          const delChild = deleteTree(aChildren[i - 1]!);
          const insChild = insertTree(bChildren[j - 1]!);
          const alignChild = solveSubtree(aChildren[i - 1]!, bChildren[j - 1]!);

          const optDel = dp[i - 1]![j]!.cost + delChild.cost;
          const optIns = dp[i]![j - 1]!.cost + insChild.cost;
          const optAlign = dp[i - 1]![j - 1]!.cost + alignChild.cost;

          if (optAlign <= optDel && optAlign <= optIns) {
            dp[i]![j] = {
              cost: optAlign,
              ops: [...dp[i - 1]![j - 1]!.ops, ...alignChild.ops]
            };
          } else if (optDel <= optIns) {
            dp[i]![j] = {
              cost: optDel,
              ops: [...dp[i - 1]![j]!.ops, ...delChild.ops]
            };
          } else {
            dp[i]![j] = {
              cost: optIns,
              ops: [...dp[i]![j - 1]!.ops, ...insChild.ops]
            };
          }
        }
      }

      const rootCost = a.label === b.label ? 0 : 1;
      const rootOp: TreeEditOperation =
        rootCost === 0
          ? { kind: "match", sourceLabel: a.label, targetLabel: b.label, cost: 0 }
          : { kind: "relabel", sourceLabel: a.label, targetLabel: b.label, cost: 1 };

      return {
        cost: rootCost + dp[m]![n]!.cost,
        ops: [rootOp, ...dp[m]![n]!.ops]
      };
    };

    const res = solveSubtree(sourceTree, targetTree);
    const totalNodes =
      OrderedTreeEditDistanceDiffer.countNodes(sourceTree) +
      OrderedTreeEditDistanceDiffer.countNodes(targetTree);
    const normalizedSimilarity =
      totalNodes === 0 ? 1 : Number(Math.max(0, 1 - res.cost / totalNodes).toFixed(6));

    return {
      editDistance: res.cost,
      normalizedSimilarity,
      operations: res.ops
    };
  }
}
