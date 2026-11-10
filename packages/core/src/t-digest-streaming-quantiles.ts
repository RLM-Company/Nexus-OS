export interface TDigestCentroid {
  mean: number;
  weight: number;
}

/**
 * Dunning's Merging t-Digest Streaming Quantile & Tail-Latency Estimator (p50, p95, p99, p99.9).
 * Uses the arcsin scale function k(q) = (compression / (2*pi)) * arcsin(2q - 1) to enforce
 * fine-grained centroid resolution near extreme tails (q -> 0 and q -> 1).
 */
export class TDigestStreamingQuantiles {
  public readonly compressionDelta: number;
  private centroids: TDigestCentroid[] = [];
  private totalWeight = 0;

  constructor(compressionDelta = 50) {
    this.compressionDelta = Math.max(10, compressionDelta);
  }

  private scaleFunctionK(q: number): number {
    const clamped = Math.min(1, Math.max(0, q));
    return (this.compressionDelta / (2 * Math.PI)) * Math.asin(2 * clamped - 1);
  }

  public add(value: number, weight = 1): void {
    if (!Number.isFinite(value) || weight <= 0) return;
    this.centroids.push({ mean: value, weight });
    this.totalWeight += weight;

    if (this.centroids.length > this.compressionDelta * 2) {
      this.compress();
    }
  }

  public compress(): void {
    if (this.centroids.length <= 1) return;
    this.centroids.sort((a, b) => a.mean - b.mean);

    const merged: TDigestCentroid[] = [];
    let current = { ...this.centroids[0]! };
    let weightSoFar = 0;

    for (let i = 1; i < this.centroids.length; i++) {
      const next = this.centroids[i]!;
      const q0 = weightSoFar / this.totalWeight;
      const q1 = (weightSoFar + current.weight + next.weight) / this.totalWeight;

      if (this.scaleFunctionK(q1) - this.scaleFunctionK(q0) <= 1.0) {
        const combinedWeight = current.weight + next.weight;
        current.mean =
          (current.mean * current.weight + next.mean * next.weight) / combinedWeight;
        current.weight = combinedWeight;
      } else {
        weightSoFar += current.weight;
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
    this.centroids = merged;
  }

  public quantile(q: number): number {
    if (this.centroids.length === 0) return 0;
    this.compress();

    const clampedQ = Math.min(1, Math.max(0, q));
    if (this.centroids.length === 1) return this.centroids[0]!.mean;
    if (clampedQ === 0) return this.centroids[0]!.mean;
    if (clampedQ === 1) return this.centroids[this.centroids.length - 1]!.mean;

    const targetWeight = clampedQ * this.totalWeight;
    let cumulative = 0;

    for (let i = 0; i < this.centroids.length; i++) {
      const c = this.centroids[i]!;
      const midWeight = cumulative + c.weight / 2;
      if (targetWeight <= midWeight) {
        if (i === 0) return c.mean;
        const prev = this.centroids[i - 1]!;
        const prevMid = cumulative - prev.weight / 2;
        const frac = (targetWeight - prevMid) / Math.max(1e-9, midWeight - prevMid);
        return Number((prev.mean + frac * (c.mean - prev.mean)).toFixed(6));
      }
      cumulative += c.weight;
    }

    return this.centroids[this.centroids.length - 1]!.mean;
  }

  public get count(): number {
    return this.totalWeight;
  }

  public get centroidCount(): number {
    return this.centroids.length;
  }
}
