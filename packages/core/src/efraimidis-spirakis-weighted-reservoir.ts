export interface WeightedReservoirEntry<T> {
  item: T;
  weight: number;
  priorityKey: number;
}

/**
 * Efraimidis & Spirakis (Algorithm A-Res) One-Pass Weighted Reservoir Sampler Without Replacement.
 * Assigns each streaming item i with positive weight w_i a key k_i = u_i^(1 / w_i) where u_i in (0, 1),
 * and retains the m items with the largest keys k_i, matching exact sequential weighted sampling
 * without replacement in a single pass.
 */
export class EfraimidisSpirakisWeightedReservoir<T> {
  private readonly capacityM: number;
  private readonly reservoir: Array<WeightedReservoirEntry<T>> = [];
  private rngState = 0x243f6a88;

  public constructor(capacityM: number = 5) {
    this.capacityM = Math.max(1, capacityM);
  }

  private nextUniform01(): number {
    this.rngState ^= this.rngState << 13;
    this.rngState ^= this.rngState >>> 17;
    this.rngState ^= this.rngState << 5;
    const u = ((this.rngState >>> 0) + 1) / 4294967297;
    return Math.min(0.999999999, Math.max(1e-12, u));
  }

  public offer(item: T, weight: number, explicitUniformU?: number): void {
    if (weight <= 0) return;
    const u = explicitUniformU ?? this.nextUniform01();
    const key = Math.pow(u, 1 / weight);

    if (this.reservoir.length < this.capacityM) {
      this.reservoir.push({ item, weight, priorityKey: key });
      this.reservoir.sort((a, b) => a.priorityKey - b.priorityKey);
    } else if (key > this.reservoir[0]!.priorityKey) {
      this.reservoir[0] = { item, weight, priorityKey: key };
      this.reservoir.sort((a, b) => a.priorityKey - b.priorityKey);
    }
  }

  public getSample(): Array<WeightedReservoirEntry<T>> {
    return [...this.reservoir].sort((a, b) => b.priorityKey - a.priorityKey);
  }
}
