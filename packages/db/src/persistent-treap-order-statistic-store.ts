import { DatabaseSync } from "node:sqlite";

interface TreapNode<TValue> {
  key: number;
  priority: number;
  value: TValue;
  subtreeSize: number;
  left: TreapNode<TValue> | null;
  right: TreapNode<TValue> | null;
}

/**
 * Seidel & Aragon Randomized Order-Statistic Treap (Cartesian Tree: BST by key + Max-Heap by priority)
 * backed by SQLite (`kosmora_treap_order_nodes`).
 * Supports O(log N) split/merge, k-th smallest element selection (`selectByRank`), and rank queries (`rankOfKey`).
 */
export class OrderStatisticTreapStore<TValue = unknown> {
  private readonly sqlite: DatabaseSync;
  private readonly treeName: string;
  private root: TreapNode<TValue> | null = null;

  constructor(sqlite: DatabaseSync, treeName = "default_treap") {
    this.sqlite = sqlite;
    this.treeName = treeName;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_treap_order_nodes (
        tree_name TEXT NOT NULL,
        node_key REAL NOT NULL,
        priority INTEGER NOT NULL,
        value_json TEXT NOT NULL,
        PRIMARY KEY (tree_name, node_key)
      );
    `);
  }

  private static hashPriority(key: number): number {
    let h = (Math.floor(key * 1000) ^ 2166136261) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  private static sizeOf<T>(node: TreapNode<T> | null): number {
    return node ? node.subtreeSize : 0;
  }

  private static updateSize<T>(node: TreapNode<T> | null): void {
    if (!node) return;
    node.subtreeSize =
      1 +
      OrderStatisticTreapStore.sizeOf(node.left) +
      OrderStatisticTreapStore.sizeOf(node.right);
  }

  private split(
    node: TreapNode<TValue> | null,
    splitKey: number
  ): [TreapNode<TValue> | null, TreapNode<TValue> | null] {
    if (!node) return [null, null];
    if (node.key <= splitKey) {
      const [leftOfRight, rightOfRight] = this.split(node.right, splitKey);
      node.right = leftOfRight;
      OrderStatisticTreapStore.updateSize(node);
      return [node, rightOfRight];
    } else {
      const [leftOfLeft, rightOfLeft] = this.split(node.left, splitKey);
      node.left = rightOfLeft;
      OrderStatisticTreapStore.updateSize(node);
      return [leftOfLeft, node];
    }
  }

  private merge(
    left: TreapNode<TValue> | null,
    right: TreapNode<TValue> | null
  ): TreapNode<TValue> | null {
    if (!left || !right) return left ?? right;
    if (left.priority > right.priority) {
      left.right = this.merge(left.right, right);
      OrderStatisticTreapStore.updateSize(left);
      return left;
    } else {
      right.left = this.merge(left, right.left);
      OrderStatisticTreapStore.updateSize(right);
      return right;
    }
  }

  public insert(key: number, value: TValue): void {
    const priority = OrderStatisticTreapStore.hashPriority(key);
    const [lessOrEq, greater] = this.split(this.root, key);
    const [strictlyLess] = this.split(lessOrEq, key - 1e-9);

    const newNode: TreapNode<TValue> = {
      key,
      priority,
      value,
      subtreeSize: 1,
      left: null,
      right: null
    };

    this.root = this.merge(this.merge(strictlyLess, newNode), greater);

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_treap_order_nodes (tree_name, node_key, priority, value_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tree_name, node_key) DO UPDATE SET
          priority = excluded.priority,
          value_json = excluded.value_json`
      )
      .run(this.treeName, key, priority, JSON.stringify(value));
  }

  /**
   * 0-indexed Order Statistic query: returns the k-th smallest element in O(log N) time.
   */
  public selectByRank(rankIndex0: number): { key: number; value: TValue } | null {
    let curr = this.root;
    let k = rankIndex0;
    while (curr !== null) {
      const leftSize = OrderStatisticTreapStore.sizeOf(curr.left);
      if (k === leftSize) {
        return { key: curr.key, value: curr.value };
      } else if (k < leftSize) {
        curr = curr.left;
      } else {
        k -= leftSize + 1;
        curr = curr.right;
      }
    }
    return null;
  }

  /**
   * Returns the count of elements strictly less than `key` in O(log N) time.
   */
  public rankOfKey(key: number): number {
    let curr = this.root;
    let rank = 0;
    while (curr !== null) {
      if (key <= curr.key) {
        curr = curr.left;
      } else {
        rank += 1 + OrderStatisticTreapStore.sizeOf(curr.left);
        curr = curr.right;
      }
    }
    return rank;
  }
}
