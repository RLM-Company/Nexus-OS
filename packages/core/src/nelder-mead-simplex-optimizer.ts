export interface SimplexOptimizationResult {
  optimalPoint: number[];
  minimumObjectiveValue: number;
  iterationsExecuted: number;
  converged: boolean;
}

/**
 * Derivative-Free Nelder-Mead Downhill Simplex Optimizer in R^d.
 * Uses geometric Reflection (alpha=1), Expansion (gamma=2), Contraction (rho=0.5),
 * and Shrinkage (sigma=0.5) to minimize continuous non-differentiable objective functions.
 */
export class NelderMeadSimplexOptimizer {
  public static minimize(params: {
    objectiveFn: (point: number[]) => number;
    initialGuess: number[];
    stepSize?: number;
    maxIterations?: number;
    tolerance?: number;
  }): SimplexOptimizationResult {
    const d = params.initialGuess.length;
    const step = params.stepSize ?? 0.5;
    const maxIter = params.maxIterations ?? 150;
    const tol = params.tolerance ?? 1e-6;

    const alpha = 1.0; // Reflection
    const gamma = 2.0; // Expansion
    const rho = 0.5; // Contraction
    const sigma = 0.5; // Shrink

    // Initialize d + 1 simplex vertices
    let simplex: Array<{ pt: number[]; val: number }> = [
      { pt: [...params.initialGuess], val: params.objectiveFn(params.initialGuess) }
    ];

    for (let i = 0; i < d; i++) {
      const v = [...params.initialGuess];
      v[i] = v[i]! + step;
      simplex.push({ pt: v, val: params.objectiveFn(v) });
    }

    let converged = false;
    let iter = 0;

    for (; iter < maxIter; iter++) {
      simplex.sort((a, b) => a.val - b.val);

      const best = simplex[0]!;
      const worst = simplex[d]!;
      const secondWorst = simplex[d - 1]!;

      if (Math.abs(worst.val - best.val) <= tol) {
        converged = true;
        break;
      }

      // Centroid of all vertices except worst (indices 0..d-1)
      const centroid = new Array<number>(d).fill(0);
      for (let i = 0; i < d; i++) {
        for (let j = 0; j < d; j++) {
          centroid[j] = centroid[j]! + simplex[i]!.pt[j]! / d;
        }
      }

      // 1. Reflection: x_r = c + alpha * (c - x_worst)
      const xr = centroid.map((c, j) => c + alpha * (c - worst.pt[j]!));
      const fr = params.objectiveFn(xr);

      if (fr >= best.val && fr < secondWorst.val) {
        simplex[d] = { pt: xr, val: fr };
        continue;
      }

      // 2. Expansion: if reflected point is new global best
      if (fr < best.val) {
        const xe = centroid.map((c, j) => c + gamma * (xr[j]! - c));
        const fe = params.objectiveFn(xe);
        simplex[d] = fe < fr ? { pt: xe, val: fe } : { pt: xr, val: fr };
        continue;
      }

      // 3. Contraction
      const xc = centroid.map((c, j) => c + rho * (worst.pt[j]! - c));
      const fc = params.objectiveFn(xc);
      if (fc < worst.val) {
        simplex[d] = { pt: xc, val: fc };
        continue;
      }

      // 4. Shrinkage toward best vertex
      for (let i = 1; i <= d; i++) {
        const shrunk = simplex[i]!.pt.map((val, j) => best.pt[j]! + sigma * (val - best.pt[j]!));
        simplex[i] = { pt: shrunk, val: params.objectiveFn(shrunk) };
      }
    }

    simplex.sort((a, b) => a.val - b.val);
    return {
      optimalPoint: simplex[0]!.pt.map((x) => Number(x.toFixed(6))),
      minimumObjectiveValue: Number(simplex[0]!.val.toFixed(8)),
      iterationsExecuted: iter,
      converged
    };
  }
}
