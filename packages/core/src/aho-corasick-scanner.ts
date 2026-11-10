export interface AhoCorasickPattern {
  id: string;
  keyword: string;
  category?: string;
}

export interface AhoCorasickMatch {
  patternId: string;
  keyword: string;
  category?: string;
  startIndex: number;
  endIndex: number;
}

interface TrieNode {
  children: Map<string, number>;
  failLink: number;
  outputs: AhoCorasickPattern[];
}

/**
 * Aho-Corasick Multi-Pattern Finite Automaton with BFS Suffix/Failure Links.
 * Scans arbitrary text for thousands of keywords simultaneously in a single linear pass O(N + M + Z).
 */
export class AhoCorasickAutomaton {
  private readonly nodes: TrieNode[] = [
    { children: new Map(), failLink: 0, outputs: [] }
  ];
  private compiled = false;

  public constructor(patterns?: AhoCorasickPattern[]) {
    if (patterns) {
      for (const p of patterns) {
        this.addPattern(p);
      }
      this.compileFailureLinks();
    }
  }

  public addPattern(pattern: AhoCorasickPattern): void {
    const kw = pattern.keyword.toLowerCase();
    if (!kw) return;
    this.compiled = false;

    let cur = 0;
    for (let i = 0; i < kw.length; i++) {
      const ch = kw[i]!;
      let next = this.nodes[cur]!.children.get(ch);
      if (next === undefined) {
        next = this.nodes.length;
        this.nodes.push({ children: new Map(), failLink: 0, outputs: [] });
        this.nodes[cur]!.children.set(ch, next);
      }
      cur = next;
    }
    this.nodes[cur]!.outputs.push(pattern);
  }

  public compileFailureLinks(): void {
    const queue: number[] = [];

    // Depth-1 children fail to root (0)
    for (const childIdx of this.nodes[0]!.children.values()) {
      this.nodes[childIdx]!.failLink = 0;
      queue.push(childIdx);
    }

    while (queue.length > 0) {
      const u = queue.shift()!;
      const uNode = this.nodes[u]!;

      for (const [ch, v] of uNode.children.entries()) {
        queue.push(v);
        let f = uNode.failLink;
        while (f !== 0 && !this.nodes[f]!.children.has(ch)) {
          f = this.nodes[f]!.failLink;
        }
        const failTarget = this.nodes[f]!.children.get(ch) ?? 0;
        this.nodes[v]!.failLink = failTarget === v ? 0 : failTarget;

        // Inherit output matches from suffix failure target
        const failOutputs = this.nodes[this.nodes[v]!.failLink]!.outputs;
        if (failOutputs.length > 0) {
          this.nodes[v]!.outputs = [...this.nodes[v]!.outputs, ...failOutputs];
        }
      }
    }

    this.compiled = true;
  }

  public scan(text: string): AhoCorasickMatch[] {
    if (!this.compiled) {
      this.compileFailureLinks();
    }

    const lower = text.toLowerCase();
    const matches: AhoCorasickMatch[] = [];
    let state = 0;

    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i]!;
      while (state !== 0 && !this.nodes[state]!.children.has(ch)) {
        state = this.nodes[state]!.failLink;
      }
      state = this.nodes[state]!.children.get(ch) ?? 0;

      const outs = this.nodes[state]!.outputs;
      for (const pat of outs) {
        matches.push({
          patternId: pat.id,
          keyword: pat.keyword,
          category: pat.category,
          startIndex: i - pat.keyword.length + 1,
          endIndex: i + 1
        });
      }
    }

    return matches;
  }
}
