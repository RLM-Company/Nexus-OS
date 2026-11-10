export interface SpatialPoint2D {
  id: string;
  x: number;
  y: number;
}

interface KdTreeNode {
  point: SpatialPoint2D;
  axis: 0 | 1;
  left: KdTreeNode | null;
  right: KdTreeNode | null;
}

/**
 * Jon Bentley's 2D k-d Tree Nearest-Neighbor Index & Shamos-Hoey O(N log N) Sweep-Line
 * Closest Pair of Points Solver.
 */
export class KdTreeAndSweepLineClosestPairEngine {
  private readonly root: KdTreeNode | null;

  public constructor(points: SpatialPoint2D[]) {
    this.root = this.buildKdTree([...points], 0);
  }

  private buildKdTree(pts: SpatialPoint2D[], depth: number): KdTreeNode | null {
    if (pts.length === 0) return null;
    const axis: 0 | 1 = (depth & 1) === 0 ? 0 : 1;
    pts.sort((a, b) => (axis === 0 ? a.x - b.x : a.y - b.y));
    const mid = pts.length >>> 1;
    return {
      point: pts[mid]!,
      axis,
      left: this.buildKdTree(pts.slice(0, mid), depth + 1),
      right: this.buildKdTree(pts.slice(mid + 1), depth + 1)
    };
  }

  public findNearestNeighbor(query: { x: number; y: number }): {
    nearestPoint: SpatialPoint2D | null;
    distance: number;
    nodesVisited: number;
  } {
    let bestPt: SpatialPoint2D | null = null;
    let bestDistSq = Infinity;
    let nodesVisited = 0;

    const search = (node: KdTreeNode | null): void => {
      if (!node) return;
      nodesVisited++;
      const dSq =
        (node.point.x - query.x) * (node.point.x - query.x) +
        (node.point.y - query.y) * (node.point.y - query.y);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestPt = node.point;
      }

      const diff =
        node.axis === 0 ? query.x - node.point.x : query.y - node.point.y;
      const first = diff <= 0 ? node.left : node.right;
      const second = diff <= 0 ? node.right : node.left;

      search(first);
      if (diff * diff < bestDistSq) {
        search(second);
      }
    };

    search(this.root);
    return {
      nearestPoint: bestPt,
      distance: Number.isFinite(bestDistSq) ? Number(Math.sqrt(bestDistSq).toFixed(6)) : Infinity,
      nodesVisited
    };
  }

  public static findClosestPairSweepLine(points: SpatialPoint2D[]): {
    pair: [SpatialPoint2D, SpatialPoint2D] | null;
    minDistance: number;
  } {
    const n = points.length;
    if (n < 2) return { pair: null, minDistance: Infinity };

    const sortedX = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    let bestDist = Infinity;
    let bestPair: [SpatialPoint2D, SpatialPoint2D] | null = null;

    const activeWindow: SpatialPoint2D[] = [];
    let left = 0;

    for (let i = 0; i < n; i++) {
      const p = sortedX[i]!;
      while (left < i && p.x - sortedX[left]!.x >= bestDist) {
        const idx = activeWindow.indexOf(sortedX[left]!);
        if (idx !== -1) activeWindow.splice(idx, 1);
        left++;
      }

      for (const q of activeWindow) {
        if (Math.abs(p.y - q.y) < bestDist) {
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < bestDist) {
            bestDist = d;
            bestPair = [q, p];
          }
        }
      }
      activeWindow.push(p);
    }

    return {
      pair: bestPair,
      minDistance: Number(bestDist.toFixed(6))
    };
  }
}
