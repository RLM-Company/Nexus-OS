export interface HitsScoreResult {
  hubScores: Record<string, number>;
  authorityScores: Record<string, number>;
  topHubNode: string;
  topAuthorityNode: string;
}

/**
 * Jon Kleinberg's Hyperlink-Induced Topic Search (HITS) Hubs & Authorities Engine.
 * Computes mutually reinforcing Authority scores a_v = sum_{(u->v)} h_u and
 * Hub scores h_u = sum_{(u->v)} a_v with L2 unit-norm normalization at each iteration.
 */
export class KleinbergHitsHubsAndAuthoritiesEngine {
  public static computeHubsAndAuthorities(
    nodes: string[],
    directedEdges: Array<{ from: string; to: string }>,
    iterations: number = 30
  ): HitsScoreResult {
    const n = nodes.length;
    if (n === 0) {
      return { hubScores: {}, authorityScores: {}, topHubNode: "", topAuthorityNode: "" };
    }

    const idxByNode = new Map<string, number>(nodes.map((id, i) => [id, i]));
    const outLinks: number[][] = Array.from({ length: n }, () => []);
    const inLinks: number[][] = Array.from({ length: n }, () => []);

    for (const e of directedEdges) {
      const u = idxByNode.get(e.from);
      const v = idxByNode.get(e.to);
      if (u !== undefined && v !== undefined) {
        outLinks[u]!.push(v);
        inLinks[v]!.push(u);
      }
    }

    let h = new Array<number>(n).fill(1 / Math.sqrt(n));
    let a = new Array<number>(n).fill(1 / Math.sqrt(n));

    const normalizeL2 = (vec: number[]): number[] => {
      let sumSq = 0;
      for (const x of vec) sumSq += x * x;
      const norm = Math.sqrt(sumSq) || 1;
      return vec.map((x) => x / norm);
    };

    for (let it = 0; it < iterations; it++) {
      // Authority update: a[v] = sum_{u in inLinks[v]} h[u]
      const nextA = new Array<number>(n).fill(0);
      for (let v = 0; v < n; v++) {
        let sum = 0;
        for (const u of inLinks[v]!) sum += h[u]!;
        nextA[v] = sum;
      }
      a = normalizeL2(nextA);

      // Hub update: h[u] = sum_{v in outLinks[u]} a[v]
      const nextH = new Array<number>(n).fill(0);
      for (let u = 0; u < n; u++) {
        let sum = 0;
        for (const v of outLinks[u]!) sum += a[v]!;
        nextH[u] = sum;
      }
      h = normalizeL2(nextH);
    }

    const hubScores: Record<string, number> = {};
    const authorityScores: Record<string, number> = {};
    let topHubNode = nodes[0]!;
    let topAuthNode = nodes[0]!;
    let maxH = -1;
    let maxA = -1;

    for (let i = 0; i < n; i++) {
      const id = nodes[i]!;
      hubScores[id] = Number(h[i]!.toFixed(6));
      authorityScores[id] = Number(a[i]!.toFixed(6));
      if (h[i]! > maxH) {
        maxH = h[i]!;
        topHubNode = id;
      }
      if (a[i]! > maxA) {
        maxA = a[i]!;
        topAuthNode = id;
      }
    }

    return {
      hubScores,
      authorityScores,
      topHubNode,
      topAuthorityNode: topAuthNode
    };
  }
}
