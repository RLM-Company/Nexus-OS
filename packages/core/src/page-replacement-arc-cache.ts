/**
 * Megiddo & Modha's Self-Tuning Adaptive Replacement Cache (ARC).
 * Maintains four LRU lists:
 *  - T1: recent cache entries (seen once recently)
 *  - T2: frequent cache entries (seen >= 2 times recently)
 *  - B1: ghost history of keys recently evicted from T1
 *  - B2: ghost history of keys recently evicted from T2
 * Dynamically adapts target recency size `p` in [0..capacity] to resist scan pollution.
 */
export class AdaptiveReplacementCacheArc<TValue = unknown> {
  public readonly capacity: number;
  public targetT1SizeP = 0;

  private readonly store = new Map<string, TValue>();
  private readonly t1: string[] = []; // front = LRU, back = MRU
  private readonly t2: string[] = [];
  private readonly b1: string[] = [];
  private readonly b2: string[] = [];

  constructor(capacity = 32) {
    this.capacity = Math.max(2, capacity);
  }

  private removeKey(list: string[], key: string): boolean {
    const idx = list.indexOf(key);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  }

  private replace(inB2: boolean): void {
    const t1Len = this.t1.length;
    if (t1Len > 0 && (t1Len > this.targetT1SizeP || (inB2 && t1Len === Math.floor(this.targetT1SizeP)))) {
      const evicted = this.t1.shift()!;
      this.store.delete(evicted);
      this.b1.push(evicted);
      if (this.b1.length > this.capacity) this.b1.shift();
    } else if (this.t2.length > 0) {
      const evicted = this.t2.shift()!;
      this.store.delete(evicted);
      this.b2.push(evicted);
      if (this.b2.length > this.capacity) this.b2.shift();
    }
  }

  public get(key: string): TValue | undefined {
    if (!this.store.has(key)) {
      return undefined;
    }
    // Hit in T1 or T2 -> promote to MRU of T2
    if (!this.removeKey(this.t1, key)) {
      this.removeKey(this.t2, key);
    }
    this.t2.push(key);
    return this.store.get(key);
  }

  public put(key: string, value: TValue): void {
    // Case 1: Key already in T1 or T2
    if (this.store.has(key)) {
      this.store.set(key, value);
      this.get(key);
      return;
    }

    // Case 2: Key in ghost list B1 (recency hit -> increase p)
    if (this.removeKey(this.b1, key)) {
      const delta = this.b1.length >= this.b2.length ? 1 : Math.ceil(this.b2.length / Math.max(1, this.b1.length));
      this.targetT1SizeP = Math.min(this.capacity, this.targetT1SizeP + delta);
      this.replace(false);
      this.t2.push(key);
      this.store.set(key, value);
      return;
    }

    // Case 3: Key in ghost list B2 (frequency hit -> decrease p)
    if (this.removeKey(this.b2, key)) {
      const delta = this.b2.length >= this.b1.length ? 1 : Math.ceil(this.b1.length / Math.max(1, this.b2.length));
      this.targetT1SizeP = Math.max(0, this.targetT1SizeP - delta);
      this.replace(true);
      this.t2.push(key);
      this.store.set(key, value);
      return;
    }

    // Case 4: Complete cache miss
    const l1Len = this.t1.length + this.b1.length;
    if (l1Len === this.capacity) {
      if (this.t1.length < this.capacity) {
        this.b1.shift();
        this.replace(false);
      } else {
        const evicted = this.t1.shift()!;
        this.store.delete(evicted);
      }
    } else if (l1Len < this.capacity) {
      const totalLen = this.t1.length + this.t2.length + this.b1.length + this.b2.length;
      if (totalLen >= this.capacity) {
        if (totalLen === 2 * this.capacity && this.b2.length > 0) {
          this.b2.shift();
        }
        this.replace(false);
      }
    }

    this.t1.push(key);
    this.store.set(key, value);
  }

  public getStats(): {
    t1Size: number;
    t2Size: number;
    b1GhostSize: number;
    b2GhostSize: number;
    targetT1SizeP: number;
  } {
    return {
      t1Size: this.t1.length,
      t2Size: this.t2.length,
      b1GhostSize: this.b1.length,
      b2GhostSize: this.b2.length,
      targetT1SizeP: this.targetT1SizeP
    };
  }
}
