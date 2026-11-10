export interface DirectedWeightedArc {
  from: string;
  to: string;
  weight: number;
}

export interface DirectedArborescenceResult {
  reachableAll: boolean;
  totalArborescenceWeight: number;
  selectedArcs: DirectedWeightedArc[];
}

/**
 * Chu-Liu / Jack Edmonds Optimum Branching (Minimum-Weight Directed Spanning Arborescence) Engine.
 * Finds a minimum-cost directed spanning tree rooted at `root` by selecting each node's minimum
 * incoming arc, contracting any directed cycles into supernodes with reduced edge costs
 * w'(u, v) = w(u, v) - w(in(v)), and expanding recursively in O(V E) time.
 */
export class ChuLiuEdmondsDirectedMstEngine {
  public static computeMinDirectedArborescence(
    nodes: string[],
    root: string,
    arcs: DirectedWeightedArc[]
  ): DirectedArborescenceResult {
    const idxByNode = new Map<string, number>(nodes.map((id, i) => [id, i]));
    const rootIdx = idxByNode.get(root);
    if (rootIdx === undefined) {
      return { reachableAll: false, totalArborescenceWeight: Infinity, selectedArcs: [] };
    }

    interface InternalEdge {
      u: number;
      v: number;
      w: number;
      orig: DirectedWeightedArc;
    }

    const solveRecursive = (
      numVertices: number,
      r: number,
      edgeList: InternalEdge[]
    ): DirectedWeightedArc[] | null => {
      // 1. For each v != r, find minimum weight incoming edge
      const minInEdge = new Array<InternalEdge | null>(numVertices).fill(null);
      for (const e of edgeList) {
        if (e.u === e.v || e.v === r) continue;
        const curr = minInEdge[e.v];
        if (!curr || e.w < curr.w) {
          minInEdge[e.v] = e;
        }
      }

      for (let v = 0; v < numVertices; v++) {
        if (v !== r && minInEdge[v] === null) {
          return null; // Unreachable vertex
        }
      }

      // 2. Detect directed cycles among minInEdge choices
      const compId = new Array<number>(numVertices).fill(-1);
      const visitedTag = new Array<number>(numVertices).fill(-1);
      let numCycles = 0;

      for (let v = 0; v < numVertices; v++) {
        if (v === r) continue;
        let curr = v;
        while (
          curr !== r &&
          visitedTag[curr] === -1 &&
          compId[curr] === -1
        ) {
          visitedTag[curr] = v;
          curr = minInEdge[curr]!.u;
        }
        if (curr !== r && visitedTag[curr] === v) {
          // Found a cycle
          let nodeInCycle = curr;
          do {
            compId[nodeInCycle] = numCycles;
            nodeInCycle = minInEdge[nodeInCycle]!.u;
          } while (nodeInCycle !== curr);
          numCycles++;
        }
      }

      if (numCycles === 0) {
        // No cycles: minInEdge forms a valid directed spanning arborescence!
        const chosen: DirectedWeightedArc[] = [];
        for (let v = 0; v < numVertices; v++) {
          if (v !== r && minInEdge[v]) {
            chosen.push(minInEdge[v]!.orig);
          }
        }
        return chosen;
      }

      // Assign remaining non-cycle vertices unique component IDs
      let nextComp = numCycles;
      for (let v = 0; v < numVertices; v++) {
        if (compId[v] === -1) {
          compId[v] = nextComp++;
        }
      }

      // 3. Contract cycles and adjust weights: w'(u, v) = w(u, v) - minInEdge[v].w
      const contractedEdges: InternalEdge[] = [];
      for (const e of edgeList) {
        const cu = compId[e.u]!;
        const cv = compId[e.v]!;
        if (cu !== cv) {
          const inCost = minInEdge[e.v]?.w ?? 0;
          contractedEdges.push({
            u: cu,
            v: cv,
            w: e.w - inCost,
            orig: e.orig
          });
        }
      }

      const subChosen = solveRecursive(nextComp, compId[r]!, contractedEdges);
      if (!subChosen) return null;

      // 4. Expand: replace the cycle-entering edge's target in each cycle
      const chosenByTargetOrig = new Map<string, DirectedWeightedArc>();
      for (let v = 0; v < numVertices; v++) {
        if (v !== r && compId[v]! < numCycles) {
          const arc = minInEdge[v]!.orig;
          chosenByTargetOrig.set(arc.to, arc);
        }
      }
      for (const arc of subChosen) {
        chosenByTargetOrig.set(arc.to, arc);
      }

      return [...chosenByTargetOrig.values()];
    };

    const initialEdges: InternalEdge[] = [];
    for (const a of arcs) {
      const u = idxByNode.get(a.from);
      const v = idxByNode.get(a.to);
      if (u !== undefined && v !== undefined && u !== v) {
        initialEdges.push({ u, v, w: a.weight, orig: a });
      }
    }

    const selected = solveRecursive(nodes.length, rootIdx, initialEdges);
    if (!selected) {
      return { reachableAll: false, totalArborescenceWeight: Infinity, selectedArcs: [] };
    }

    const totalWeight = Number(selected.reduce((acc, e) => acc + e.weight, 0).toFixed(6));
    return {
      reachableAll: true,
      totalArborescenceWeight: totalWeight,
      selectedArcs: selected
    };
  }
}
