export interface CascadedNodeEntry {
  key: number;
  isPromotedBridge: boolean;
  nativeIndexInCurrentCatalog: number;
  bridgeIndexInNextCatalog: number;
}

export interface FractionalCascadingLookupResult {
  queryValue: number;
  lowerBoundPerCatalog: Array<{ catalogIndex: number; foundKey: number | null }>;
  binarySearchStepsTopLayer: number;
  cascadeStepsLowerLayers: number;
}

/**
 * Chazelle & Guibas Fractional Cascading Multi-Catalog Search Index.
 * Augments k sorted catalogs M_{k-1} ... M_0 bottom-up by promoting every second element
 * of M_{i+1} into M_i with direct bridge pointers, reducing k independent O(k log N)
 * binary searches to a single top-level binary search + O(1) pointer hops per catalog: O(log N + k).
 */
export class FractionalCascadingCatalogIndex {
  private readonly rawCatalogs: number[][];
  private readonly augmentedLayers: CascadedNodeEntry[][];

  public constructor(sortedCatalogs: number[][]) {
    this.rawCatalogs = sortedCatalogs.map((c) => [...c].sort((a, b) => a - b));
    this.augmentedLayers = this.buildCascadedLayers();
  }

  private buildCascadedLayers(): CascadedNodeEntry[][] {
    const k = this.rawCatalogs.length;
    if (k === 0) return [];

    const layers: CascadedNodeEntry[][] = new Array(k);

    // Bottom layer M_{k-1} has only native elements
    const bottomRaw = this.rawCatalogs[k - 1]!;
    layers[k - 1] = bottomRaw.map((key, idx) => ({
      key,
      isPromotedBridge: false,
      nativeIndexInCurrentCatalog: idx,
      bridgeIndexInNextCatalog: -1
    }));

    // Build layers i = k - 2 down to 0 by merging rawCatalogs[i] with every 2nd element of layers[i + 1]
    for (let i = k - 2; i >= 0; i--) {
      const currRaw = this.rawCatalogs[i]!;
      const nextLayer = layers[i + 1]!;

      const merged: Array<{
        key: number;
        isPromotedBridge: boolean;
        promotedFromNextIdx: number;
      }> = [];

      for (const v of currRaw) {
        merged.push({ key: v, isPromotedBridge: false, promotedFromNextIdx: -1 });
      }
      for (let j = 1; j < nextLayer.length; j += 2) {
        merged.push({
          key: nextLayer[j]!.key,
          isPromotedBridge: true,
          promotedFromNextIdx: j
        });
      }

      merged.sort((a, b) => a.key - b.key || (a.isPromotedBridge ? 1 : -1));

      // Populate nativeIndexInCurrentCatalog (lower_bound in currRaw) and bridgeIndexInNextCatalog (lower_bound in nextLayer)
      layers[i] = merged.map((entry) => {
        let nativeIdx = currRaw.findIndex((v) => v >= entry.key);
        if (nativeIdx === -1) nativeIdx = currRaw.length;

        let nextIdx = nextLayer.findIndex((n) => n.key >= entry.key);
        if (nextIdx === -1) nextIdx = nextLayer.length;

        return {
          key: entry.key,
          isPromotedBridge: entry.isPromotedBridge,
          nativeIndexInCurrentCatalog: nativeIdx,
          bridgeIndexInNextCatalog: nextIdx
        };
      });
    }

    return layers;
  }

  public queryLowerBounds(x: number): FractionalCascadingLookupResult {
    const k = this.augmentedLayers.length;
    if (k === 0) {
      return {
        queryValue: x,
        lowerBoundPerCatalog: [],
        binarySearchStepsTopLayer: 0,
        cascadeStepsLowerLayers: 0
      };
    }

    // 1. Binary search only in top layer M_0
    const top = this.augmentedLayers[0]!;
    let lo = 0;
    let hi = top.length;
    let binSteps = 0;
    while (lo < hi) {
      binSteps++;
      const mid = (lo + hi) >>> 1;
      if (top[mid]!.key < x) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    const results: Array<{ catalogIndex: number; foundKey: number | null }> = [];
    let currPos = lo;
    let cascadeSteps = 0;

    for (let i = 0; i < k; i++) {
      const layer = this.augmentedLayers[i]!;
      const raw = this.rawCatalogs[i]!;

      let nativePos: number;
      if (currPos < layer.length) {
        nativePos = layer[currPos]!.nativeIndexInCurrentCatalog;
      } else {
        nativePos = raw.length;
      }
      // Adjust if preceding element is already >= x
      while (nativePos > 0 && raw[nativePos - 1]! >= x) {
        nativePos--;
      }
      while (nativePos < raw.length && raw[nativePos]! < x) {
        nativePos++;
      }

      results.push({
        catalogIndex: i,
        foundKey: nativePos < raw.length ? raw[nativePos]! : null
      });

      // Cascade to next layer in O(1) via bridge pointer
      if (i + 1 < k) {
        const nextLayer = this.augmentedLayers[i + 1]!;
        let nextPos =
          currPos < layer.length ? layer[currPos]!.bridgeIndexInNextCatalog : nextLayer.length;
        while (nextPos > 0 && nextLayer[nextPos - 1]!.key >= x) {
          nextPos--;
          cascadeSteps++;
        }
        while (nextPos < nextLayer.length && nextLayer[nextPos]!.key < x) {
          nextPos++;
          cascadeSteps++;
        }
        currPos = nextPos;
      }
    }

    return {
      queryValue: x,
      lowerBoundPerCatalog: results,
      binarySearchStepsTopLayer: binSteps,
      cascadeStepsLowerLayers: cascadeSteps
    };
  }
}
