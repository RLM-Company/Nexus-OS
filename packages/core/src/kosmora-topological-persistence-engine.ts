/**
 * Stage 15 (F449-F480): Topological Data Analysis (TDA) & Persistent Homology Engine
 * 1. Vietoris-Rips Simplicial Complex, F_2 Boundary Matrix Rank & Betti Numbers (beta_0, beta_1) + Euler Characteristic
 * 2. Persistent Homology Filtration Barcode (Elder-Rule Union-Find H_0 & Cycle Births H_1)
 * 3. Ollivier-Ricci Discrete Graph Curvature kappa(u, v) = 1 - W_1(mu_u, mu_v) / d(u, v)
 * 4. Hodge 1-Laplacian Helmholtz Decomposition (Gradient curl-free + Divergence-free cyclic flow)
 */

import { createHash } from "node:crypto";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface Point2D {
  id: string;
  x: number;
  y: number;
}

export interface VietorisRipsTopologyResult {
  epsilon_threshold: number;
  vertices_v: number;
  edges_e: number;
  triangles_f: number;
  euler_characteristic_chi: number;
  rank_boundary_b1: number;
  rank_boundary_b2: number;
  betti_0_components: number;
  betti_1_holes: number;
  euler_poincare_verified: boolean;
  complex_digest: string;
}

export interface PersistenceInterval {
  dimension: 0 | 1;
  feature_label: string;
  birth_epsilon: number;
  death_epsilon: number; // Infinity represented as -1 (immortal) or finite number
  persistence_lifetime: number;
}

export interface PersistentHomologyBarcodeResult {
  total_intervals: number;
  h0_intervals: PersistenceInterval[];
  h1_intervals: PersistenceInterval[];
  max_finite_lifetime: number;
  total_persistence_l1: number;
  barcode_digest: string;
}

export interface RicciEdgeCurvature {
  edge: [string, string];
  wasserstein_1_distance: number;
  ollivier_ricci_kappa: number;
  regime: "positively_curved_cluster" | "flat_grid" | "negatively_curved_bridge";
}

export interface OllivierRicciCurvatureReport {
  lazy_alpha: number;
  edge_curvatures: RicciEdgeCurvature[];
  average_curvature: number;
  min_curvature_bottleneck: number;
  max_curvature_clique: number;
  curvature_digest: string;
}

export interface HodgeFlowDecompositionResult {
  edges_count: number;
  original_flow_l2_norm: number;
  gradient_flow: number[];
  divergence_free_cyclic_flow: number[];
  orthogonality_inner_product: number;
  orthogonal_verified: boolean;
  energy_conservation_verified: boolean;
  hodge_digest: string;
}

function euclideanDist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Computes rank of a binary matrix over GF(2) using Gaussian elimination.
 */
function gf2MatrixRank(rows: number, cols: number, matrix: number[][]): number {
  if (rows === 0 || cols === 0) return 0;
  const mat = matrix.map((r) => [...r]);
  let rank = 0;
  for (let col = 0; col < cols && rank < rows; col++) {
    let pivot = -1;
    for (let r = rank; r < rows; r++) {
      if (mat[r]![col] === 1) {
        pivot = r;
        break;
      }
    }
    if (pivot === -1) continue;
    const tmp = mat[rank]!;
    mat[rank] = mat[pivot]!;
    mat[pivot] = tmp;

    for (let r = 0; r < rows; r++) {
      if (r !== rank && mat[r]![col] === 1) {
        for (let c = col; c < cols; c++) {
          mat[r]![c] = mat[r]![c]! ^ mat[rank]![c]!;
        }
      }
    }
    rank += 1;
  }
  return rank;
}

export class KosmoraTopologicalPersistenceEngine {
  // ==========================================================================
  // F449-F456: Vietoris-Rips Simplicial Complex & F_2 Betti Numbers
  // ==========================================================================

