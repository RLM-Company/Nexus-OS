export interface PlanarPoint2D {
  x: number;
  y: number;
}

export interface ConvexHullCalipersResult {
  hullVerticesCcw: PlanarPoint2D[];
  hullPerimeter: number;
  hullArea: number;
  maxDiameterDistance: number;
  antipodalDiameterPair: [PlanarPoint2D, PlanarPoint2D] | null;
}

/**
 * Andrew's Monotone Chain O(N log N) 2D Convex Hull & Shamos/Toussaint Rotating Calipers
 * Antipodal Diameter & Shoelace Area Engine.
 */
export class ConvexHullAndRotatingCalipersEngine {
  public static cross(o: PlanarPoint2D, a: PlanarPoint2D, b: PlanarPoint2D): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  public static computeConvexHullAndDiameter(points: PlanarPoint2D[]): ConvexHullCalipersResult {
    if (points.length === 0) {
      return {
        hullVerticesCcw: [],
        hullPerimeter: 0,
        hullArea: 0,
        maxDiameterDistance: 0,
        antipodalDiameterPair: null
      };
    }

    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    // Deduplicate identical points
    const unique: PlanarPoint2D[] = [];
    for (const p of sorted) {
      const prev = unique[unique.length - 1];
      if (!prev || prev.x !== p.x || prev.y !== p.y) {
        unique.push(p);
      }
    }

    if (unique.length === 1) {
      return {
        hullVerticesCcw: unique,
        hullPerimeter: 0,
        hullArea: 0,
        maxDiameterDistance: 0,
        antipodalDiameterPair: [unique[0]!, unique[0]!]
      };
    }

    const lower: PlanarPoint2D[] = [];
    for (const p of unique) {
      while (
        lower.length >= 2 &&
        ConvexHullAndRotatingCalipersEngine.cross(
          lower[lower.length - 2]!,
          lower[lower.length - 1]!,
          p
        ) <= 0
      ) {
        lower.pop();
      }
      lower.push(p);
    }

    const upper: PlanarPoint2D[] = [];
    for (let i = unique.length - 1; i >= 0; i--) {
      const p = unique[i]!;
      while (
        upper.length >= 2 &&
        ConvexHullAndRotatingCalipersEngine.cross(
          upper[upper.length - 2]!,
          upper[upper.length - 1]!,
          p
        ) <= 0
      ) {
        upper.pop();
      }
      upper.push(p);
    }

    upper.pop();
    lower.pop();
    const hull = [...lower, ...upper];
    const h = hull.length;

    // Compute perimeter & Shoelace polygon area
    let perimeter = 0;
    let twiceArea = 0;
    for (let i = 0; i < h; i++) {
      const a = hull[i]!;
      const b = hull[(i + 1) % h]!;
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
      twiceArea += a.x * b.y - b.x * a.y;
    }

    // Rotating Calipers antipodal sweep for exact diameter
    let maxDistSq = -1;
    let bestPair: [PlanarPoint2D, PlanarPoint2D] = [hull[0]!, hull[0]!];

    if (h === 2) {
      maxDistSq =
        (hull[0]!.x - hull[1]!.x) ** 2 + (hull[0]!.y - hull[1]!.y) ** 2;
      bestPair = [hull[0]!, hull[1]!];
    } else {
      let j = 1;
      for (let i = 0; i < h; i++) {
        const nextI = (i + 1) % h;
        while (
          Math.abs(
            ConvexHullAndRotatingCalipersEngine.cross(
              hull[i]!,
              hull[nextI]!,
              hull[(j + 1) % h]!
            )
          ) >
          Math.abs(
            ConvexHullAndRotatingCalipersEngine.cross(hull[i]!, hull[nextI]!, hull[j]!)
          )
        ) {
          j = (j + 1) % h;
        }
        for (const cand of [hull[i]!, hull[nextI]!]) {
          const dSq = (cand.x - hull[j]!.x) ** 2 + (cand.y - hull[j]!.y) ** 2;
          if (dSq > maxDistSq) {
            maxDistSq = dSq;
            bestPair = [cand, hull[j]!];
          }
        }
      }
    }

    return {
      hullVerticesCcw: hull,
      hullPerimeter: Number(perimeter.toFixed(6)),
      hullArea: Number((0.5 * Math.abs(twiceArea)).toFixed(6)),
      maxDiameterDistance: Number(Math.sqrt(Math.max(0, maxDistSq)).toFixed(6)),
      antipodalDiameterPair: bestPair
    };
  }
}
