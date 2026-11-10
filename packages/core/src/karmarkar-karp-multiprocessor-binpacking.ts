export interface BinPackingItem {
  id: string;
  size: number;
}

export interface PackedBin {
  binIndex: number;
  items: BinPackingItem[];
  usedCapacity: number;
  remainingCapacity: number;
}

/**
 * Karmarkar-Karp Largest Differencing Method (LDM) Number Partitioner &
 * Best-Fit Decreasing (BFD) 1D Container Bin-Packing Engine.
 */
export class KarmarkarKarpAndBinPackingScheduler {
  /**
   * Karmarkar-Karp Differencing Heuristic: repeatedly replaces the two largest numbers
   * with their absolute difference |a - b| to achieve near-zero discrepancy two-way partitioning.
   */
  public static computeKarmarkarKarpDiscrepancy(numbers: number[]): number {
    const heap = numbers.filter((n) => n > 0).map((n) => Math.abs(n));
    while (heap.length > 1) {
      heap.sort((a, b) => b - a);
      const largest = heap.shift()!;
      const secondLargest = heap.shift()!;
      const diff = Math.abs(largest - secondLargest);
      if (diff > 0) {
        heap.push(diff);
      }
    }
    return Number((heap[0] ?? 0).toFixed(6));
  }

  /**
   * Best-Fit Decreasing (BFD) 1D Bin Packing: sorts items descending by size and places each
   * item into the open bin with the minimum remaining capacity that can still fit it.
   */
  public static packBestFitDecreasing(
    items: BinPackingItem[],
    binCapacity: number
  ): { bins: PackedBin[]; totalBinsUsed: number } {
    const cap = Math.max(1, binCapacity);
    const sorted = [...items].sort((a, b) => b.size - a.size);
    const bins: PackedBin[] = [];

    for (const item of sorted) {
      if (item.size > cap) {
        throw new Error(`ITEM_EXCEEDS_BIN_CAPACITY: ${item.id} (${item.size} > ${cap})`);
      }

      let bestBinIdx = -1;
      let minRemainingAfter = Infinity;

      for (let i = 0; i < bins.length; i++) {
        const rem = bins[i]!.remainingCapacity;
        if (rem >= item.size && rem - item.size < minRemainingAfter) {
          minRemainingAfter = rem - item.size;
          bestBinIdx = i;
        }
      }

      if (bestBinIdx !== -1) {
        const target = bins[bestBinIdx]!;
        target.items.push(item);
        target.usedCapacity = Number((target.usedCapacity + item.size).toFixed(6));
        target.remainingCapacity = Number((target.remainingCapacity - item.size).toFixed(6));
      } else {
        bins.push({
          binIndex: bins.length,
          items: [item],
          usedCapacity: Number(item.size.toFixed(6)),
          remainingCapacity: Number((cap - item.size).toFixed(6))
        });
      }
    }

    return {
      bins,
      totalBinsUsed: bins.length
    };
  }
}