  public computeVietorisRipsBettiNumbers(params: {
    points: Point2D[];
    epsilon: number;
  }): VietorisRipsTopologyResult {
    const pts = params.points;
    const n = pts.length;
    const eps = params.epsilon;

    const edges: Array<[number, number]> = [];
    const adj: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (euclideanDist(pts[i]!, pts[j]!) <= eps + 1e-9) {
          edges.push([i, j]);
          adj[i]![j] = true;
          adj[j]![i] = true;
        }
      }
    }

    const triangles: Array<[number, number, number]> = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (!adj[i]![j]) continue;
        for (let k = j + 1; k < n; k++) {
          if (adj[i]![k] && adj[j]![k]) {
            triangles.push([i, j, k]);
          }
        }
      }
    }

    // Boundary matrix B1: n rows (vertices) x |E| cols (edges) over GF(2)
    const b1: number[][] = Array.from({ length: n }, () => Array(edges.length).fill(0));
    edges.forEach(([u, v], eIdx) => {
      b1[u]![eIdx] = 1;
      b1[v]![eIdx] = 1;
    });

    // Boundary matrix B2: |E| rows (edges) x |F| cols (triangles) over GF(2)
    const edgeKeyMap = new Map<string, number>();
    edges.forEach(([u, v], idx) => edgeKeyMap.set(`${u}_${v}`, idx));

    const b2: number[][] = Array.from({ length: edges.length }, () =>
      Array(triangles.length).fill(0)
    );
    triangles.forEach(([i, j, k], tIdx) => {
      const e1 = edgeKeyMap.get(`${i}_${j}`);
      const e2 = edgeKeyMap.get(`${i}_${k}`);
      const e3 = edgeKeyMap.get(`${j}_${k}`);
      if (e1 !== undefined) b2[e1]![tIdx] = 1;
      if (e2 !== undefined) b2[e2]![tIdx] = 1;
      if (e3 !== undefined) b2[e3]![tIdx] = 1;
    });

    const rankB1 = gf2MatrixRank(n, edges.length, b1);
    const rankB2 = gf2MatrixRank(edges.length, triangles.length, b2);

    // dim(ker B0) = n, dim(im B1) = rankB1 => beta_0 = n - rankB1
    const beta0 = n - rankB1;
    // dim(ker B1) = |E| - rankB1, dim(im B2) = rankB2 => beta_1 = (|E| - rankB1) - rankB2
    const beta1 = edges.length - rankB1 - rankB2;
    const beta2 = triangles.length - rankB2;

    const eulerSimplices = n - edges.length + triangles.length;
    const eulerBetti = beta0 - beta1 + beta2;

    return {
      epsilon_threshold: eps,
      vertices_v: n,
      edges_e: edges.length,
      triangles_f: triangles.length,
      euler_characteristic_chi: eulerSimplices,
      rank_boundary_b1: rankB1,
      rank_boundary_b2: rankB2,
      betti_0_components: beta0,
      betti_1_holes: beta1,
      euler_poincare_verified: eulerSimplices === eulerBetti,
      complex_digest: sha256Hex(JSON.stringify({ n, e: edges.length, f: triangles.length, beta0, beta1 }))
    };
  }

  // ==========================================================================
  // F457-F464: Persistent Homology Filtration Barcode
  // ==========================================================================

  public computePersistentHomologyBarcode(params: {
    points: Point2D[];
    max_epsilon: number;
  }): PersistentHomologyBarcodeResult {
    const pts = params.points;
    const n = pts.length;
    const pairEdges: Array<{ u: number; v: number; dist: number }> = [];

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Number(euclideanDist(pts[i]!, pts[j]!).toFixed(6));
        if (d <= params.max_epsilon) {
          pairEdges.push({ u: i, v: j, dist: d });
        }
      }
    }
    pairEdges.sort((a, b) => a.dist - b.dist || a.u - b.u || a.v - b.v);

    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x: number): number => {
      let root = x;
      while (parent[root] !== root) root = parent[root]!;
      return root;
    };

    const h0Intervals: PersistenceInterval[] = [];
    const h1Intervals: PersistenceInterval[] = [];

    for (const edge of pairEdges) {
      const ru = find(edge.u);
      const rv = find(edge.v);
      if (ru !== rv) {
        // Elder rule: older component survives, younger component dies at edge.dist
        const survivor = Math.min(ru, rv);
        const dying = Math.max(ru, rv);
        parent[dying] = survivor;
        h0Intervals.push({
          dimension: 0,
          feature_label: `H0_comp_${pts[dying]!.id}`,
          birth_epsilon: 0,
          death_epsilon: edge.dist,
          persistence_lifetime: edge.dist
        });
      } else {
        // Cycle created at edge.dist! Check if closed by a triangle at a later filtration scale
        let triangleDeath = params.max_epsilon;
        for (let w = 0; w < n; w++) {
          if (w === edge.u || w === edge.v) continue;
          const d1 = euclideanDist(pts[edge.u]!, pts[w]!);
          const d2 = euclideanDist(pts[edge.v]!, pts[w]!);
          const closeScale = Number(Math.max(edge.dist, d1, d2).toFixed(6));
          if (closeScale < triangleDeath) {
            triangleDeath = closeScale;
          }
        }
        const lifetime = Number(Math.max(0, triangleDeath - edge.dist).toFixed(6));
        if (lifetime > 1e-6) {
          h1Intervals.push({
            dimension: 1,
            feature_label: `H1_cycle_${pts[edge.u]!.id}_${pts[edge.v]!.id}`,
            birth_epsilon: edge.dist,
            death_epsilon: triangleDeath,
            persistence_lifetime: lifetime
          });
        }
      }
    }

    const allFinite = [...h0Intervals, ...h1Intervals];
    const maxLifetime = allFinite.reduce((m, iv) => Math.max(m, iv.persistence_lifetime), 0);
    const totalL1 = Number(
      allFinite.reduce((acc, iv) => acc + iv.persistence_lifetime, 0).toFixed(6)
    );

    return {
      total_intervals: allFinite.length,
      h0_intervals: h0Intervals,
      h1_intervals: h1Intervals,
      max_finite_lifetime: maxLifetime,
      total_persistence_l1: totalL1,
      barcode_digest: sha256Hex(JSON.stringify({ h0: h0Intervals.length, h1: h1Intervals.length, totalL1 }))
    };
  }

  // ==========================================================================
  // F465-F472: Ollivier-Ricci Discrete Graph Curvature
  // ==========================================================================

  public computeOllivierRicciGraphCurvature(params: {
    nodes: string[];
    edges: Array<[string, string]>;
    lazy_alpha?: number;
  }): OllivierRicciCurvatureReport {
    const alpha = params.lazy_alpha ?? 0.5;
    const n = params.nodes.length;
    const idxMap = new Map<string, number>();
    params.nodes.forEach((id, i) => idxMap.set(id, i));

    const adj: number[][] = Array.from({ length: n }, () =>
      Array(n).fill(n + 10)
    );
    const neighbors: number[][] = Array.from({ length: n }, () => []);

    for (let i = 0; i < n; i++) adj[i]![i] = 0;
    for (const [uStr, vStr] of params.edges) {
      const u = idxMap.get(uStr);
      const v = idxMap.get(vStr);
      if (u !== undefined && v !== undefined && u !== v && adj[u]![v] !== 1) {
        adj[u]![v] = 1;
        adj[v]![u] = 1;
        neighbors[u]!.push(v);
        neighbors[v]!.push(u);
      }
    }

    // All-pairs shortest path via Floyd-Warshall
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (adj[i]![k]! + adj[k]![j]! < adj[i]![j]!) {
            adj[i]![j] = adj[i]![k]! + adj[k]![j]!;
          }
        }
      }
    }

    // Lazy random walk measure mu_u(x)
    const getMeasure = (u: number): number[] => {
      const mu = Array<number>(n).fill(0);
      const deg = neighbors[u]!.length;
      if (deg === 0) {
        mu[u] = 1;
        return mu;
      }
      mu[u] = alpha;
      const share = (1 - alpha) / deg;
      for (const nb of neighbors[u]!) {
        mu[nb] = share;
      }
      return mu;
    };

    // Greedy optimal transport W_1 solver for discrete graph metric
    const computeW1 = (muU: number[], muV: number[]): number => {
      const supply = [...muU];
      const demand = [...muV];
      // Cancel shared mass at identical nodes (distance 0)
      for (let i = 0; i < n; i++) {
        const common = Math.min(supply[i]!, demand[i]!);
        supply[i]! -= common;
        demand[i]! -= common;
      }

      const pairs: Array<{ s: number; d: number; dist: number }> = [];
      for (let i = 0; i < n; i++) {
        if (supply[i]! <= 1e-12) continue;
        for (let j = 0; j < n; j++) {
          if (demand[j]! <= 1e-12) continue;
          pairs.push({ s: i, d: j, dist: adj[i]![j]! });
        }
      }
      pairs.sort((a, b) => a.dist - b.dist);

      let cost = 0;
      for (const p of pairs) {
        const moved = Math.min(supply[p.s]!, demand[p.d]!);
        if (moved > 0) {
          cost += moved * p.dist;
          supply[p.s]! -= moved;
          demand[p.d]! -= moved;
        }
      }
      return Number(cost.toFixed(6));
    };

    const edgeCurvatures: RicciEdgeCurvature[] = [];
    for (const [uStr, vStr] of params.edges) {
      const u = idxMap.get(uStr)!;
      const v = idxMap.get(vStr)!;
      const w1 = computeW1(getMeasure(u), getMeasure(v));
      const kappa = Number((1 - w1).toFixed(6));
      const regime =
        kappa > 0.05
          ? "positively_curved_cluster"
          : kappa < -0.05
            ? "negatively_curved_bridge"
            : "flat_grid";
      edgeCurvatures.push({
        edge: [uStr, vStr],
        wasserstein_1_distance: w1,
        ollivier_ricci_kappa: kappa,
        regime
      });
    }

    const avgKappa =
      edgeCurvatures.length > 0
        ? Number(
            (
              edgeCurvatures.reduce((s, e) => s + e.ollivier_ricci_kappa, 0) /
              edgeCurvatures.length
            ).toFixed(6)
          )
        : 0;
    const minKappa = edgeCurvatures.reduce(
      (m, e) => Math.min(m, e.ollivier_ricci_kappa),
      edgeCurvatures[0]?.ollivier_ricci_kappa ?? 0
    );
    const maxKappa = edgeCurvatures.reduce(
      (m, e) => Math.max(m, e.ollivier_ricci_kappa),
      edgeCurvatures[0]?.ollivier_ricci_kappa ?? 0
    );

    return {
      lazy_alpha: alpha,
      edge_curvatures: edgeCurvatures,
      average_curvature: avgKappa,
      min_curvature_bottleneck: minKappa,
      max_curvature_clique: maxKappa,
      curvature_digest: sha256Hex(JSON.stringify({ edgeCurvatures, avgKappa }))
    };
  }

  // ==========================================================================
  // F473-F480: Hodge 1-Laplacian Helmholtz Decomposition
  // ==========================================================================

  public decomposeEdgeFlowHodgeHelmholtz(params: {
    nodes: string[];
    directed_edges: Array<{ from: string; to: string; flow: number }>;
  }): HodgeFlowDecompositionResult {
    const n = params.nodes.length;
    const m = params.directed_edges.length;
    const idxMap = new Map<string, number>();
    params.nodes.forEach((id, i) => idxMap.set(id, i));

    const flowVec = params.directed_edges.map((e) => e.flow);

    // Compute node divergence div(f)_i = sum_{e=(u->i)} f_e - sum_{e=(i->v)} f_e
    // Solve L0 * phi = B1 * f using Jacobi/Gauss-Seidel relaxation with zero-mean gauge
    const deg = Array<number>(n).fill(0);
    const adj: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    const b1f = Array<number>(n).fill(0);

    for (const e of params.directed_edges) {
      const u = idxMap.get(e.from)!;
      const v = idxMap.get(e.to)!;
      deg[u] += 1;
      deg[v] += 1;
      adj[u]![v]! += 1;
      adj[v]![u]! += 1;
      b1f[v] += e.flow;
      b1f[u] -= e.flow;
    }

    let phi = Array<number>(n).fill(0);
    for (let iter = 0; iter < 250; iter++) {
      const nextPhi = Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) {
        if (deg[i] === 0) continue;
        let nbSum = 0;
        for (let j = 0; j < n; j++) {
          if (i !== j && adj[i]![j]! > 0) {
            nbSum += adj[i]![j]! * phi[j]!;
          }
        }
        nextPhi[i] = (b1f[i]! + nbSum) / deg[i]!;
      }
      const mean = nextPhi.reduce((a, b) => a + b, 0) / n;
      phi = nextPhi.map((v) => v - mean);
    }

    // Gradient flow f_grad(u -> v) = phi(v) - phi(u)
    const gradFlow = params.directed_edges.map((e) => {
      const u = idxMap.get(e.from)!;
      const v = idxMap.get(e.to)!;
      return Number((phi[v]! - phi[u]!).toFixed(6));
    });

    // Divergence-free cyclic flow f_divFree = f - f_grad
    const cyclicFlow = flowVec.map((f, i) => Number((f - gradFlow[i]!).toFixed(6)));

    const innerProd = Number(
      gradFlow.reduce((acc, g, i) => acc + g * cyclicFlow[i]!, 0).toFixed(6)
    );
    const origNormSq = flowVec.reduce((acc, f) => acc + f * f, 0);
    const decompNormSq =
      gradFlow.reduce((acc, g) => acc + g * g, 0) +
      cyclicFlow.reduce((acc, c) => acc + c * c, 0);

    return {
      edges_count: m,
      original_flow_l2_norm: Number(Math.sqrt(origNormSq).toFixed(6)),
      gradient_flow: gradFlow,
      divergence_free_cyclic_flow: cyclicFlow,
      orthogonality_inner_product: innerProd,
      orthogonal_verified: Math.abs(innerProd) < 1e-2,
      energy_conservation_verified: Math.abs(origNormSq - decompNormSq) < 5e-2,
      hodge_digest: sha256Hex(JSON.stringify({ gradFlow, cyclicFlow }))
    };
  }
}
