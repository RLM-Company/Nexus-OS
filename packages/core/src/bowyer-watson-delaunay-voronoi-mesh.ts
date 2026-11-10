export interface MeshPoint2D {
  id: string;
  x: number;
  y: number;
}

export interface DelaunayTriangle {
  vertices: [string, string, string];
  circumcenter: { x: number; y: number };
  circumradiusSq: number;
}

export interface DelaunayVoronoiMeshResult {
  triangles: DelaunayTriangle[];
  voronoiDualEdges: Array<{ fromCircumcenterIndex: number; toCircumcenterIndex: number }>;
  emptyCircumcirclePropertyVerified: boolean;
}

/**
 * Bowyer-Watson Incremental Delaunay Triangulation & Dual Voronoi Mesh Generator.
 * Enforces the Delaunay empty-circumcircle invariant for every triangle and extracts
 * the dual Voronoi adjacency graph connecting circumcenters of triangles sharing an edge.
 */
export class BowyerWatsonDelaunayVoronoiEngine {
  public static computeCircumcircle(
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number }
  ): { x: number; y: number; rSq: number } | null {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-12) return null; // Collinear

    const aSq = a.x * a.x + a.y * a.y;
    const bSq = b.x * b.x + b.y * b.y;
    const cSq = c.x * c.x + c.y * c.y;

    const ux = (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d;
    const uy = (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d;
    const dx = a.x - ux;
    const dy = a.y - uy;
    return { x: ux, y: uy, rSq: dx * dx + dy * dy };
  }

  public static triangulate(points: MeshPoint2D[]): DelaunayVoronoiMeshResult {
    if (points.length < 3) {
      return { triangles: [], voronoiDualEdges: [], emptyCircumcirclePropertyVerified: true };
    }

    // Create enclosing super-triangle
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const span = Math.max(maxX - minX, maxY - minY, 10) * 100;
    const midX = 0.5 * (minX + maxX);
    const midY = 0.5 * (minY + maxY);

    const superPts: MeshPoint2D[] = [
      { id: "__SUPER_0__", x: midX - 2 * span, y: midY - span },
      { id: "__SUPER_1__", x: midX + 2 * span, y: midY - span },
      { id: "__SUPER_2__", x: midX, y: midY + 2 * span }
    ];

    const allPts = [...points, ...superPts];
    const n = points.length;

    interface InternalTri {
      i: number;
      j: number;
      k: number;
      cx: number;
      cy: number;
      rSq: number;
    }

    const makeTri = (i: number, j: number, k: number): InternalTri | null => {
      const cc = BowyerWatsonDelaunayVoronoiEngine.computeCircumcircle(
        allPts[i]!,
        allPts[j]!,
        allPts[k]!
      );
      if (!cc) return null;
      return { i, j, k, cx: cc.x, cy: cc.y, rSq: cc.rSq };
    };

    let triangulation: InternalTri[] = [];
    const rootTri = makeTri(n, n + 1, n + 2);
    if (rootTri) triangulation.push(rootTri);

    // Incremental Bowyer-Watson insertion
    for (let pIdx = 0; pIdx < n; pIdx++) {
      const p = allPts[pIdx]!;
      const badTriangles: InternalTri[] = [];
      for (const t of triangulation) {
        const dx = p.x - t.cx;
        const dy = p.y - t.cy;
        if (dx * dx + dy * dy <= t.rSq - 1e-9) {
          badTriangles.push(t);
        }
      }

      // Find boundary edges of polygonal hole (edges appearing in exactly 1 bad triangle)
      const edgeCount = new Map<string, { u: number; v: number; count: number }>();
      const addEdge = (u: number, v: number) => {
        const a = Math.min(u, v);
        const b = Math.max(u, v);
        const key = `${a}:${b}`;
        const prev = edgeCount.get(key);
        if (prev) prev.count++;
        else edgeCount.set(key, { u: a, v: b, count: 1 });
      };

      for (const bt of badTriangles) {
        addEdge(bt.i, bt.j);
        addEdge(bt.j, bt.k);
        addEdge(bt.k, bt.i);
      }

      const badSet = new Set(badTriangles);
      triangulation = triangulation.filter((t) => !badSet.has(t));

      for (const edge of edgeCount.values()) {
        if (edge.count === 1) {
          const nt = makeTri(edge.u, edge.v, pIdx);
          if (nt) triangulation.push(nt);
        }
      }
    }

    // Remove triangles touching super-triangle vertices (>= n)
    const validTris = triangulation.filter((t) => t.i < n && t.j < n && t.k < n);

    // Build dual Voronoi edges connecting triangles sharing a Delaunay edge
    const edgeToTriIdx = new Map<string, number[]>();
    validTris.forEach((t, tIdx) => {
      const pairs: Array<[number, number]> = [
        [t.i, t.j],
        [t.j, t.k],
        [t.k, t.i]
      ];
      for (const [u, v] of pairs) {
        const key = `${Math.min(u, v)}:${Math.max(u, v)}`;
        const arr = edgeToTriIdx.get(key) ?? [];
        arr.push(tIdx);
        edgeToTriIdx.set(key, arr);
      }
    });

    const voronoiDualEdges: Array<{ fromCircumcenterIndex: number; toCircumcenterIndex: number }> =
      [];
    for (const adjTris of edgeToTriIdx.values()) {
      if (adjTris.length === 2) {
        voronoiDualEdges.push({
          fromCircumcenterIndex: adjTris[0]!,
          toCircumcenterIndex: adjTris[1]!
        });
      }
    }

    // Verify empty circumcircle property across all valid triangles
    let emptyCircumcirclePropertyVerified = true;
    for (const t of validTris) {
      for (let pIdx = 0; pIdx < n; pIdx++) {
        if (pIdx === t.i || pIdx === t.j || pIdx === t.k) continue;
        const p = allPts[pIdx]!;
        const dSq = (p.x - t.cx) * (p.x - t.cx) + (p.y - t.cy) * (p.y - t.cy);
        if (dSq < t.rSq - 1e-6) {
          emptyCircumcirclePropertyVerified = false;
        }
      }
    }

    return {
      triangles: validTris.map((t) => ({
        vertices: [allPts[t.i]!.id, allPts[t.j]!.id, allPts[t.k]!.id],
        circumcenter: { x: Number(t.cx.toFixed(6)), y: Number(t.cy.toFixed(6)) },
        circumradiusSq: Number(t.rSq.toFixed(6))
      })),
      voronoiDualEdges,
      emptyCircumcirclePropertyVerified
    };
  }
}
