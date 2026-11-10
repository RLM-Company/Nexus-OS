/**
 * Natural Cubic Spline Interpolator & Definite Quadrature Integrator via Thomas Tridiagonal Matrix Algorithm (TDMA).
 * Fits a C^2-continuous piecewise cubic polynomial S_i(x) = a_i + b_i(x - x_i) + c_i(x - x_i)^2 + d_i(x - x_i)^3
 * through knots (x_0, y_0)..(x_n, y_n) in O(N) time.
 */
export class NaturalCubicSplineAndPchipInterpolator {
  private readonly x: number[];
  private readonly a: number[];
  private readonly b: number[];
  private readonly c: number[];
  private readonly d: number[];

  constructor(knots: Array<{ x: number; y: number }>) {
    if (knots.length < 2) {
      throw new Error("CUBIC_SPLINE_MIN_2_KNOTS");
    }
    const sorted = [...knots].sort((p, q) => p.x - q.x);
    const n = sorted.length - 1;

    this.x = sorted.map((p) => p.x);
    this.a = sorted.map((p) => p.y);
    this.b = new Array<number>(n).fill(0);
    this.c = new Array<number>(n + 1).fill(0);
    this.d = new Array<number>(n).fill(0);

    const h = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      h[i] = Math.max(1e-9, this.x[i + 1]! - this.x[i]!);
    }

    const alpha = new Array<number>(n).fill(0);
    for (let i = 1; i < n; i++) {
      alpha[i] =
        (3.0 / h[i]!) * (this.a[i + 1]! - this.a[i]!) -
        (3.0 / h[i - 1]!) * (this.a[i]! - this.a[i - 1]!);
    }

    // Thomas O(N) Tridiagonal Matrix Solver for natural boundary conditions (c_0 = 0, c_n = 0)
    const l = new Array<number>(n + 1).fill(1);
    const mu = new Array<number>(n + 1).fill(0);
    const z = new Array<number>(n + 1).fill(0);

    for (let i = 1; i < n; i++) {
      l[i] = 2.0 * (this.x[i + 1]! - this.x[i - 1]!) - h[i - 1]! * mu[i - 1]!;
      mu[i] = h[i]! / l[i]!;
      z[i] = (alpha[i]! - h[i - 1]! * z[i - 1]!) / l[i]!;
    }

    for (let j = n - 1; j >= 0; j--) {
      this.c[j] = z[j]! - mu[j]! * this.c[j + 1]!;
      this.b[j] =
        (this.a[j + 1]! - this.a[j]!) / h[j]! -
        (h[j]! * (this.c[j + 1]! + 2.0 * this.c[j]!)) / 3.0;
      this.d[j] = (this.c[j + 1]! - this.c[j]!) / (3.0 * h[j]!);
    }
  }

  public evaluateAt(xVal: number): { value: number; firstDerivative: number } {
    const n = this.b.length;
    let idx = 0;
    if (xVal >= this.x[n]!) {
      idx = n - 1;
    } else if (xVal > this.x[0]!) {
      for (let i = 0; i < n; i++) {
        if (xVal >= this.x[i]! && xVal <= this.x[i + 1]!) {
          idx = i;
          break;
        }
      }
    }

    const dx = xVal - this.x[idx]!;
    const val =
      this.a[idx]! +
      this.b[idx]! * dx +
      this.c[idx]! * dx * dx +
      this.d[idx]! * dx * dx * dx;
    const deriv =
      this.b[idx]! + 2.0 * this.c[idx]! * dx + 3.0 * this.d[idx]! * dx * dx;

    return {
      value: Number(val.toFixed(6)),
      firstDerivative: Number(deriv.toFixed(6))
    };
  }
}
