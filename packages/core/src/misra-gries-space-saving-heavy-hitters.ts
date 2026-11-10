export interface SpaceSavingItemEntry {
  item: string;
  estimatedCount: number;
  maxOverestimationError: number;
  guaranteedLowerBound: number;
}

/**
 * Misra-Gries Deterministic Frequent Items Summary & Metwally Space-Saving Heavy-Hitter Tracker.
 * - Misra-Gries maintains at most k - 1 counters and decrements all counters on a full-table miss,
 *   guaranteeing every item with true frequency > N / k is retained.
 * - Space-Saving replaces the minimum-count entry on a miss with (minCount + 1, error = minCount),
 *   providing tight [estimatedCount - error, estimatedCount] frequency bounds.
 */
export class MisraGriesAndSpaceSavingFrequentItems {
  private readonly capacityK: number;
  private readonly mgCounters = new Map<string, number>();
  private readonly ssCounters = new Map<string, { count: number; error: number }>();
  private totalStreamLengthN = 0;

  public constructor(capacityK: number = 5) {
    this.capacityK = Math.max(2, capacityK);
  }

  public ingest(item: string): void {
    this.totalStreamLengthN++;

    // 1. Misra-Gries update (at most k - 1 counters)
    if (this.mgCounters.has(item)) {
      this.mgCounters.set(item, this.mgCounters.get(item)! + 1);
    } else if (this.mgCounters.size < this.capacityK - 1) {
      this.mgCounters.set(item, 1);
    } else {
      for (const [k, v] of [...this.mgCounters.entries()]) {
        if (v <= 1) {
          this.mgCounters.delete(k);
        } else {
          this.mgCounters.set(k, v - 1);
        }
      }
    }

    // 2. Space-Saving update (at most k counters)
    const existing = this.ssCounters.get(item);
    if (existing) {
      existing.count += 1;
    } else if (this.ssCounters.size < this.capacityK) {
      this.ssCounters.set(item, { count: 1, error: 0 });
    } else {
      // Evict item with minimum count
      let minKey: string | null = null;
      let minVal = Infinity;
      for (const [k, entry] of this.ssCounters.entries()) {
        if (entry.count < minVal) {
          minVal = entry.count;
          minKey = k;
        }
      }
      if (minKey !== null) {
        this.ssCounters.delete(minKey);
        this.ssCounters.set(item, { count: minVal + 1, error: minVal });
      }
    }
  }

  public getMisraGriesCandidates(): Array<{ item: string; residualCount: number }> {
    return [...this.mgCounters.entries()]
      .map(([item, residualCount]) => ({ item, residualCount }))
      .sort((a, b) => b.residualCount - a.residualCount || a.item.localeCompare(b.item));
  }

  public getSpaceSavingTopK(): SpaceSavingItemEntry[] {
    return [...this.ssCounters.entries()]
      .map(([item, { count, error }]) => ({
        item,
        estimatedCount: count,
        maxOverestimationError: error,
        guaranteedLowerBound: count - error
      }))
      .sort((a, b) => b.estimatedCount - a.estimatedCount || a.item.localeCompare(b.item));
  }

  public getTotalStreamLength(): number {
    return this.totalStreamLengthN;
  }
}
