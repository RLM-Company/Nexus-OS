export interface LiveRangeVariable {
  varId: string;
  startStep: number;
  endStep: number;
}

export interface RegisterAllocationResult {
  registerAssignmentByVar: Record<string, number | null>; // null means spilled to memory
  spilledVariableIds: string[];
  registersUsedCount: number;
}

/**
 * Poletto & Sarkar Linear-Scan Register / Execution-Slot Allocator.
 * Assigns K bounded physical registers/slots to overlapping variable live intervals in O(N log N)
 * time, spilling the interval with the furthest end point whenever all K registers are occupied.
 */
export class LinearScanAndGraphColoringAllocator {
  public static allocateLinearScan(
    intervals: LiveRangeVariable[],
    numPhysicalRegistersK: number
  ): RegisterAllocationResult {
    const k = Math.max(1, numPhysicalRegistersK);
    const sorted = [...intervals].sort(
      (a, b) => a.startStep - b.startStep || a.endStep - b.endStep
    );

    const freeRegs: number[] = Array.from({ length: k }, (_, i) => i);
    // Active intervals sorted by increasing endStep
    const active: Array<{ interval: LiveRangeVariable; reg: number }> = [];
    const registerAssignmentByVar: Record<string, number | null> = {};
    const spilledVariableIds: string[] = [];
    const usedRegSet = new Set<number>();

    const expireOldIntervals = (currentStart: number) => {
      active.sort((a, b) => a.interval.endStep - b.interval.endStep);
      while (active.length > 0 && active[0]!.interval.endStep < currentStart) {
        const expired = active.shift()!;
        freeRegs.push(expired.reg);
        freeRegs.sort((a, b) => a - b);
      }
    };

    for (const iv of sorted) {
      expireOldIntervals(iv.startStep);

      if (active.length === k) {
        // Spill either the active interval with the latest endStep or current interval `iv`
        active.sort((a, b) => a.interval.endStep - b.interval.endStep);
        const spillCandidate = active[active.length - 1]!;
        if (spillCandidate.interval.endStep > iv.endStep) {
          registerAssignmentByVar[iv.varId] = spillCandidate.reg;
          registerAssignmentByVar[spillCandidate.interval.varId] = null;
          spilledVariableIds.push(spillCandidate.interval.varId);
          active.pop();
          active.push({ interval: iv, reg: spillCandidate.reg });
        } else {
          registerAssignmentByVar[iv.varId] = null;
          spilledVariableIds.push(iv.varId);
        }
      } else {
        const reg = freeRegs.shift()!;
        usedRegSet.add(reg);
        registerAssignmentByVar[iv.varId] = reg;
        active.push({ interval: iv, reg });
      }
    }

    return {
      registerAssignmentByVar,
      spilledVariableIds,
      registersUsedCount: usedRegSet.size
    };
  }
}
