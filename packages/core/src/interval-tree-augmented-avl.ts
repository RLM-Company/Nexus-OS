export interface ClosedIntervalItem<TMeta = unknown> {
  id: string;
  low: number;
  high: number;
  metadata?: TMeta;
}

interface AugmentedIntervalNode<TMeta> {
  item: ClosedIntervalItem<TMeta>;
  maxHigh: number;
  left: AugmentedIntervalNode<TMeta> | null;
  right: AugmentedIntervalNode<TMeta> | null;
}

/**
 * CLRS Augmented Interval Tree & Sweep-Line Peak Concurrency Analyzer.
 * Maintains subtree `maxHigh` bounds for O(log N + K) interval overlap queries
 * and computes exact peak concurrent overlap depth via event-point sweep line.
 */
export class AugmentedIntervalOverlapIndex<TMeta = unknown> {
  private root: AugmentedIntervalNode<TMeta> | null = null;
  private readonly allIntervals: ClosedIntervalItem<TMeta>[] = [];

  private insertNode(
    node: AugmentedIntervalNode<TMeta> | null,
    item: ClosedIntervalItem<TMeta>
  ): AugmentedIntervalNode<TMeta> {
    if (node === null) {
      return { item, maxHigh: item.high, left: null, right: null };
    }
    if (item.low < node.item.low) {
      node.left = this.insertNode(node.left, item);
    } else {
      node.right = this.insertNode(node.right, item);
    }
    node.maxHigh = Math.max(node.maxHigh, item.high);
    return node;
  }

  public insertInterval(item: ClosedIntervalItem<TMeta>): void {
    const normalized: ClosedIntervalItem<TMeta> = {
      ...item,
      low: Math.min(item.low, item.high),
      high: Math.max(item.low, item.high)
    };
    this.allIntervals.push(normalized);
    this.root = this.insertNode(this.root, normalized);
  }

  public queryOverlapping(low: number, high: number): ClosedIntervalItem<TMeta>[] {
    const qLow = Math.min(low, high);
    const qHigh = Math.max(low, high);
    const matches: ClosedIntervalItem<TMeta>[] = [];

    const search = (node: AugmentedIntervalNode<TMeta> | null) => {
      if (node === null || node.maxHigh < qLow) return;
      if (node.left !== null) search(node.left);
      if (node.item.low <= qHigh && node.item.high >= qLow) {
        matches.push(node.item);
      }
      if (node.item.low <= qHigh && node.right !== null) {
        search(node.right);
      }
    };

    search(this.root);
    return matches;
  }

  public computePeakConcurrency(): { peakConcurrentCount: number; peakTimestamp: number } {
    if (this.allIntervals.length === 0) {
      return { peakConcurrentCount: 0, peakTimestamp: 0 };
    }

    const events: Array<{ time: number; delta: number }> = [];
    for (const iv of this.allIntervals) {
      events.push({ time: iv.low, delta: +1 });
      events.push({ time: iv.high, delta: -1 });
    }

    // Sort by time ASC; on tie, process start (+1) before end (-1) for closed intervals
    events.sort((a, b) => a.time - b.time || b.delta - a.delta);

    let active = 0;
    let peakConcurrentCount = 0;
    let peakTimestamp = events[0]!.time;

    for (const ev of events) {
      active += ev.delta;
      if (active > peakConcurrentCount) {
        peakConcurrentCount = active;
        peakTimestamp = ev.time;
      }
    }

    return { peakConcurrentCount, peakTimestamp };
  }
}
