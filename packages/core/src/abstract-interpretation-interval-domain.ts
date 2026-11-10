export interface AbstractInterval {
  isBottom: boolean;
  low: number; // -Infinity allowed
  high: number; // +Infinity allowed
}

/**
 * Cousot & Cousot Abstract Interpretation over the Interval Lattice [low, high].
 * Implements Lattice Join (union hull), Meet (intersection), Widening (nabla), Narrowing (Delta),
 * and interval arithmetic with static Division-by-Zero and Out-of-Bounds safety checks.
 */
export class CousotIntervalAbstractInterpreter {
  public static bottom(): AbstractInterval {
    return { isBottom: true, low: Infinity, high: -Infinity };
  }

  public static interval(low: number, high: number): AbstractInterval {
    if (low > high) return CousotIntervalAbstractInterpreter.bottom();
    return { isBottom: false, low, high };
  }

  public static join(a: AbstractInterval, b: AbstractInterval): AbstractInterval {
    if (a.isBottom) return { ...b };
    if (b.isBottom) return { ...a };
    return {
      isBottom: false,
      low: Math.min(a.low, b.low),
      high: Math.max(a.high, b.high)
    };
  }

  public static meet(a: AbstractInterval, b: AbstractInterval): AbstractInterval {
    if (a.isBottom || b.isBottom) return CousotIntervalAbstractInterpreter.bottom();
    const low = Math.max(a.low, b.low);
    const high = Math.min(a.high, b.high);
    if (low > high) return CousotIntervalAbstractInterpreter.bottom();
    return { isBottom: false, low, high };
  }

  /**
   * Cousot Widening Operator (prev nabla next): jumps to -Infinity / +Infinity when bounds keep growing,
   * guaranteeing finite-step convergence on unbounded program loops!
   */
  public static widen(prev: AbstractInterval, next: AbstractInterval): AbstractInterval {
    if (prev.isBottom) return { ...next };
    if (next.isBottom) return { ...prev };
    return {
      isBottom: false,
      low: next.low < prev.low ? -Infinity : prev.low,
      high: next.high > prev.high ? Infinity : prev.high
    };
  }

  /**
   * Cousot Narrowing Operator (prev Delta next): refines infinite bounds back to finite loop guard bounds.
   */
  public static narrow(prev: AbstractInterval, next: AbstractInterval): AbstractInterval {
    if (prev.isBottom || next.isBottom) return CousotIntervalAbstractInterpreter.bottom();
    return {
      isBottom: false,
      low: prev.low === -Infinity ? next.low : Math.max(prev.low, next.low),
      high: prev.high === Infinity ? next.high : Math.min(prev.high, next.high)
    };
  }

  public static add(a: AbstractInterval, b: AbstractInterval): AbstractInterval {
    if (a.isBottom || b.isBottom) return CousotIntervalAbstractInterpreter.bottom();
    return { isBottom: false, low: a.low + b.low, high: a.high + b.high };
  }

  public static subtract(a: AbstractInterval, b: AbstractInterval): AbstractInterval {
    if (a.isBottom || b.isBottom) return CousotIntervalAbstractInterpreter.bottom();
    return { isBottom: false, low: a.low - b.high, high: a.high - b.low };
  }

  public static verifyDivisionSafety(divisor: AbstractInterval): {
    safeNeverZero: boolean;
    mayDivideByZero: boolean;
  } {
    if (divisor.isBottom) {
      return { safeNeverZero: true, mayDivideByZero: false };
    }
    const containsZero = divisor.low <= 0 && divisor.high >= 0;
    return {
      safeNeverZero: !containsZero,
      mayDivideByZero: containsZero
    };
  }

  public static verifyArrayBoundsSafety(
    indexInterval: AbstractInterval,
    arrayLength: number
  ): { guaranteedInBounds: boolean } {
    if (indexInterval.isBottom) return { guaranteedInBounds: true };
    return {
      guaranteedInBounds: indexInterval.low >= 0 && indexInterval.high < arrayLength
    };
  }
}
