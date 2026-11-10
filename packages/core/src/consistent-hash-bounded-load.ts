export interface BoundedLoadPlacement {
  key: string;
  assignedNodeId: string;
  hopsSkippedForCapacity: number;
  nodeCurrentLoad: number;
  maxAllowedLoadPerNode: number;
}

/**
 * Mirrokni et al. Consistent Hashing Ring with Virtual Nodes & Bounded Load (1 + epsilon).
 * Guarantees that no shard/worker exceeds ceil((1 + epsilon) * (totalLoad / activeNodes))
 * while preserving consistent hashing locality.
 */
export class ConsistentHashBoundedLoadRing {
  public readonly virtualNodesPerShard: number;
  public readonly loadFactorEpsilon: number;
  private readonly ring: Array<{ hash: number; nodeId: string }> = [];
  private readonly nodeLoads = new Map<string, number>();
  private totalActiveLoad = 0;

  constructor(params?: {
    virtualNodesPerShard?: number;
    loadFactorEpsilon?: number;
    initialNodes?: string[];
  }) {
    this.virtualNodesPerShard = Math.max(4, params?.virtualNodesPerShard ?? 32);
    this.loadFactorEpsilon = Math.max(0.05, params?.loadFactorEpsilon ?? 0.25);
    for (const n of params?.initialNodes ?? []) {
      this.addNode(n);
    }
  }

  public static fnv1aHash(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  public addNode(nodeId: string): void {
    if (this.nodeLoads.has(nodeId)) return;
    this.nodeLoads.set(nodeId, 0);
    for (let v = 0; v < this.virtualNodesPerShard; v++) {
      const h = ConsistentHashBoundedLoadRing.fnv1aHash(`${nodeId}#vnode#${v}`);
      this.ring.push({ hash: h, nodeId });
    }
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  public assignKeyWithBoundedLoad(key: string): BoundedLoadPlacement {
    if (this.ring.length === 0 || this.nodeLoads.size === 0) {
      throw new Error("EMPTY_CONSISTENT_HASH_RING");
    }

    const keyHash = ConsistentHashBoundedLoadRing.fnv1aHash(key);
    const numNodes = this.nodeLoads.size;
    const maxAllowedLoadPerNode = Math.max(
      1,
      Math.ceil(((1.0 + this.loadFactorEpsilon) * (this.totalActiveLoad + 1)) / numNodes)
    );

    // Binary search for first vnode with hash >= keyHash
    let lo = 0;
    let hi = this.ring.length - 1;
    let startIdx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid]!.hash >= keyHash) {
        startIdx = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    let hops = 0;
    for (let offset = 0; offset < this.ring.length; offset++) {
      const vnode = this.ring[(startIdx + offset) % this.ring.length]!;
      const curLoad = this.nodeLoads.get(vnode.nodeId) ?? 0;
      if (curLoad < maxAllowedLoadPerNode) {
        this.nodeLoads.set(vnode.nodeId, curLoad + 1);
        this.totalActiveLoad++;
        return {
          key,
          assignedNodeId: vnode.nodeId,
          hopsSkippedForCapacity: hops,
          nodeCurrentLoad: curLoad + 1,
          maxAllowedLoadPerNode
        };
      }
      hops++;
    }

    // Fallback if all nodes hit cap simultaneously
    const fallbackNode = this.ring[startIdx]!.nodeId;
    const nextLoad = (this.nodeLoads.get(fallbackNode) ?? 0) + 1;
    this.nodeLoads.set(fallbackNode, nextLoad);
    this.totalActiveLoad++;
    return {
      key,
      assignedNodeId: fallbackNode,
      hopsSkippedForCapacity: hops,
      nodeCurrentLoad: nextLoad,
      maxAllowedLoadPerNode
    };
  }

  public getLoadDistribution(): Record<string, number> {
    return Object.fromEntries(this.nodeLoads.entries());
  }
}
