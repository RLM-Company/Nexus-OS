export interface ExactCoverCandidateRow {
  rowId: string;
  coveredElements: string[];
}

export interface ExactCoverResult {
  satisfiable: boolean;
  selectedRowIds: string[] | null;
  searchNodesExplored: number;
}

/**
 * Donald Knuth's Algorithm X / Dancing Links (DLX) Exact Cover Solver with S-Heuristic
 * (always branching on the uncovered universe element with the minimum number of candidate rows).
 */
export class KnuthAlgorithmXExactCoverSolver {
  public static solveExactCover(
    universeElements: string[],
    candidateRows: ExactCoverCandidateRow[]
  ): ExactCoverResult {
    let searchNodesExplored = 0;

    const rowCovers = new Map<string, Set<string>>();
    for (const r of candidateRows) {
      rowCovers.set(r.rowId, new Set(r.coveredElements));
    }

    const search = (
      uncoveredCols: Set<string>,
      availableRowIds: string[],
      partialSolution: string[]
    ): string[] | null => {
      searchNodesExplored++;
      if (uncoveredCols.size === 0) {
        return partialSolution;
      }

      // S-Heuristic: pick uncovered column c with minimum number of covering rows in availableRowIds
      let chosenCol: string | null = null;
      let minCoveringRows: string[] = [];
      let minCount = Infinity;

      for (const col of uncoveredCols) {
        const covering = availableRowIds.filter((rid) => rowCovers.get(rid)!.has(col));
        if (covering.length === 0) {
          return null; // Dead end: column cannot be covered!
        }
        if (covering.length < minCount) {
          minCount = covering.length;
          chosenCol = col;
          minCoveringRows = covering;
          if (minCount === 1) break;
        }
      }

      if (!chosenCol) return null;

      for (const chosenRowId of minCoveringRows) {
        const coveredByChosen = rowCovers.get(chosenRowId)!;

        // Remove all columns covered by chosenRowId
        const nextUncoveredCols = new Set<string>();
        for (const c of uncoveredCols) {
          if (!coveredByChosen.has(c)) {
            nextUncoveredCols.add(c);
          }
        }

        // Remove all candidate rows that conflict (share any element) with chosenRowId
        const nextAvailableRows = availableRowIds.filter((rid) => {
          const rSet = rowCovers.get(rid)!;
          for (const el of coveredByChosen) {
            if (rSet.has(el)) return false;
          }
          return true;
        });

        const found = search(nextUncoveredCols, nextAvailableRows, [
          ...partialSolution,
          chosenRowId
        ]);
        if (found !== null) return found;
      }

      return null;
    };

    const sol = search(
      new Set(universeElements),
      candidateRows.map((r) => r.rowId),
      []
    );

    return {
      satisfiable: sol !== null,
      selectedRowIds: sol,
      searchNodesExplored
    };
  }
}
