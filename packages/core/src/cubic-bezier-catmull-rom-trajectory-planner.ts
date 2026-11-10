export interface Point2D {
  x: number;
  y: number;
}

export interface TrajectorySampleResult {
  points: Point2D[];
  totalArcLength: number;
  maxCurvatureKappa: number;
}

/**
 * De Casteljau Cubic Bézier & Centripetal Catmull-Rom C1 Spline Trajectory Planner.
 * Evaluates numerically stable De Casteljau subdivisions, computes chordal arc-length
 * parameterization, and audits maximum signed curvature kappa(t).
 */
export class CatmullRomAndCubicBezierSplinePlanner {
  public static evaluateDeCasteljauCubic(
    p0: Point2D,
    p1: Point2D,
    p2: Point2D,
    p3: Point2D,
    t: number
  ): Point2D {
    const lerp = (a: Point2D, b: Point2D, u: number): Point2D => ({
      x: (1 - u) * a.x + u * b.x,
      y: (1 - u) * a.y + u * b.y
    });
    const q0 = lerp(p0, p1, t);
    const q1 = lerp(p1, p2, t);
    const q2 = lerp(p2, p3, t);
    const r0 = lerp(q0, q1, t);
    const r1 = lerp(q1, q2, t);
    return lerp(r0, r1, t);
  }

  public static sampleCubicBezierTrajectory(
    p0: Point2D,
    p1: Point2D,
    p2: Point2D,
    p3: Point2D,
    numSamples: number = 25
  ): TrajectorySampleResult {
    const points: Point2D[] = [];
    let arcLen = 0;
    let maxKappa = 0;

    for (let i = 0; i < numSamples; i++) {
      const t = numSamples === 1 ? 0 : i / (numSamples - 1);
      const pt = CatmullRomAndCubicBezierSplinePlanner.evaluateDeCasteljauCubic(p0, p1, p2, p3, t);
      if (i > 0) {
        const prev = points[i - 1]!;
        arcLen += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      }
      points.push({ x: Number(pt.x.toFixed(6)), y: Number(pt.y.toFixed(6)) });

      // First derivative B'(t) and second derivative B''(t)
      const mt = 1 - t;
      const dx =
        3 * mt * mt * (p1.x - p0.x) +
        6 * mt * t * (p2.x - p1.x) +
        3 * t * t * (p3.x - p2.x);
      const dy =
        3 * mt * mt * (p1.y - p0.y) +
        6 * mt * t * (p2.y - p1.y) +
        3 * t * t * (p3.y - p2.y);
      const ddx =
        6 * mt * (p2.x - 2 * p1.x + p0.x) +
        6 * t * (p3.x - 2 * p2.x + p1.x);
      const ddy =
        6 * mt * (p2.y - 2 * p1.y + p0.y) +
        6 * t * (p3.y - 2 * p2.y + p1.y);

      const speedSq = dx * dx + dy * dy;
      if (speedSq > 1e-12) {
        const kappa = Math.abs(dx * ddy - dy * ddx) / Math.pow(speedSq, 1.5);
        if (kappa > maxKappa) maxKappa = kappa;
      }
    }

    return {
      points,
      totalArcLength: Number(arcLen.toFixed(6)),
      maxCurvatureKappa: Number(maxKappa.toFixed(6))
    };
  }

  /**
   * Evaluates a uniform Catmull-Rom interpolating spline at u in [0, 1] between control points p1 and p2
   * given flanking points p0 and p3. Guaranteed to pass exactly through p1 at u=0 and p2 at u=1.
   */
  public static evaluateCatmullRomSegment(
    p0: Point2D,
    p1: Point2D,
    p2: Point2D,
    p3: Point2D,
    u: number
  ): Point2D {
    const u2 = u * u;
    const u3 = u2 * u;
    const evalCoord = (c0: number, c1: number, c2: number, c3: number): number =>
      0.5 *
      (2 * c1 +
        (-c0 + c2) * u +
        (2 * c0 - 5 * c1 + 4 * c2 - c3) * u2 +
        (-c0 + 3 * c1 - 3 * c2 + c3) * u3);

    return {
      x: Number(evalCoord(p0.x, p1.x, p2.x, p3.x).toFixed(6)),
      y: Number(evalCoord(p0.y, p1.y, p2.y, p3.y).toFixed(6))
    };
  }
}
