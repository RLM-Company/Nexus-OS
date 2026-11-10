export interface SpectralPartitionResult {
  clusterA: string[];
  clusterB: string[];
  fiedlerEigenvalueLambda2: number;
  fiedlerVectorByNode: Record<string, number>;
  cutEdgeWeight: number;
}

/**
 * Spectral Graph Partitioner via Graph Laplacian L = D - A and Fiedler Vector (Second Smallest Eigenvector).
 * Uses deflated power iteration orthogonal to the trivial all-ones eigenvector 1_n to compute
 * the Fiedler vector v_2 and bisects the graph into two tightly-coupled clusters with minimal cut weight.
 */
export class SpectralFiedlerGraphPartitioner {
  public static partitionGraph(params: {
    nodes: string[];
    undirectedEdges: Array<{ u: string; v: string; weight?: number }>;
    iterations?: number;
  }): SpectralPartitionResult {
    const n = params.nodes.length;
    if (n <= 1) {
      return {
        clusterA: [...params.nodes],
        clusterB: [],
        fiedlerEigenvalueLambda2: 0,
        fiedlerVectorByNode: Object.fromEntries(params.nodes.map((id) => [id, 0])),
        cutEdgeWeight: 0
      };
    }

    const idxMap = new Map<string, number>();
    params.nodes.forEach((id, idx) => idxMap.set(id, idx));

    const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let maxDegree = 0;

    for (const e of params.undirectedEdges) {
      const i = idxMap.get(e.u);
      const j = idxMap.get(e.v);
      if (i === undefined || j === undefined || i === j) continue;
      const w = e.weight ?? 1.0;
      L[i]![j] = (L[i]![j] ?? 0) - w;
      L[j]![i] = (L[j]![i] ?? 0) - w;
      L[i]![i] = (L[i]![i] ?? 0) + w;
      L[j]![j] = (L[j]![j] ?? 0) + w;
    }

    for (let i = 0; i < n; i++) {
      maxDegree = Math.max(maxDegree, L[i]![i]!);
    }

    // Shift matrix M = (2 * maxDegree) * I - L so that smallest positive eigenvalue of L
    // becomes the largest eigenvalue of M after projecting out the constant vector 1_n.
    const alphaShift = 2 * Math.max(1, maxDegree) + 1;
    let vec = Array.from({ length: n }, (_, i) => Math.sin((i + 1) * 1.73205));

    const projectOutMeanAndNormalize = (v: number[]): number[] => {
      const mean = v.reduce((a, b) => a + b, 0) / n;
      const centered = v.map((x) => x - mean);
      const norm = Math.sqrt(centered.reduce((acc, x) => acc + x * x, 0));
      if (norm <= 1e-12) return centered;
      return centered.map((x) => x / norm);
    };

    vec = projectOutMeanAndNormalize(vec);
    const iters = params.iterations ?? 60;

    for (let it = 0; it < iters; it++) {
      const next = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) {
        let lDot = 0;
        for (let j = 0; j < n; j++) {
          lDot += L[i]![j]! * vec[j]!;
        }
        next[i] = alphaShift * vec[i]! - lDot;
      }
      vec = projectOutMeanAndNormalize(next);
    }

    // Rayleigh quotient v^T L v for Fiedler algebraic connectivity lambda_2
    let rayleigh = 0;
    for (let i = 0; i < n; i++) {
      let lDot = 0;
      for (let j = 0; j < n; j++) {
        lDot += L[i]![j]! * vec[j]!;
      }
      rayleigh += vec[i]! * lDot;
    }

    const fiedlerVectorByNode: Record<string, number> = {};
    const clusterA: string[] = [];
    const clusterB: string[] = [];

    for (let i = 0; i < n; i++) {
      const nodeId = params.nodes[i]!;
      const val = Number(vec[i]!.toFixed(6));
      fiedlerVectorByNode[nodeId] = val;
      if (vec[i]! <= 0) {
        clusterA.push(nodeId);
      } else {
        clusterB.push(nodeId);
      }
    }

    const setA = new Set(clusterA);
    let cutEdgeWeight = 0;
    for (const e of params.undirectedEdges) {
      if (setA.has(e.u) !== setA.has(e.v)) {
        cutEdgeWeight += e.weight ?? 1.0;
      }
    }

    return {
      clusterA,
      clusterB,
      fiedlerEigenvalueLambda2: Number(Math.max(0, rayleigh).toFixed(6)),
      fiedlerVectorByNode,
      cutEdgeWeight: Number(cutEdgeWeight.toFixed(6))
    };
  }
}
