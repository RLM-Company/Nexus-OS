/**
 * Jack Volder's CORDIC (COordinate Rotation DIgital Computer) Shift-and-Add Evaluator.
 * Computes sin(theta), cos(theta), atan2(y, x), and Euclidean hypot(x, y) using only
 * binary shifts 2^{-i} and additions across 28 micro-rotation stages, scaled by the
 * universal CORDIC gain K_n = prod_i 1 / sqrt(1 + 2^{-2i}) ≈ 0.6072529350088812.
 */
export class VolderCordicVectorRotationEngine {
  private static readonly STAGES = 28;
  private static readonly ATAN_TABLE: number[] = Array.from(
    { length: VolderCordicVectorRotationEngine.STAGES },
    (_, i) => Math.atan(Math.pow(2, -i))
  );
  private static readonly CORDIC_GAIN_INV: number = (() => {
    let k = 1.0;
    for (let i = 0; i < VolderCordicVectorRotationEngine.STAGES; i++) {
      k *= 1 / Math.sqrt(1 + Math.pow(2, -2 * i));
    }
    return k;
  })();

  public static evaluateSinCos(angleRadians: number): { sin: number; cos: number } {
    // Normalize angle to [-pi, pi], then fold into [-pi/2, pi/2]
    let z = ((angleRadians % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (z > Math.PI) z -= 2 * Math.PI;

    let signFlip = 1;
    if (z > Math.PI / 2) {
      z -= Math.PI;
      signFlip = -1;
    } else if (z < -Math.PI / 2) {
      z += Math.PI;
      signFlip = -1;
    }

    let x = VolderCordicVectorRotationEngine.CORDIC_GAIN_INV;
    let y = 0;

    for (let i = 0; i < VolderCordicVectorRotationEngine.STAGES; i++) {
      const sigma = z >= 0 ? 1 : -1;
      const factor = Math.pow(2, -i);
      const nextX = x - sigma * y * factor;
      const nextY = y + sigma * x * factor;
      x = nextX;
      y = nextY;
      z -= sigma * VolderCordicVectorRotationEngine.ATAN_TABLE[i]!;
    }

    return {
      sin: Number((signFlip * y).toFixed(6)),
      cos: Number((signFlip * x).toFixed(6))
    };
  }

  public static vectoringMagnitudeAndAtan2(
    yInput: number,
    xInput: number
  ): { magnitude: number; angleRadians: number } {
    if (xInput === 0 && yInput === 0) {
      return { magnitude: 0, angleRadians: 0 };
    }
    let x = Math.abs(xInput);
    let y = yInput;
    let z = 0;

    for (let i = 0; i < VolderCordicVectorRotationEngine.STAGES; i++) {
      const sigma = y < 0 ? 1 : -1;
      const factor = Math.pow(2, -i);
      const nextX = x - sigma * y * factor;
      const nextY = y + sigma * x * factor;
      x = nextX;
      y = nextY;
      z -= sigma * VolderCordicVectorRotationEngine.ATAN_TABLE[i]!;
    }

    const magnitude = x * VolderCordicVectorRotationEngine.CORDIC_GAIN_INV;
    let angle = z;
    if (xInput < 0) {
      angle = yInput >= 0 ? Math.PI - z : -Math.PI - z;
    }

    return {
      magnitude: Number(magnitude.toFixed(6)),
      angleRadians: Number(angle.toFixed(6))
    };
  }
}
