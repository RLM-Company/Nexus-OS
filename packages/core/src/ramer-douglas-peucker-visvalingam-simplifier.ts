export interface PolylinePoint {
  x: number;
  y: number;
}

/**
 * Ramer-Douglas-Peucker (RDP) & Visvalingam-Whyatt Polyline Trajectory Simplifier.
 * - RDP recursively subdivides a polyline at the vertex with maximum perpendicular distance
 *   from the chord [start, end] whenever that distance exceeds tolerance epsilon.
 * - Visvalingam-Whyatt iteratively removes the interior vertex forming the smallest effective
 *   triangular area with its immediate neighbors until targetCount vertices remain.
 */
export class PolylineTrajectorySimplifier {
  public static perpendicularDistance(
    pt: PolylinePoint,
    lineStart: PolylinePoint,
    lineEnd: PolylinePoint
  ): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) {
      return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
    }
    return Math.abs(dy * pt.x - dx * pt.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / len;
  }

  public static simplifyRamerDouglasPeucker(
    points: PolylinePoint[],
    epsilon: number
  ): PolylinePoint[] {
    if (points.length <= 2) return [...points];

    let maxDist = 0;
    let splitIdx = 0;
    const first = points[0]!;
    const last = points[points.length - 1]!;

    for (let i = 1; i < points.length - 1; i++) {
      const d = PolylineTrajectorySimplifier.perpendicularDistance(points[i]!, first, last);
      if (d > maxDist) {
        maxDist = d;
        splitIdx = i;
      }
    }

    if (maxDist > epsilon) {
      const left = PolylineTrajectorySimplifier.simplifyRamerDouglasPeucker(
        points.slice(0, splitIdx + 1),
        epsilon
      );
      const right = PolylineTrajectorySimplifier.simplifyRamerDouglasPeucker(
        points.slice(splitIdx),
        epsilon
      );
      return [...left.slice(0, -1), ...right];
    }

    return [first, last];
  }

  public static simplifyVisvalingamWhyatt(
    points: PolylinePoint[],
    targetVertexCount: number
  ): PolylinePoint[] {
    const pts = [...points];
    const target = Math.max(2, targetVertexCount);
    const triangleArea = (a: PolylinePoint, b: PolylinePoint, c: PolylinePoint): number =>
      0.5 * Math.abs(a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));

    while (pts.length > target) {
      let minArea = Infinity;
      let minIdx = 1;
      for (let i = 1; i < pts.length - 1; i++) {
        const area = triangleArea(pts[i - 1]!, pts[i]!, pts[i + 1]!);
        if (area < minArea) {
          minArea = area;
          minIdx = i;
        }
      }
      pts.splice(minIdx, 1);
    }

    return pts;
  }
}
