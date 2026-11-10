export interface HnswVectorItem<TMeta = Record<string, unknown>> {
  id: string;
  vector: number[];
  metadata?: TMeta;
}

export interface HnswSearchResult<TMeta = Record<string, unknown>> {
  id: string;
  similarity: number;
  distance: number;
  metadata?: TMeta;
}

interface HnswNode<TMeta> {
  id: string;
  vector: number[];
  metadata?: TMeta;
  maxLayer: number;
  neighborsByLayer: Map<number, Set<string>>;
}

/**
 * Pure TypeScript Hierarchical Navigable Small World (HNSW) Multi-Layer Proximity Graph
 * for Sub-Linear O(log N) Approximate Nearest Neighbor (ANN) Vector Retrieval.
 */
export class HnswHierarchicalVectorIndex<TMeta = Record<string, unknown>> {
  public readonly maxConnectionsPerLayer: number;
  public readonly efConstruction: number;
  private readonly nodes = new Map<string, HnswNode<TMeta>>();
  private entryPointId: string | null = null;
  private maxLevel = 0;

  constructor(params?: { maxConnectionsPerLayer?: number; efConstruction?: number }) {
    this.maxConnectionsPerLayer = Math.max(2, params?.maxConnectionsPerLayer ?? 8);
    this.efConstruction = Math.max(4, params?.efConstruction ?? 16);
  }

  public static cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom <= 1e-12 ? 0 : dot / denom;
  }

  public static cosineDistance(a: number[], b: number[]): number {
    return Math.max(0, 1.0 - HnswHierarchicalVectorIndex.cosineSimilarity(a, b));
  }

  /**
   * Deterministic hash-derived geometric level assignment in [0..4] for reproducible graph topology.
   */
  private assignNodeLayer(id: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    let level = 0;
    while ((h & 3) === 0 && level < 4) {
      level++;
      h >>>= 2;
    }
    return level;
  }

  private searchLayerGreedy(
    queryVec: number[],
    entryId: string,
    ef: number,
    layer: number
  ): Array<{ id: string; dist: number }> {
    const visited = new Set<string>([entryId]);
    const entryNode = this.nodes.get(entryId)!;
    const entryDist = HnswHierarchicalVectorIndex.cosineDistance(queryVec, entryNode.vector);

    const candidates: Array<{ id: string; dist: number }> = [{ id: entryId, dist: entryDist }];
    const results: Array<{ id: string; dist: number }> = [{ id: entryId, dist: entryDist }];

    while (candidates.length > 0) {
      candidates.sort((a, b) => a.dist - b.dist);
      const current = candidates.shift()!;

      results.sort((a, b) => a.dist - b.dist);
      const furthestResultDist = results[Math.min(results.length - 1, ef - 1)]!.dist;
      if (current.dist > furthestResultDist && results.length >= ef) {
        break;
      }

      const currNode = this.nodes.get(current.id)!;
      const neighbors = currNode.neighborsByLayer.get(layer);
      if (!neighbors) continue;

      for (const nbId of neighbors) {
        if (visited.has(nbId)) continue;
        visited.add(nbId);
        const nbNode = this.nodes.get(nbId);
        if (!nbNode) continue;

        const d = HnswHierarchicalVectorIndex.cosineDistance(queryVec, nbNode.vector);
        if (results.length < ef || d < furthestResultDist) {
          candidates.push({ id: nbId, dist: d });
          results.push({ id: nbId, dist: d });
          results.sort((a, b) => a.dist - b.dist);
          if (results.length > ef) {
            results.pop();
          }
        }
      }
    }

    return results.sort((a, b) => a.dist - b.dist);
  }

  public insert(item: HnswVectorItem<TMeta>): void {
    const nodeLevel = this.assignNodeLayer(item.id);
    const newNode: HnswNode<TMeta> = {
      id: item.id,
      vector: [...item.vector],
      metadata: item.metadata,
      maxLayer: nodeLevel,
      neighborsByLayer: new Map()
    };
    for (let l = 0; l <= nodeLevel; l++) {
      newNode.neighborsByLayer.set(l, new Set());
    }

    this.nodes.set(item.id, newNode);

    if (this.entryPointId === null) {
      this.entryPointId = item.id;
      this.maxLevel = nodeLevel;
      return;
    }

    let currEntryId = this.entryPointId;

    // 1. Zoom down from top layer to nodeLevel + 1 with ef = 1
    for (let l = this.maxLevel; l > nodeLevel; l--) {
      const nearest = this.searchLayerGreedy(item.vector, currEntryId, 1, l);
      if (nearest.length > 0) {
        currEntryId = nearest[0]!.id;
      }
    }

    // 2. Connect neighbors on layers min(maxLevel, nodeLevel) down to 0
    for (let l = Math.min(this.maxLevel, nodeLevel); l >= 0; l--) {
      const candidates = this.searchLayerGreedy(item.vector, currEntryId, this.efConstruction, l);
      const selected = candidates
        .filter((c) => c.id !== item.id)
        .slice(0, this.maxConnectionsPerLayer);

      for (const cand of selected) {
        newNode.neighborsByLayer.get(l)!.add(cand.id);
        const targetNode = this.nodes.get(cand.id)!;
        if (!targetNode.neighborsByLayer.has(l)) {
          targetNode.neighborsByLayer.set(l, new Set());
        }
        const targetNeighbors = targetNode.neighborsByLayer.get(l)!;
        targetNeighbors.add(item.id);

        // Prune if target exceeds maxConnectionsPerLayer
        if (targetNeighbors.size > this.maxConnectionsPerLayer) {
          const ranked = Array.from(targetNeighbors)
            .map((nid) => ({
              nid,
              dist: HnswHierarchicalVectorIndex.cosineDistance(
                targetNode.vector,
                this.nodes.get(nid)!.vector
              )
            }))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, this.maxConnectionsPerLayer);
          targetNode.neighborsByLayer.set(l, new Set(ranked.map((r) => r.nid)));
        }
      }

      if (candidates.length > 0) {
        currEntryId = candidates[0]!.id;
      }
    }

    if (nodeLevel > this.maxLevel) {
      this.maxLevel = nodeLevel;
      this.entryPointId = item.id;
    }
  }

  public searchKnn(queryVector: number[], topK = 5, efSearch = 16): HnswSearchResult<TMeta>[] {
    if (this.entryPointId === null || this.nodes.size === 0) {
      return [];
    }

    let currEntryId = this.entryPointId;
    for (let l = this.maxLevel; l >= 1; l--) {
      const nearest = this.searchLayerGreedy(queryVector, currEntryId, 1, l);
      if (nearest.length > 0) {
        currEntryId = nearest[0]!.id;
      }
    }

    const layer0Hits = this.searchLayerGreedy(
      queryVector,
      currEntryId,
      Math.max(topK, efSearch),
      0
    );

    return layer0Hits.slice(0, topK).map((hit) => {
      const node = this.nodes.get(hit.id)!;
      return {
        id: hit.id,
        similarity: Number((1.0 - hit.dist).toFixed(6)),
        distance: Number(hit.dist.toFixed(6)),
        metadata: node.metadata
      };
    });
  }

  public get size(): number {
    return this.nodes.size;
  }
}
