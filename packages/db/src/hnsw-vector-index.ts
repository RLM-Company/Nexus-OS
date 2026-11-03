/**
 * Kosmora / Nexus-OS HNSW (Hierarchical Navigable Small World) Graph Vector Index (Wave 22)
 *
 * Implements Malkov & Yashunin's multi-layer Navigable Small World graph for O(log N)
 * Approximate Nearest Neighbor (ANN) semantic vector search over 64-dimensional embeddings.
 *
 * Capabilities:
 * 1. Probabilistic exponential level assignment (`level = floor(-ln(U) * mL)`).
 * 2. Greedy top-down zoom-in from `maxLayer` down to layer `l_c + 1`, followed by bounded
 *    beam search (`efConstruction` / `efSearch`) and neighbor pruning (`M`, `Mmax0`).
 * 3. SQLite persistence (`kosmora_hnsw_index_snapshots`) for zero-cold-start restoration.
 */

import type { DatabaseSync } from "node:sqlite";
import {
  generateDenseSemanticVector,
  computeCosineSimilarity,
  VECTOR_DIMENSION
} from "./dense-vector-semantic-search.ts";

export interface HnswConfig {
  M?: number; // Max bidirectional links per node per layer (default 16)
  efConstruction?: number; // Candidate beam size during insertion (default 64)
  efSearch?: number; // Candidate beam size during search (default 48)
  seed?: number;
}

export interface HnswSearchResult {
  id: string;
  similarity: number;
  metadata?: Record<string, any>;
}

interface HnswNode {
  id: string;
  vector: Float32Array;
  level: number;
  neighborsByLayer: Array<Set<string>>;
  metadata?: Record<string, any>;
}

function createMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.max(1e-9, ((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

export class HnswVectorIndex {
  private readonly M: number;
  private readonly Mmax0: number;
  private readonly mL: number;
  private readonly efConstruction: number;
  private readonly efSearch: number;
  private readonly rng: () => number;

  private readonly nodes = new Map<string, HnswNode>();
  private entryPointId: string | null = null;
  private maxLevel = -1;

  constructor(config?: HnswConfig) {
    this.M = Math.max(4, config?.M ?? 16);
    this.Mmax0 = this.M * 2;
    this.mL = 1.0 / Math.log(this.M);
    this.efConstruction = Math.max(this.M * 2, config?.efConstruction ?? 64);
    this.efSearch = Math.max(16, config?.efSearch ?? 48);
    this.rng = createMulberry32(config?.seed ?? 0x20261102);
  }

  public size(): number {
    return this.nodes.size;
  }

  public getMaxLevel(): number {
    return this.maxLevel;
  }

  /**
   * Inserts a text or precomputed Float32Array vector into the multi-layer HNSW graph.
   */
  public insert(
    id: string,
    input: string | Float32Array,
    metadata?: Record<string, any>
  ): void {
    const vec =
      typeof input === "string" ? generateDenseSemanticVector(input) : input;

    const level = Math.floor(-Math.log(this.rng()) * this.mL);
    const neighborsByLayer: Array<Set<string>> = [];
    for (let l = 0; l <= level; l++) {
      neighborsByLayer.push(new Set<string>());
    }

    const newNode: HnswNode = {
      id,
      vector: vec,
      level,
      neighborsByLayer,
      metadata
    };

    if (!this.entryPointId || !this.nodes.has(this.entryPointId)) {
      this.nodes.set(id, newNode);
      this.entryPointId = id;
      this.maxLevel = level;
      return;
    }

    this.nodes.set(id, newNode);

    let currObjId = this.entryPointId;
    let currSim = this.sim(vec, this.nodes.get(currObjId)!.vector);

    // Phase 1: Greedy zoom-in from top layer down to level + 1
    for (let l = this.maxLevel; l > level; l--) {
      let changed = true;
      while (changed) {
        changed = false;
        const currNode = this.nodes.get(currObjId)!;
        const neighbors = currNode.neighborsByLayer[l];
        if (!neighbors) break;
        for (const nId of neighbors) {
          if (nId === id) continue;
          const nNode = this.nodes.get(nId);
          if (!nNode) continue;
          const s = this.sim(vec, nNode.vector);
          if (s > currSim) {
            currSim = s;
            currObjId = nId;
            changed = true;
          }
        }
      }
    }

    // Phase 2: Beam search & bidirectional edge linking from min(level, maxLevel) down to 0
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const candidates = this.searchLayer(vec, currObjId, this.efConstruction, l, id);
      const maxLinks = l === 0 ? this.Mmax0 : this.M;
      const selected = candidates.slice(0, maxLinks);

      for (const cand of selected) {
        newNode.neighborsByLayer[l].add(cand.id);
        const targetNode = this.nodes.get(cand.id);
        if (targetNode && targetNode.neighborsByLayer[l]) {
          targetNode.neighborsByLayer[l].add(id);
          if (targetNode.neighborsByLayer[l].size > maxLinks) {
            this.pruneNeighbors(targetNode, l, maxLinks);
          }
        }
      }

      if (candidates.length > 0) {
        currObjId = candidates[0].id;
      }
    }

    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPointId = id;
    }
  }

  /**
   * Queries the HNSW graph for the top-K approximate nearest neighbors in O(log N) hops.
   */
  public searchKnn(
    query: string | Float32Array,
    topK = 5,
    ef?: number
  ): HnswSearchResult[] {
    if (!this.entryPointId || this.nodes.size === 0) {
      return [];
    }

    const queryVec =
      typeof query === "string" ? generateDenseSemanticVector(query) : query;

    let currObjId = this.entryPointId;
    let currSim = this.sim(queryVec, this.nodes.get(currObjId)!.vector);

    // Greedy descent down to layer 1
    for (let l = this.maxLevel; l >= 1; l--) {
      let changed = true;
      while (changed) {
        changed = false;
        const currNode = this.nodes.get(currObjId)!;
        const neighbors = currNode.neighborsByLayer[l];
        if (!neighbors) break;
        for (const nId of neighbors) {
          const nNode = this.nodes.get(nId);
          if (!nNode) continue;
          const s = this.sim(queryVec, nNode.vector);
          if (s > currSim) {
            currSim = s;
            currObjId = nId;
            changed = true;
          }
        }
      }
    }

    // Beam search on base layer 0
    const beamSize = Math.max(topK * 4, ef ?? this.efSearch);
    const candidates = this.searchLayer(queryVec, currObjId, beamSize, 0);

    return candidates.slice(0, topK).map((c) => {
      const node = this.nodes.get(c.id)!;
      return {
        id: c.id,
        similarity: Number(c.sim.toFixed(4)),
        metadata: node.metadata
      };
    });
  }

  /**
   * Serializes the entire HNSW graph into SQLite for fast reload.
   */
  public saveToSqlite(sqlite: DatabaseSync, ownerId: string, indexName = "default"): void {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_hnsw_index_snapshots (
        owner_id TEXT NOT NULL,
        index_name TEXT NOT NULL,
        graph_json TEXT NOT NULL,
        node_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, index_name)
      );
    `);

    const serializedNodes = Array.from(this.nodes.values()).map((n) => ({
      id: n.id,
      vectorBase64: Buffer.from(
        n.vector.buffer,
        n.vector.byteOffset,
        n.vector.byteLength
      ).toString("base64"),
      level: n.level,
      neighborsByLayer: n.neighborsByLayer.map((set) => Array.from(set)),
      metadata: n.metadata
    }));

    const payload = JSON.stringify({
      entryPointId: this.entryPointId,
      maxLevel: this.maxLevel,
      nodes: serializedNodes
    });

    sqlite
      .prepare(
        `INSERT INTO kosmora_hnsw_index_snapshots (
          owner_id, index_name, graph_json, node_count, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, index_name) DO UPDATE SET
          graph_json = excluded.graph_json,
          node_count = excluded.node_count,
          updated_at = excluded.updated_at`
      )
      .run(ownerId, indexName, payload, this.nodes.size, new Date().toISOString());
  }

  public loadFromSqlite(sqlite: DatabaseSync, ownerId: string, indexName = "default"): boolean {
    const row = sqlite
      .prepare(
        "SELECT graph_json FROM kosmora_hnsw_index_snapshots WHERE owner_id = ? AND index_name = ?"
      )
      .get(ownerId, indexName) as { graph_json: string } | undefined;

    if (!row) return false;
    const parsed = JSON.parse(row.graph_json);
    this.nodes.clear();
    this.entryPointId = parsed.entryPointId;
    this.maxLevel = parsed.maxLevel;

    for (const raw of parsed.nodes) {
      const buf = Buffer.from(raw.vectorBase64, "base64");
      const vec = new Float32Array(buf.buffer, buf.byteOffset, VECTOR_DIMENSION);
      this.nodes.set(raw.id, {
        id: raw.id,
        vector: vec,
        level: raw.level,
        neighborsByLayer: raw.neighborsByLayer.map((arr: string[]) => new Set(arr)),
        metadata: raw.metadata
      });
    }
    return true;
  }

  private searchLayer(
    queryVec: Float32Array,
    entryId: string,
    ef: number,
    layer: number,
    excludeId?: string
  ): Array<{ id: string; sim: number }> {
    const visited = new Set<string>([entryId]);
    if (excludeId) visited.add(excludeId);

    const entryNode = this.nodes.get(entryId)!;
    const entrySim = this.sim(queryVec, entryNode.vector);

    const candidates: Array<{ id: string; sim: number }> = [{ id: entryId, sim: entrySim }];
    const results: Array<{ id: string; sim: number }> =
      entryId === excludeId ? [] : [{ id: entryId, sim: entrySim }];

    while (candidates.length > 0) {
      candidates.sort((a, b) => b.sim - a.sim);
      const bestCand = candidates.shift()!;

      results.sort((a, b) => b.sim - a.sim);
      const worstResultSim = results.length >= ef ? results[results.length - 1].sim : -Infinity;

      if (bestCand.sim < worstResultSim && results.length >= ef) {
        break;
      }

      const candNode = this.nodes.get(bestCand.id);
      const layerSet = candNode?.neighborsByLayer[layer];
      if (!layerSet) continue;

      for (const nId of layerSet) {
        if (visited.has(nId)) continue;
        visited.add(nId);

        const nNode = this.nodes.get(nId);
        if (!nNode) continue;
        const s = this.sim(queryVec, nNode.vector);

        if (results.length < ef || s > worstResultSim) {
          candidates.push({ id: nId, sim: s });
          results.push({ id: nId, sim: s });
          if (results.length > ef) {
            results.sort((a, b) => b.sim - a.sim);
            results.pop();
          }
        }
      }
    }

    results.sort((a, b) => b.sim - a.sim);
    return results;
  }

  /**
   * Prunes excess connections while keeping both top nearest neighbors and a bridge edge
   * to prevent disconnected graph components.
   */
  private pruneNeighbors(node: HnswNode, layer: number, maxLinks: number): void {
    const current = Array.from(node.neighborsByLayer[layer]);
    const scored = current
      .map((nId) => {
        const nNode = this.nodes.get(nId);
        return {
          id: nId,
          sim: nNode ? this.sim(node.vector, nNode.vector) : -1
        };
      })
      .sort((a, b) => b.sim - a.sim);

    const keep = scored.slice(0, maxLinks - 1);
    if (scored.length >= maxLinks) {
      keep.push(scored[scored.length - 1]); // Retain 1 long-range bridge edge for small-world navigability
    }

    node.neighborsByLayer[layer] = new Set(keep.map((s) => s.id));
  }

  private sim(a: Float32Array, b: Float32Array): number {
    return computeCosineSimilarity(a, b);
  }
}
