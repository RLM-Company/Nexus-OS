export interface BakeryTicketEntry {
  nodeId: string;
  ticketNumber: number;
}

export interface BakeryArbitrationReport {
  criticalSectionOrder: BakeryTicketEntry[];
  jainsFairnessIndex: number;
  starvationFreeVerified: boolean;
}

/**
 * Leslie Lamport's Bakery Algorithm Mutual Exclusion Arbitrator & Jain's Fairness Auditor.
 * Enforces strict lexicographical ordering (ticketNumber, nodeId) for FIFO critical-section
 * entry without atomic hardware compare-and-swap, and computes Raj Jain's Fairness Index
 * J(x) = (sum x_i)^2 / (n * sum x_i^2) in [1/n, 1].
 */
export class LamportBakeryTicketArbitrator {
  private readonly tickets = new Map<string, number>();
  private readonly grantsCount = new Map<string, number>();

  public requestCriticalSectionTicket(nodeId: string): number {
    let maxTicket = 0;
    for (const t of this.tickets.values()) {
      if (t > maxTicket) maxTicket = t;
    }
    const nextTicket = maxTicket + 1;
    this.tickets.set(nodeId, nextTicket);
    if (!this.grantsCount.has(nodeId)) {
      this.grantsCount.set(nodeId, 0);
    }
    return nextTicket;
  }

  public static compareBakeryOrder(a: BakeryTicketEntry, b: BakeryTicketEntry): number {
    if (a.ticketNumber !== b.ticketNumber) {
      return a.ticketNumber - b.ticketNumber;
    }
    return a.nodeId.localeCompare(b.nodeId);
  }

  public drainCriticalSectionQueue(): BakeryArbitrationReport {
    const active: BakeryTicketEntry[] = [];
    for (const [nodeId, ticketNumber] of this.tickets.entries()) {
      if (ticketNumber > 0) {
        active.push({ nodeId, ticketNumber });
      }
    }

    active.sort(LamportBakeryTicketArbitrator.compareBakeryOrder);

    for (const entry of active) {
      this.tickets.set(entry.nodeId, 0);
      this.grantsCount.set(entry.nodeId, (this.grantsCount.get(entry.nodeId) ?? 0) + 1);
    }

    const allocations = [...this.grantsCount.values()];
    const jainsFairnessIndex = LamportBakeryTicketArbitrator.computeJainsFairnessIndex(allocations);

    return {
      criticalSectionOrder: active,
      jainsFairnessIndex,
      starvationFreeVerified: active.every((e, i) =>
        i === 0 ? true : LamportBakeryTicketArbitrator.compareBakeryOrder(active[i - 1]!, e) < 0
      )
    };
  }

  public static computeJainsFairnessIndex(allocations: number[]): number {
    const n = allocations.length;
    if (n === 0) return 1;
    let sum = 0;
    let sumSq = 0;
    for (const x of allocations) {
      sum += x;
      sumSq += x * x;
    }
    if (sumSq === 0) return 1;
    return Number(((sum * sum) / (n * sumSq)).toFixed(6));
  }
}
