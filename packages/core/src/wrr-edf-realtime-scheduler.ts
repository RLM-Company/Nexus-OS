export interface RealtimePeriodicTask {
  taskId: string;
  executionTimeMs: number; // C_i
  periodMs: number; // T_i
  absoluteDeadlineMs: number;
}

export interface EdfSchedulabilityReport {
  cpuUtilization: number;
  isSchedulableUnderEdf: boolean;
  orderedSchedule: RealtimePeriodicTask[];
}

/**
 * Earliest Deadline First (EDF) Real-Time Task Scheduler + Nginx-Style Smooth Weighted Round-Robin (SWRR).
 * Evaluates Liu & Layland exact EDF schedulability condition (sum(C_i / T_i) <= 1.0)
 * and smooth weighted round-robin peer selection without burstiness.
 */
export class EdfAndWeightedRoundRobinScheduler {
  private readonly weights = new Map<string, number>();
  private readonly currentWeights = new Map<string, number>();

  public static evaluateEdfSchedule(tasks: RealtimePeriodicTask[]): EdfSchedulabilityReport {
    let cpuUtilization = 0;
    for (const t of tasks) {
      cpuUtilization += t.executionTimeMs / Math.max(1, t.periodMs);
    }

    const orderedSchedule = [...tasks].sort(
      (a, b) =>
        a.absoluteDeadlineMs - b.absoluteDeadlineMs ||
        a.executionTimeMs - b.executionTimeMs
    );

    return {
      cpuUtilization: Number(cpuUtilization.toFixed(6)),
      isSchedulableUnderEdf: cpuUtilization <= 1.0 + 1e-9,
      orderedSchedule
    };
  }

  public registerWeightedPeer(peerId: string, weight: number): void {
    const w = Math.max(1, Math.floor(weight));
    this.weights.set(peerId, w);
    this.currentWeights.set(peerId, 0);
  }

  /**
   * Nginx Smooth Weighted Round-Robin (SWRR):
   * On each step, adds static weight to currentWeight for every peer, selects peer with max currentWeight,
   * and subtracts totalWeight from the winner's currentWeight.
   */
  public nextSmoothWeightedPeer(): string | null {
    if (this.weights.size === 0) return null;

    let totalWeight = 0;
    let bestPeer: string | null = null;
    let bestCurrent = -Infinity;

    for (const [peerId, w] of this.weights.entries()) {
      totalWeight += w;
      const updated = (this.currentWeights.get(peerId) ?? 0) + w;
      this.currentWeights.set(peerId, updated);
      if (updated > bestCurrent) {
        bestCurrent = updated;
        bestPeer = peerId;
      }
    }

    if (bestPeer !== null) {
      this.currentWeights.set(bestPeer, bestCurrent - totalWeight);
    }
    return bestPeer;
  }
}
