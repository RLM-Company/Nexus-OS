/**
 * Vose's Alias Method O(1) Discrete Probability Distribution Sampler &
 * Vitter's Algorithm R Uniform Stream Reservoir Sampler.
 * Builds `prob[]` and `alias[]` tables in O(N) time and draws exact weighted samples in O(1) time.
 */
export class VoseAliasMethodO1DiscreteSampler<TItem = string> {
  private readonly items: TItem[];
  private readonly prob: Float64Array;
  private readonly alias: Int32Array;

  constructor(weightedItems: Array<{ item: TItem; weight: number }>) {
    if (weightedItems.length === 0) {
      throw new Error("EMPTY_ALIAS_DISTRIBUTION");
    }
    const n = weightedItems.length;
    this.items = weightedItems.map((w) => w.item);
    this.prob = new Float64Array(n);
    this.alias = new Int32Array(n);

    const totalWeight = Math.max(
      1e-12,
      weightedItems.reduce((acc, w) => acc + Math.max(0, w.weight), 0)
    );

    const scaled = weightedItems.map((w) => (Math.max(0, w.weight) * n) / totalWeight);
    const small: number[] = [];
    const large: number[] = [];

    for (let i = 0; i < n; i++) {
      if (scaled[i]! < 1.0) small.push(i);
      else large.push(i);
    }

    while (small.length > 0 && large.length > 0) {
      const l = small.pop()!;
      const g = large.pop()!;
      this.prob[l] = scaled[l]!;
      this.alias[l] = g;
      scaled[g] = scaled[g]! + scaled[l]! - 1.0;
      if (scaled[g]! < 1.0) {
        small.push(g);
      } else {
        large.push(g);
      }
    }

    while (large.length > 0) {
      this.prob[large.pop()!] = 1.0;
    }
    while (small.length > 0) {
      this.prob[small.pop()!] = 1.0;
    }
  }

  /**
   * O(1) constant-time draw given two uniform random numbers u1, u2 in [0, 1).
   */
  public sampleO1(u1: number, u2: number): TItem {
    const n = this.items.length;
    const col = Math.min(n - 1, Math.floor(Math.max(0, u1) * n));
    const idx = u2 < this.prob[col]! ? col : this.alias[col]!;
    return this.items[idx]!;
  }

  /**
   * Vitter's Algorithm R Reservoir Sampling: selects k items uniformly at random from a stream in a single pass.
   */
  public static reservoirSample<T>(
    stream: T[],
    reservoirSizeK: number,
    seed = 42
  ): T[] {
    const k = Math.max(1, reservoirSizeK);
    if (stream.length <= k) return [...stream];

    const reservoir = stream.slice(0, k);
    let rng = seed >>> 0;
    const nextRandInt = (maxExclusive: number) => {
      rng ^= rng << 13;
      rng ^= rng >>> 17;
      rng ^= rng << 5;
      return (rng >>> 0) % maxExclusive;
    };

    for (let i = k; i < stream.length; i++) {
      const j = nextRandInt(i + 1);
      if (j < k) {
        reservoir[j] = stream[i]!;
      }
    }
    return reservoir;
  }
}
