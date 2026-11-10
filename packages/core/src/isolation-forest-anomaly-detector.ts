interface IsolationTreeNode {
  kind: "leaf" | "internal";
  size: number;
  splitFeatureIndex?: number;
  splitThreshold?: number;
  left?: IsolationTreeNode;
  right?: IsolationTreeNode;
}

export interface AnomalyScoreResult {
  anomalyScore: number; // in (0, 1], > 0.6 indicates strong anomaly
  averagePathLength: number;
  isAnomaly: boolean;
}

/**
 * Liu, Ting & Zhou's Isolation Forest (iForest) Multi-Dimensional Unsupervised Anomaly Detector.
 * Isolates anomalous points via randomized axis-parallel hyperplane splits and scores points
 * using s(x, n) = 2^(-E(h(x)) / c(n)) where c(n) is the BST Euler harmonic path length.
 */
export class IsolationForestAnomalyDetector {
  private readonly numTrees: number;
  private readonly maxDepth: number;
  private trees: IsolationTreeNode[] = [];
  private sampleSizeN = 0;
  private rngState = 20261106 >>> 0;

  constructor(params?: { numTrees?: number; seed?: number }) {
    this.numTrees = Math.max(5, params?.numTrees ?? 25);
    this.maxDepth = 10;
    if (params?.seed !== undefined) {
      this.rngState = params.seed >>> 0;
    }
  }

  private nextUniform(): number {
    this.rngState ^= this.rngState << 13;
    this.rngState ^= this.rngState >>> 17;
    this.rngState ^= this.rngState << 5;
    return ((this.rngState >>> 0) + 0.5) / 4294967296;
  }

  /**
   * Average path length of unsuccessful search in a Binary Search Tree of n points:
   * c(n) = 2 * H(n - 1) - 2*(n - 1)/n, where H(k) ~ ln(k) + 0.5772156649 (Euler-Mascheroni).
   */
  public static expectedPathLengthC(n: number): number {
    if (n <= 1) return 0;
    if (n === 2) return 1;
    const eulerMascheroni = 0.5772156649;
    const harmonic = Math.log(n - 1) + eulerMascheroni;
    return 2.0 * harmonic - (2.0 * (n - 1)) / n;
  }

  private buildTree(points: number[][], depth: number, maxDepth: number): IsolationTreeNode {
    if (points.length <= 1 || depth >= maxDepth) {
      return { kind: "leaf", size: points.length };
    }

    const dim = points[0]!.length;
    const featIdx = Math.floor(this.nextUniform() * dim);

    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const p of points) {
      const v = p[featIdx]!;
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }

    if (maxVal - minVal <= 1e-12) {
      return { kind: "leaf", size: points.length };
    }

    const splitThreshold = minVal + this.nextUniform() * (maxVal - minVal);
    const leftPts: number[][] = [];
    const rightPts: number[][] = [];

    for (const p of points) {
      if (p[featIdx]! < splitThreshold) leftPts.push(p);
      else rightPts.push(p);
    }

    return {
      kind: "internal",
      size: points.length,
      splitFeatureIndex: featIdx,
      splitThreshold,
      left: this.buildTree(leftPts, depth + 1, maxDepth),
      right: this.buildTree(rightPts, depth + 1, maxDepth)
    };
  }

  private pathLength(point: number[], node: IsolationTreeNode, currentDepth: number): number {
    if (node.kind === "leaf") {
      return currentDepth + IsolationForestAnomalyDetector.expectedPathLengthC(node.size);
    }
    const v = point[node.splitFeatureIndex!]!;
    if (v < node.splitThreshold!) {
      return this.pathLength(point, node.left!, currentDepth + 1);
    }
    return this.pathLength(point, node.right!, currentDepth + 1);
  }

  public fit(dataset: number[][]): void {
    if (dataset.length === 0) return;
    this.sampleSizeN = dataset.length;
    const heightLimit = Math.max(2, Math.ceil(Math.log2(this.sampleSizeN)));
    this.trees = [];

    for (let t = 0; t < this.numTrees; t++) {
      this.trees.push(this.buildTree(dataset, 0, Math.min(this.maxDepth, heightLimit)));
    }
  }

  public scorePoint(point: number[], threshold = 0.6): AnomalyScoreResult {
    if (this.trees.length === 0 || this.sampleSizeN <= 1) {
      return { anomalyScore: 0.5, averagePathLength: 0, isAnomaly: false };
    }

    let totalPath = 0;
    for (const tree of this.trees) {
      totalPath += this.pathLength(point, tree, 0);
    }
    const avgPath = totalPath / this.trees.length;
    const cn = Math.max(1e-6, IsolationForestAnomalyDetector.expectedPathLengthC(this.sampleSizeN));
    const score = Math.pow(2, -avgPath / cn);

    return {
      anomalyScore: Number(score.toFixed(6)),
      averagePathLength: Number(avgPath.toFixed(4)),
      isAnomaly: score >= threshold
    };
  }
}
