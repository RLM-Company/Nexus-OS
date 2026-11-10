interface SkipNode<TValue> {
  key: string;
  value: TValue;
  forward: Array<SkipNode<TValue> | null>;
}

/**
 * Pugh's Multi-Level Probabilistic Skip List Ordered Key-Value Index.
 * Supports O(log N) search, insertion, deletion, and ordered range scans `[startKey, endKey]`
 * without requiring complex tree rebalancing rotations.
 */
export class ProbabilisticSkipListIndex<TValue = unknown> {
  public readonly maxLevel: number;
  private currentLevel = 0;
  private sizeCount = 0;
  private readonly head: SkipNode<TValue>;

  constructor(maxLevel = 12) {
    this.maxLevel = Math.max(4, maxLevel);
    this.head = {
      key: "",
      value: undefined as unknown as TValue,
      forward: new Array<SkipNode<TValue> | null>(this.maxLevel + 1).fill(null)
    };
  }

  /**
   * Deterministic FNV-1a geometric tower height in `[0..maxLevel]` with p = 0.5.
   */
  private computeNodeLevel(key: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    let lvl = 0;
    while ((h & 1) === 1 && lvl < this.maxLevel) {
      lvl++;
      h >>>= 1;
    }
    return lvl;
  }

  public set(key: string, value: TValue): void {
    const update = new Array<SkipNode<TValue>>(this.maxLevel + 1);
    let curr = this.head;

    for (let i = this.currentLevel; i >= 0; i--) {
      while (curr.forward[i] !== null && curr.forward[i]!.key < key) {
        curr = curr.forward[i]!;
      }
      update[i] = curr;
    }

    const candidate = curr.forward[0];
    if (candidate !== null && candidate !== undefined && candidate.key === key) {
      candidate.value = value;
      return;
    }

    const newLevel = this.computeNodeLevel(key);
    if (newLevel > this.currentLevel) {
      for (let i = this.currentLevel + 1; i <= newLevel; i++) {
        update[i] = this.head;
      }
      this.currentLevel = newLevel;
    }

    const newNode: SkipNode<TValue> = {
      key,
      value,
      forward: new Array<SkipNode<TValue> | null>(newLevel + 1).fill(null)
    };

    for (let i = 0; i <= newLevel; i++) {
      newNode.forward[i] = update[i]!.forward[i] ?? null;
      update[i]!.forward[i] = newNode;
    }
    this.sizeCount++;
  }

  public get(key: string): TValue | undefined {
    let curr = this.head;
    for (let i = this.currentLevel; i >= 0; i--) {
      while (curr.forward[i] !== null && curr.forward[i]!.key < key) {
        curr = curr.forward[i]!;
      }
    }
    const target = curr.forward[0];
    if (target !== null && target !== undefined && target.key === key) {
      return target.value;
    }
    return undefined;
  }

  public delete(key: string): boolean {
    const update = new Array<SkipNode<TValue>>(this.maxLevel + 1);
    let curr = this.head;

    for (let i = this.currentLevel; i >= 0; i--) {
      while (curr.forward[i] !== null && curr.forward[i]!.key < key) {
        curr = curr.forward[i]!;
      }
      update[i] = curr;
    }

    const target = curr.forward[0];
    if (target === null || target === undefined || target.key !== key) {
      return false;
    }

    for (let i = 0; i <= this.currentLevel; i++) {
      if (update[i]!.forward[i] !== target) break;
      update[i]!.forward[i] = target.forward[i] ?? null;
    }

    while (this.currentLevel > 0 && this.head.forward[this.currentLevel] === null) {
      this.currentLevel--;
    }
    this.sizeCount--;
    return true;
  }

  public rangeScan(startKey: string, endKey: string): Array<{ key: string; value: TValue }> {
    let curr = this.head;
    for (let i = this.currentLevel; i >= 0; i--) {
      while (curr.forward[i] !== null && curr.forward[i]!.key < startKey) {
        curr = curr.forward[i]!;
      }
    }

    let node = curr.forward[0];
    const results: Array<{ key: string; value: TValue }> = [];
    while (node !== null && node !== undefined && node.key <= endKey) {
      results.push({ key: node.key, value: node.value });
      node = node.forward[0] ?? null;
    }
    return results;
  }

  public get size(): number {
    return this.sizeCount;
  }
}
