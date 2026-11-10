export interface SplayNode {
  key: number;
  value: number;
  subtreeSum: number;
  subtreeSize: number;
  left: SplayNode | null;
  right: SplayNode | null;
}

/**
 * Daniel Sleator & Robert Tarjan's Self-Adjusting Binary Search Splay Tree.
 * Uses top-down splaying (Zig, Zig-Zig, Zig-Zag rotations) to move accessed keys to the root
 * in amortized O(log N) time while maintaining exact subtree sums and order statistics.
 */
export class SleatorTarjanSelfAdjustingSplayTree {
  private root: SplayNode | null = null;

  private static recompute(node: SplayNode | null): void {
    if (!node) return;
    node.subtreeSize =
      1 + (node.left?.subtreeSize ?? 0) + (node.right?.subtreeSize ?? 0);
    node.subtreeSum =
      node.value + (node.left?.subtreeSum ?? 0) + (node.right?.subtreeSum ?? 0);
  }

  private static rotateRight(y: SplayNode): SplayNode {
    const x = y.left!;
    y.left = x.right;
    x.right = y;
    SleatorTarjanSelfAdjustingSplayTree.recompute(y);
    SleatorTarjanSelfAdjustingSplayTree.recompute(x);
    return x;
  }

  private static rotateLeft(x: SplayNode): SplayNode {
    const y = x.right!;
    x.right = y.left;
    y.left = x;
    SleatorTarjanSelfAdjustingSplayTree.recompute(x);
    SleatorTarjanSelfAdjustingSplayTree.recompute(y);
    return y;
  }

  private static splayNode(root: SplayNode | null, key: number): SplayNode | null {
    if (!root || root.key === key) return root;

    if (key < root.key) {
      if (!root.left) return root;
      if (key < root.left.key) {
        // Zig-Zig (Left-Left)
        root.left.left = SleatorTarjanSelfAdjustingSplayTree.splayNode(root.left.left, key);
        root = SleatorTarjanSelfAdjustingSplayTree.rotateRight(root);
      } else if (key > root.left.key) {
        // Zig-Zag (Left-Right)
        root.left.right = SleatorTarjanSelfAdjustingSplayTree.splayNode(root.left.right, key);
        if (root.left.right) {
          root.left = SleatorTarjanSelfAdjustingSplayTree.rotateLeft(root.left);
        }
      }
      return root.left ? SleatorTarjanSelfAdjustingSplayTree.rotateRight(root) : root;
    } else {
      if (!root.right) return root;
      if (key > root.right.key) {
        // Zig-Zig (Right-Right)
        root.right.right = SleatorTarjanSelfAdjustingSplayTree.splayNode(root.right.right, key);
        root = SleatorTarjanSelfAdjustingSplayTree.rotateLeft(root);
      } else if (key < root.right.key) {
        // Zig-Zag (Right-Left)
        root.right.left = SleatorTarjanSelfAdjustingSplayTree.splayNode(root.right.left, key);
        if (root.right.left) {
          root.right = SleatorTarjanSelfAdjustingSplayTree.rotateRight(root.right);
        }
      }
      return root.right ? SleatorTarjanSelfAdjustingSplayTree.rotateLeft(root) : root;
    }
  }

  public upsert(key: number, value: number): void {
    if (!this.root) {
      this.root = {
        key,
        value,
        subtreeSum: value,
        subtreeSize: 1,
        left: null,
        right: null
      };
      return;
    }
    this.root = SleatorTarjanSelfAdjustingSplayTree.splayNode(this.root, key);
    if (this.root!.key === key) {
      this.root!.value = value;
      SleatorTarjanSelfAdjustingSplayTree.recompute(this.root);
      return;
    }

    const newNode: SplayNode = {
      key,
      value,
      subtreeSum: value,
      subtreeSize: 1,
      left: null,
      right: null
    };

    if (key < this.root!.key) {
      newNode.right = this.root;
      newNode.left = this.root!.left;
      this.root!.left = null;
      SleatorTarjanSelfAdjustingSplayTree.recompute(this.root);
    } else {
      newNode.left = this.root;
      newNode.right = this.root!.right;
      this.root!.right = null;
      SleatorTarjanSelfAdjustingSplayTree.recompute(this.root);
    }
    SleatorTarjanSelfAdjustingSplayTree.recompute(newNode);
    this.root = newNode;
  }

  public getAndSplayToRoot(key: number): number | null {
    if (!this.root) return null;
    this.root = SleatorTarjanSelfAdjustingSplayTree.splayNode(this.root, key);
    return this.root?.key === key ? this.root.value : null;
  }

  public getRootKey(): number | null {
    return this.root?.key ?? null;
  }

  public queryRangeSum(lowKey: number, highKey: number): number {
    const collect = (node: SplayNode | null): number => {
      if (!node) return 0;
      let sum = 0;
      if (node.key >= lowKey && node.key <= highKey) sum += node.value;
      if (node.key > lowKey) sum += collect(node.left);
      if (node.key < highKey) sum += collect(node.right);
      return sum;
    };
    return collect(this.root);
  }
}
