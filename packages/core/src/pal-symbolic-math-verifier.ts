export type PhysicalDimension =
  | "bytes"
  | "milliseconds"
  | "tokens"
  | "usd"
  | "dimensionless";

export interface DimensionalQuantity {
  value: number;
  unit: string;
  canonicalValue: number;
  dimension: PhysicalDimension;
}

export interface InlineEquationAudit {
  equationText: string;
  lhsValue: number;
  rhsValue: number;
  discrepancy: number;
  valid: boolean;
  correctedEquation: string;
}

const UNIT_CONVERSIONS: Record<
  string,
  { dimension: PhysicalDimension; multiplierToCanonical: number }
> = {
  b: { dimension: "bytes", multiplierToCanonical: 1 },
  bytes: { dimension: "bytes", multiplierToCanonical: 1 },
  kb: { dimension: "bytes", multiplierToCanonical: 1_000 },
  kib: { dimension: "bytes", multiplierToCanonical: 1_024 },
  mb: { dimension: "bytes", multiplierToCanonical: 1_000_000 },
  mib: { dimension: "bytes", multiplierToCanonical: 1_048_576 },
  gb: { dimension: "bytes", multiplierToCanonical: 1_000_000_000 },
  gib: { dimension: "bytes", multiplierToCanonical: 1_073_741_824 },
  ms: { dimension: "milliseconds", multiplierToCanonical: 1 },
  s: { dimension: "milliseconds", multiplierToCanonical: 1_000 },
  sec: { dimension: "milliseconds", multiplierToCanonical: 1_000 },
  min: { dimension: "milliseconds", multiplierToCanonical: 60_000 },
  h: { dimension: "milliseconds", multiplierToCanonical: 3_600_000 },
  tokens: { dimension: "tokens", multiplierToCanonical: 1 },
  k_tokens: { dimension: "tokens", multiplierToCanonical: 1_000 },
  m_tokens: { dimension: "tokens", multiplierToCanonical: 1_000_000 },
  usd: { dimension: "usd", multiplierToCanonical: 1 },
  cents: { dimension: "usd", multiplierToCanonical: 0.01 }
};

/**
 * Program-Aided Language Model (PAL) Symbolic Math, Dimensional Analysis & Equation Auditor.
 * Eliminates LLM arithmetic and unit-conversion errors by executing deterministic dimensional
 * conversions, composite SLA reliability math, and inline equation verification.
 */
export class PalSymbolicMathVerifier {
  public static parseQuantity(value: number, unit: string): DimensionalQuantity {
    const key = unit.trim().toLowerCase();
    const spec = UNIT_CONVERSIONS[key];
    if (!spec) {
      return {
        value,
        unit,
        canonicalValue: value,
        dimension: "dimensionless"
      };
    }
    return {
      value,
      unit,
      canonicalValue: Number((value * spec.multiplierToCanonical).toFixed(6)),
      dimension: spec.dimension
    };
  }

  public static addQuantities(a: DimensionalQuantity, b: DimensionalQuantity): DimensionalQuantity {
    if (a.dimension !== b.dimension) {
      throw new Error(
        `DIMENSIONAL_MISMATCH: Cannot add '${a.dimension}' (${a.unit}) and '${b.dimension}' (${b.unit})`
      );
    }
    const sumCanonical = Number((a.canonicalValue + b.canonicalValue).toFixed(6));
    return {
      value: sumCanonical,
      unit: a.dimension,
      canonicalValue: sumCanonical,
      dimension: a.dimension
    };
  }

  /**
   * Computes exact composite system availability:
   * - "series": all components must succeed -> \prod_i a_i
   * - "parallel_redundancy": at least one replica must succeed -> 1 - \prod_i (1 - a_i)
   */
  public static computeCompositeSlaAvailability(
    availabilities: number[],
    topology: "series" | "parallel_redundancy"
  ): number {
    if (availabilities.length === 0) return 1.0;
    if (topology === "series") {
      const prod = availabilities.reduce((acc, a) => acc * Math.min(1, Math.max(0, a)), 1.0);
      return Number(prod.toFixed(6));
    }
    const failProd = availabilities.reduce(
      (acc, a) => acc * (1 - Math.min(1, Math.max(0, a))),
      1.0
    );
    return Number((1 - failProd).toFixed(6));
  }

  /**
   * Scans generated text for simple arithmetic equations of the form `A + B = C`, `A - B = C`,
   * or `A * B = C` and flags any arithmetic hallucination.
   */
  public static auditInlineEquations(text: string, tolerance = 1e-2): InlineEquationAudit[] {
    const audits: InlineEquationAudit[] = [];
    const regex =
      /(-?\d+(?:\.\d+)?)\s*([+\-*])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)/g;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const a = Number(match[1]);
      const op = match[2]!;
      const b = Number(match[3]);
      const statedRhs = Number(match[4]);

      let trueLhs = 0;
      if (op === "+") trueLhs = a + b;
      else if (op === "-") trueLhs = a - b;
      else if (op === "*") trueLhs = a * b;

      const discrepancy = Number(Math.abs(trueLhs - statedRhs).toFixed(6));
      const valid = discrepancy <= tolerance;

      audits.push({
        equationText: match[0],
        lhsValue: Number(trueLhs.toFixed(6)),
        rhsValue: statedRhs,
        discrepancy,
        valid,
        correctedEquation: `${match[1]} ${op} ${match[3]} = ${Number(trueLhs.toFixed(4))}`
      });
    }

    return audits;
  }
}
