export interface MassAssignment {
  /**
   * Maps focal subset key (comma-sorted hypothesis IDs, or "*" for the full frame of discernment Theta)
   * to basic probability mass in [0..1].
   */
  masses: Record<string, number>;
}

export interface DempsterShaferFusionReport {
  combinedMasses: Record<string, number>;
  conflictFactorK: number;
  beliefByHypothesis: Record<string, number>;
  plausibilityByHypothesis: Record<string, number>;
  remainingIgnorance: number;
}

function parseSubset(key: string, allHypotheses: string[]): Set<string> {
  if (key === "*") return new Set(allHypotheses);
  return new Set(
    key
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function serializeSubset(set: Set<string>, allHypotheses: string[]): string {
  if (set.size === allHypotheses.length) return "*";
  return Array.from(set).sort().join(",");
}

/**
 * Dempster-Shafer Theory of Evidence & Multi-Source Belief Fusion Engine.
 * Combines evidence mass functions m_1 and m_2 with explicit epistemic ignorance ("*")
 * via Dempster's Rule of Combination and computes [Belief, Plausibility] intervals.
 */
export class DempsterShaferEvidenceFusion {
  public static combineTwoSources(
    frameOfDiscernment: string[],
    sourceA: MassAssignment,
    sourceB: MassAssignment
  ): DempsterShaferFusionReport {
    const intersectionSums = new Map<string, number>();
    let conflictK = 0;

    for (const [keyA, massA] of Object.entries(sourceA.masses)) {
      if (massA <= 0) continue;
      const setA = parseSubset(keyA, frameOfDiscernment);

      for (const [keyB, massB] of Object.entries(sourceB.masses)) {
        if (massB <= 0) continue;
        const setB = parseSubset(keyB, frameOfDiscernment);

        const inter = new Set<string>();
        for (const el of setA) {
          if (setB.has(el)) inter.add(el);
        }

        const prod = massA * massB;
        if (inter.size === 0) {
          conflictK += prod;
        } else {
          const interKey = serializeSubset(inter, frameOfDiscernment);
          intersectionSums.set(interKey, (intersectionSums.get(interKey) ?? 0) + prod);
        }
      }
    }

    if (conflictK >= 0.999999) {
      throw new Error("DEMPSTER_TOTAL_CONFLICT: sources are 100% mutually contradictory");
    }

    const normDenom = 1.0 - conflictK;
    const combinedMasses: Record<string, number> = {};
    for (const [k, rawMass] of intersectionSums.entries()) {
      combinedMasses[k] = Number((rawMass / normDenom).toFixed(6));
    }

    const beliefByHypothesis: Record<string, number> = {};
    const plausibilityByHypothesis: Record<string, number> = {};

    for (const h of frameOfDiscernment) {
      let bel = 0;
      let pl = 0;
      for (const [subKey, m] of Object.entries(combinedMasses)) {
        const subSet = parseSubset(subKey, frameOfDiscernment);
        // Bel({h}) sums masses of subsets B \subseteq {h} -> i.e., singleton {h}
        if (subSet.size === 1 && subSet.has(h)) {
          bel += m;
        }
        // Pl({h}) sums masses of all subsets B where B \cap {h} != \emptyset
        if (subSet.has(h)) {
          pl += m;
        }
      }
      beliefByHypothesis[h] = Number(bel.toFixed(6));
      plausibilityByHypothesis[h] = Number(pl.toFixed(6));
    }

    return {
      combinedMasses,
      conflictFactorK: Number(conflictK.toFixed(6)),
      beliefByHypothesis,
      plausibilityByHypothesis,
      remainingIgnorance: combinedMasses["*"] ?? 0
    };
  }
}
