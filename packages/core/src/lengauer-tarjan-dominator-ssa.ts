export interface CfgBasicBlock {
  id: string;
  successors: string[];
  defs?: string[]; // Variables assigned in this block
  uses?: string[]; // Variables read before assignment in this block
}

export interface DominatorAndSsaReport {
  immediateDominators: Record<string, string | null>;
  dominanceFrontiers: Record<string, string[]>;
  ssaPhiPlacementsByVariable: Record<string, string[]>; // varName -> blockIds requiring Phi(var)
  liveInByBlock: Record<string, string[]>;
  liveOutByBlock: Record<string, string[]>;
}

/**
 * Cooper-Harvey-Kennedy Iterative Dominator Tree, Dominance Frontier,
 * Cytron Static Single Assignment (SSA Phi-Node Placement), and Backward Liveness Dataflow Engine.
 */
export class ControlFlowDominatorAndSsaAnalyzer {
  public static analyzeCfg(
    entryBlockId: string,
    blocks: CfgBasicBlock[]
  ): DominatorAndSsaReport {
    const blockMap = new Map<string, CfgBasicBlock>();
    const predecessors = new Map<string, string[]>();
    for (const b of blocks) {
      blockMap.set(b.id, b);
      predecessors.set(b.id, []);
    }
    for (const b of blocks) {
      for (const succ of b.successors) {
        if (!predecessors.has(succ)) predecessors.set(succ, []);
        predecessors.get(succ)!.push(b.id);
      }
    }

    // 1. Reverse Post-Order (RPO) traversal from entryBlockId
    const visited = new Set<string>();
    const postOrder: string[] = [];
    const dfs = (u: string) => {
      visited.add(u);
      const blk = blockMap.get(u);
      for (const v of blk?.successors ?? []) {
        if (!visited.has(v)) dfs(v);
      }
      postOrder.push(u);
    };
    dfs(entryBlockId);
    const rpo = [...postOrder].reverse();
    const rpoIndex = new Map<string, number>();
    rpo.forEach((id, idx) => rpoIndex.set(id, idx));

    // 2. Cooper-Harvey-Kennedy Fast Iterative Immediate Dominators (idom)
    const idom = new Map<string, string>();
    idom.set(entryBlockId, entryBlockId);

    const intersect = (b1: string, b2: string): string => {
      let finger1 = b1;
      let finger2 = b2;
      while (finger1 !== finger2) {
        while ((rpoIndex.get(finger1) ?? Infinity) > (rpoIndex.get(finger2) ?? Infinity)) {
          finger1 = idom.get(finger1)!;
        }
        while ((rpoIndex.get(finger2) ?? Infinity) > (rpoIndex.get(finger1) ?? Infinity)) {
          finger2 = idom.get(finger2)!;
        }
      }
      return finger1;
    };

    let changed = true;
    while (changed) {
      changed = false;
      for (const b of rpo) {
        if (b === entryBlockId) continue;
        const preds = (predecessors.get(b) ?? []).filter((p) => idom.has(p));
        if (preds.length === 0) continue;
        let newIdom = preds[0]!;
        for (let i = 1; i < preds.length; i++) {
          newIdom = intersect(preds[i]!, newIdom);
        }
        if (idom.get(b) !== newIdom) {
          idom.set(b, newIdom);
          changed = true;
        }
      }
    }

    // 3. Dominance Frontier (DF) calculation
    const df = new Map<string, Set<string>>();
    for (const b of rpo) df.set(b, new Set());

    for (const b of rpo) {
      const preds = (predecessors.get(b) ?? []).filter((p) => rpoIndex.has(p));
      if (preds.length >= 2) {
        for (const p of preds) {
          let runner = p;
          while (runner !== idom.get(b)) {
            df.get(runner)!.add(b);
            runner = idom.get(runner)!;
          }
        }
      }
    }

    // 4. Cytron Iterated Dominance Frontier for SSA Phi-Node Placement
    const defBlocksByVar = new Map<string, Set<string>>();
    for (const b of blocks) {
      if (!rpoIndex.has(b.id)) continue;
      for (const v of b.defs ?? []) {
        if (!defBlocksByVar.has(v)) defBlocksByVar.set(v, new Set());
        defBlocksByVar.get(v)!.add(b.id);
      }
    }

    const ssaPhiPlacementsByVariable: Record<string, string[]> = {};
    for (const [varName, defBlocks] of defBlocksByVar.entries()) {
      const phiBlocks = new Set<string>();
      const worklist = Array.from(defBlocks);
      const inWorklist = new Set<string>(worklist);

      while (worklist.length > 0) {
        const x = worklist.shift()!;
        for (const y of df.get(x) ?? []) {
          if (!phiBlocks.has(y)) {
            phiBlocks.add(y);
            if (!inWorklist.has(y)) {
              inWorklist.add(y);
              worklist.push(y);
            }
          }
        }
      }
      ssaPhiPlacementsByVariable[varName] = Array.from(phiBlocks).sort();
    }

    // 5. Backward Dataflow Liveness Analysis
    const liveIn = new Map<string, Set<string>>();
    const liveOut = new Map<string, Set<string>>();
    for (const b of blocks) {
      liveIn.set(b.id, new Set());
      liveOut.set(b.id, new Set());
    }

    let liveChanged = true;
    while (liveChanged) {
      liveChanged = false;
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i]!;
        const nextOut = new Set<string>();
        for (const s of b.successors) {
          for (const v of liveIn.get(s) ?? []) nextOut.add(v);
        }

        const defsSet = new Set<string>(b.defs ?? []);
        const nextIn = new Set<string>(b.uses ?? []);
        for (const v of nextOut) {
          if (!defsSet.has(v)) nextIn.add(v);
        }

        if (
          nextOut.size !== liveOut.get(b.id)!.size ||
          nextIn.size !== liveIn.get(b.id)!.size
        ) {
          liveOut.set(b.id, nextOut);
          liveIn.set(b.id, nextIn);
          liveChanged = true;
        }
      }
    }

    const immediateDominators: Record<string, string | null> = {};
    const dominanceFrontiers: Record<string, string[]> = {};
    const liveInByBlock: Record<string, string[]> = {};
    const liveOutByBlock: Record<string, string[]> = {};

    for (const b of blocks) {
      immediateDominators[b.id] =
        b.id === entryBlockId ? null : (idom.get(b.id) ?? null);
      dominanceFrontiers[b.id] = Array.from(df.get(b.id) ?? []).sort();
      liveInByBlock[b.id] = Array.from(liveIn.get(b.id) ?? []).sort();
      liveOutByBlock[b.id] = Array.from(liveOut.get(b.id) ?? []).sort();
    }

    return {
      immediateDominators,
      dominanceFrontiers,
      ssaPhiPlacementsByVariable,
      liveInByBlock,
      liveOutByBlock
    };
  }
}
