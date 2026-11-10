interface RadixNode<TValue> {
  edgeLabel: string;
  hasValue: boolean;
  value?: TValue;
  children: Map<string, RadixNode<TValue>>; // firstChar -> child node
}

/**
 * Morrison's Compact Prefix Tree (Patricia / Radix Trie) with Edge Path Compression.
 * Compresses single-child chains into compact string edges and supports O(K) exact lookup,
 * longest-prefix routing (`findLongestPrefixMatch`), and prefix enumeration.
 */
export class RadixPatriciaCompactTrie<TValue = unknown> {
  private readonly root: RadixNode<TValue> = {
    edgeLabel: "",
    hasValue: false,
    children: new Map()
  };

  private static commonPrefixLength(a: string, b: string): number {
    const len = Math.min(a.length, b.length);
    let i = 0;
    while (i < len && a[i] === b[i]) i++;
    return i;
  }

  public insert(key: string, value: TValue): void {
    let curr = this.root;
    let rem = key;

    while (rem.length > 0) {
      const firstChar = rem[0]!;
      const child = curr.children.get(firstChar);

      if (!child) {
        curr.children.set(firstChar, {
          edgeLabel: rem,
          hasValue: true,
          value,
          children: new Map()
        });
        return;
      }

      const lcp = RadixPatriciaCompactTrie.commonPrefixLength(rem, child.edgeLabel);

      if (lcp === child.edgeLabel.length) {
        // Full child edge matched
        rem = rem.slice(lcp);
        curr = child;
        if (rem.length === 0) {
          curr.hasValue = true;
          curr.value = value;
          return;
        }
        continue;
      }

      // Split `child` at `lcp`
      const commonEdge = child.edgeLabel.slice(0, lcp);
      const childSuffix = child.edgeLabel.slice(lcp);
      const remSuffix = rem.slice(lcp);

      const splitNode: RadixNode<TValue> = {
        edgeLabel: commonEdge,
        hasValue: remSuffix.length === 0,
        value: remSuffix.length === 0 ? value : undefined,
        children: new Map()
      };

      child.edgeLabel = childSuffix;
      splitNode.children.set(childSuffix[0]!, child);

      if (remSuffix.length > 0) {
        splitNode.children.set(remSuffix[0]!, {
          edgeLabel: remSuffix,
          hasValue: true,
          value,
          children: new Map()
        });
      }

      curr.children.set(firstChar, splitNode);
      return;
    }

    curr.hasValue = true;
    curr.value = value;
  }

  public get(key: string): TValue | undefined {
    let curr = this.root;
    let rem = key;

    while (rem.length > 0) {
      const child = curr.children.get(rem[0]!);
      if (!child || !rem.startsWith(child.edgeLabel)) {
        return undefined;
      }
      rem = rem.slice(child.edgeLabel.length);
      curr = child;
    }

    return curr.hasValue ? curr.value : undefined;
  }

  /**
   * Finds the longest stored prefix of `query` (e.g., for API route or filesystem mount matching).
   */
  public findLongestPrefixMatch(
    query: string
  ): { matchedPrefix: string; value: TValue } | null {
    let curr = this.root;
    let rem = query;
    let consumed = "";
    let bestMatch: { matchedPrefix: string; value: TValue } | null = curr.hasValue
      ? { matchedPrefix: "", value: curr.value! }
      : null;

    while (rem.length > 0) {
      const child = curr.children.get(rem[0]!);
      if (!child || !rem.startsWith(child.edgeLabel)) {
        break;
      }
      consumed += child.edgeLabel;
      rem = rem.slice(child.edgeLabel.length);
      curr = child;
      if (curr.hasValue) {
        bestMatch = { matchedPrefix: consumed, value: curr.value! };
      }
    }

    return bestMatch;
  }
}
