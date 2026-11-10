import { DatabaseSync } from "node:sqlite";

export interface UndirectedWeightedEdge {
  u: string;
  v: string;
  weight?: number;
}

export interface DetectedGraphCommunity {
  communityId: string;
  memberNodeIds: string[];
  hubNodeId: string;
  modularityContribution: number;
  summaryText: string;
}

/**
 * GraphRAG Community Detector (Weighted Label Propagation + Newman-Girvan Modularity Q)
 * & Hierarchical Community Summary Indexer with SQLite persistence.
 */
export class GraphCommunitySummarizer {
  private readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_graph_communities (
        community_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        graph_namespace TEXT NOT NULL,
        member_node_ids_json TEXT NOT NULL,
        hub_node_id TEXT NOT NULL,
        modularity_contribution REAL NOT NULL,
        summary_text TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  public detectAndPersistCommunities(params: {
    ownerId: string;
    graphNamespace: string;
    edges: UndirectedWeightedEdge[];
    nodeDescriptions?: Record<string, string>;
    maxIterations?: number;
  }): {
    communities: DetectedGraphCommunity[];
    totalModularityQ: number;
  } {
    const maxIter = params.maxIterations ?? 15;
    const adj = new Map<string, Map<string, number>>();
    const degree = new Map<string, number>();
    let totalEdgeWeight2M = 0;

    const addEdge = (a: string, b: string, w: number) => {
      let mapA = adj.get(a);
      if (!mapA) {
        mapA = new Map();
        adj.set(a, mapA);
      }
      mapA.set(b, (mapA.get(b) ?? 0) + w);
      degree.set(a, (degree.get(a) ?? 0) + w);
      totalEdgeWeight2M += w;
    };

    for (const e of params.edges) {
      const w = Math.max(0.01, e.weight ?? 1.0);
      addEdge(e.u, e.v, w);
      addEdge(e.v, e.u, w);
    }

    const nodes = Array.from(adj.keys()).sort();
    if (nodes.length === 0) {
      return { communities: [], totalModularityQ: 0 };
    }

    // Initialize each node in its own community label
    const labels = new Map<string, string>();
    for (const n of nodes) {
      labels.set(n, n);
    }

    // Synchronous Deterministic Weighted Label Propagation
    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false;
      for (const u of nodes) {
        const neighbors = adj.get(u)!;
        const weightByLabel = new Map<string, number>();
        for (const [v, w] of neighbors.entries()) {
          const lbl = labels.get(v)!;
          weightByLabel.set(lbl, (weightByLabel.get(lbl) ?? 0) + w);
        }

        let bestLabel = labels.get(u)!;
        let bestWeight = -1;
        for (const [lbl, w] of Array.from(weightByLabel.entries()).sort((a, b) =>
          a[0].localeCompare(b[0])
        )) {
          if (w > bestWeight) {
            bestWeight = w;
            bestLabel = lbl;
          }
        }

        if (bestLabel !== labels.get(u)) {
          labels.set(u, bestLabel);
          changed = true;
        }
      }
      if (!changed) break;
    }

    // Group nodes by converged community label
    const groups = new Map<string, string[]>();
    for (const n of nodes) {
      const lbl = labels.get(n)!;
      const list = groups.get(lbl) ?? [];
      list.push(n);
      groups.set(lbl, list);
    }

    const communities: DetectedGraphCommunity[] = [];
    let totalModularityQ = 0;
    const nowIso = new Date().toISOString();

    let commSeq = 0;
    for (const memberNodes of groups.values()) {
      commSeq++;
      const communityId = `comm_${params.ownerId}_${params.graphNamespace}_${commSeq}`;
      const memberSet = new Set(memberNodes);

      // Find hub node (highest weighted degree inside community)
      let hubNodeId = memberNodes[0]!;
      let bestDeg = -1;
      for (const m of memberNodes) {
        const d = degree.get(m) ?? 0;
        if (d > bestDeg) {
          bestDeg = d;
          hubNodeId = m;
        }
      }

      // Compute Newman-Girvan modularity contribution for this community:
      // Q_c = \frac{1}{2m} \sum_{i,j \in C} (A_{ij} - \frac{k_i k_j}{2m})
      let qContribution = 0;
      if (totalEdgeWeight2M > 0) {
        for (const i of memberNodes) {
          const ki = degree.get(i) ?? 0;
          const neighborsI = adj.get(i)!;
          for (const j of memberNodes) {
            const aij = neighborsI.get(j) ?? 0;
            const kj = degree.get(j) ?? 0;
            qContribution += aij - (ki * kj) / totalEdgeWeight2M;
          }
        }
        qContribution /= totalEdgeWeight2M;
      }

      const modRounded = Number(qContribution.toFixed(4));
      totalModularityQ += modRounded;

      const memberSummaries = memberNodes.map((n) =>
        params.nodeDescriptions?.[n] ? `${n} (${params.nodeDescriptions[n]})` : n
      );
      const summaryText = `Community centered on hub '${hubNodeId}' with ${memberNodes.length} connected entities: ${memberSummaries.join(", ")}.`;

      const commRecord: DetectedGraphCommunity = {
        communityId,
        memberNodeIds: memberNodes,
        hubNodeId,
        modularityContribution: modRounded,
        summaryText
      };
      communities.push(commRecord);

      this.sqlite
        .prepare(
          `INSERT INTO kosmora_graph_communities
            (community_id, owner_id, graph_namespace, member_node_ids_json, hub_node_id, modularity_contribution, summary_text, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(community_id) DO UPDATE SET
            member_node_ids_json = excluded.member_node_ids_json,
            hub_node_id = excluded.hub_node_id,
            modularity_contribution = excluded.modularity_contribution,
            summary_text = excluded.summary_text,
            updated_at = excluded.updated_at`
        )
        .run(
          communityId,
          params.ownerId,
          params.graphNamespace,
          JSON.stringify(memberNodes),
          hubNodeId,
          modRounded,
          summaryText,
          nowIso
        );
    }

    return {
      communities,
      totalModularityQ: Number(totalModularityQ.toFixed(4))
    };
  }
}
