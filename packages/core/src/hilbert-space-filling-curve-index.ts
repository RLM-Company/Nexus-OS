/**
 * 2D Hilbert Space-Filling Curve Spatial Indexer (`xyToHilbertDistance` and `hilbertDistanceToXy`).
 * Maps 2D grid coordinates (x, y) in [0..2^order - 1] to a 1D continuous Hilbert curve distance
 * in [0..4^order - 1] with superior spatial locality preservation over Z-order Morton codes.
 */
export class HilbertCurveSpatialIndexer {
  private static rot(n: number, x: number, y: number, rx: number, ry: number): [number, number] {
    if (ry === 0) {
      if (rx === 1) {
        x = n - 1 - x;
        y = n - 1 - y;
      }
      return [y, x];
    }
    return [x, y];
  }

  public static xyToHilbertDistance(orderBits: number, x: number, y: number): number {
    const n = 1 << orderBits;
    let curX = x;
    let curY = y;
    let d = 0;

    for (let s = n >> 1; s > 0; s >>= 1) {
      const rx = (curX & s) > 0 ? 1 : 0;
      const ry = (curY & s) > 0 ? 1 : 0;
      d += s * s * ((3 * rx) ^ ry);
      [curX, curY] = HilbertCurveSpatialIndexer.rot(s, curX, curY, rx, ry);
    }
    return d;
  }

  public static hilbertDistanceToXy(orderBits: number, distance: number): { x: number; y: number } {
    const n = 1 << orderBits;
    let t = distance;
    let x = 0;
    let y = 0;

    for (let s = 1; s < n; s <<= 1) {
      const rx = 1 & (t >> 1);
      const ry = 1 & (t ^ rx);
      [x, y] = HilbertCurveSpatialIndexer.rot(s, x, y, rx, ry);
      x += s * rx;
      y += s * ry;
      t >>= 2;
    }

    return { x, y };
  }
}
