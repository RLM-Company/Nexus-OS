export interface BrentCycleParameters {
  tailLengthMu: number;
  cyclePeriodLambda: number;
  cycleEntryState: number;
}

/**
 * Richard Brent's Teleporting Power-of-Two Cycle Detector & John Pollard's Rho Integer Factorizer.
 * - Brent's algorithm finds exact cycle period lambda and tail offset mu using 36% fewer function
 *   evaluations than Floyd's tortoise-and-hare.
 * - Pollard's Rho uses polynomial walk f(x) = (x^2 + c) mod N to split composite integers into
 *   prime factors in O(N^{1/4}) expected steps.
 */
export class BrentCycleAndPollardRhoEngine {
  public static detectCycleBrent(
    x0: number,
    nextFn: (x: number) => number,
    maxSteps: number = 100000
  ): BrentCycleParameters {
    let power = 1;
    let lambda = 1;
    let tortoise = x0;
    let hare = nextFn(x0);
    let steps = 0;

    while (tortoise !== hare && steps < maxSteps) {
      if (power === lambda) {
        tortoise = hare;
        power *= 2;
        lambda = 0;
      }
      hare = nextFn(hare);
      lambda += 1;
      steps += 1;
    }

    tortoise = x0;
    hare = x0;
    for (let i = 0; i < lambda; i++) {
      hare = nextFn(hare);
    }

    let mu = 0;
    while (tortoise !== hare) {
      tortoise = nextFn(tortoise);
      hare = nextFn(hare);
      mu += 1;
    }

    return {
      tailLengthMu: mu,
      cyclePeriodLambda: lambda,
      cycleEntryState: tortoise
    };
  }

  public static gcd(a: bigint, b: bigint): bigint {
    let x = a < 0n ? -a : a;
    let y = b < 0n ? -b : b;
    while (y !== 0n) {
      const t = x % y;
      x = y;
      y = t;
    }
    return x;
  }

  public static factorizePollardRho(nInput: bigint): bigint[] {
    let n = nInput;
    if (n <= 1n) return [];
    const factors: bigint[] = [];

    while (n % 2n === 0n) {
      factors.push(2n);
      n /= 2n;
    }

    const isPrimeTrial = (m: bigint): boolean => {
      if (m < 2n) return false;
      if (m % 2n === 0n) return m === 2n;
      for (let d = 3n; d * d <= m && d < 100000n; d += 2n) {
        if (m % d === 0n) return false;
      }
      return true;
    };

    const rhoOneFactor = (m: bigint): bigint => {
      if (m % 2n === 0n) return 2n;
      for (let c = 1n; c < 32n; c++) {
        let x = 2n;
        let y = 2n;
        let d = 1n;
        const f = (v: bigint): bigint => (v * v + c) % m;
        while (d === 1n) {
          x = f(x);
          y = f(f(y));
          const diff = x >= y ? x - y : y - x;
          d = BrentCycleAndPollardRhoEngine.gcd(diff, m);
        }
        if (d !== m) return d;
      }
      return m;
    };

    const split = (m: bigint): void => {
      if (m === 1n) return;
      if (isPrimeTrial(m)) {
        factors.push(m);
        return;
      }
      const d = rhoOneFactor(m);
      if (d === m) {
        factors.push(m);
        return;
      }
      split(d);
      split(m / d);
    };

    split(n);
    factors.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return factors;
  }
}
