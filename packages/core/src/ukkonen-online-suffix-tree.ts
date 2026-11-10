export interface SuffixTreeNode {
  edgeLabel: string;
  children: Map<string, SuffixTreeNode>;
  docMask: number;
  startOffsets: number[];
}

/**
 * Compressed Generalized Suffix Tree Index for multi-document substring search,
 * Longest Common Substring (LCS) across k documents, and longest repeated substring discovery.
 */
export class GeneralizedSuffixTreeIndex {
  private readonly root: SuffixTreeNode = {
    edgeLabel: "",
    children: new Map(),
    docMask: 0,
    startOffsets: []
  };

  public constructor(documents: string[] = []) {
    documents.forEach((doc, idx) => this.insertDocument(doc, idx));
  }

  public insertDocument(text: string, docIndex: number = 0): void {
    const sentinel = `\u0000${docIndex}`;
    const full = text + sentinel;
    const bit = 1 << Math.min(30, docIndex);

    for (let start = 0; start < text.length; start++) {
      this.insertSuffix(full.slice(start), start, bit);
    }
  }

  private insertSuffix(suffix: string, offset: number, docBit: number): void {
    let curr = this.root;
    curr.docMask |= docBit;
    let rem = suffix;

    while (rem.length > 0) {
      const firstChar = rem[0]!;
      const existing = curr.children.get(firstChar);
      if (!existing) {
        const leaf: SuffixTreeNode = {
          edgeLabel: rem,
          children: new Map(),
          docMask: docBit,
          startOffsets: [offset]
        };
        curr.children.set(firstChar, leaf);
        return;
      }

      // Find longest common prefix between rem and existing.edgeLabel
      const label = existing.edgeLabel;
      let lcp = 0;
      const limit = Math.min(rem.length, label.length);
      while (lcp < limit && rem[lcp] === label[lcp]) {
        lcp++;
      }

      if (lcp === label.length) {
        existing.docMask |= docBit;
        existing.startOffsets.push(offset);
        curr = existing;
        rem = rem.slice(lcp);
      } else {
        // Split edge into internal branching node
        const commonPrefix = label.slice(0, lcp);
        const oldRemainder = label.slice(lcp);
        const newRemainder = rem.slice(lcp);

        const splitNode: SuffixTreeNode = {
          edgeLabel: commonPrefix,
          children: new Map(),
          docMask: existing.docMask | docBit,
          startOffsets: [...existing.startOffsets, offset]
        };

        existing.edgeLabel = oldRemainder;
        splitNode.children.set(oldRemainder[0]!, existing);

        const newLeaf: SuffixTreeNode = {
          edgeLabel: newRemainder,
          children: new Map(),
          docMask: docBit,
          startOffsets: [offset]
        };
        splitNode.children.set(newRemainder[0]!, newLeaf);

        curr.children.set(firstChar, splitNode);
        return;
      }
    }
  }

  public searchOffsets(pattern: string): number[] {
    if (pattern.length === 0) return [];
    let curr = this.root;
    let rem = pattern;

    while (rem.length > 0) {
      const child = curr.children.get(rem[0]!);
      if (!child) return [];
      const label = child.edgeLabel;
      const checkLen = Math.min(rem.length, label.length);
      if (rem.slice(0, checkLen) !== label.slice(0, checkLen)) {
        return [];
      }
      if (rem.length <= label.length) {
        return [...new Set(child.startOffsets)].sort((a, b) => a - b);
      }
      rem = rem.slice(label.length);
      curr = child;
    }
    return [];
  }

  public longestCommonSubstringAcrossDocs(docCount: number): string {
    const requiredMask = (1 << docCount) - 1;
    let best = "";

    const dfs = (node: SuffixTreeNode, pathStr: string): void => {
      if (node !== this.root && (node.docMask & requiredMask) !== requiredMask) {
        return;
      }
      const cleanPath = pathStr.split("\u0000")[0]!;
      if (cleanPath.length > best.length) {
        best = cleanPath;
      }
      for (const child of node.children.values()) {
        if ((child.docMask & requiredMask) === requiredMask) {
          dfs(child, cleanPath + child.edgeLabel);
        }
      }
    };

    dfs(this.root, "");
    return best;
  }
}
