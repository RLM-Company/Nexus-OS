interface SamState {
  len: number;
  link: number;
  next: Map<string, number>;
}

/**
 * Linear-Time O(N) Suffix Automaton (SAM / Minimal Deterministic Acyclic Word Graph).
 * Supports O(|P|) substring existence checks, exact distinct substring counting via
 * sum(len(u) - len(link(u))), and O(|S1| + |S2|) Longest Common Substring (LCS) extraction.
 */
export class SuffixAutomatonDirectedWordGraph {
  private readonly states: SamState[] = [{ len: 0, link: -1, next: new Map() }];
  private lastState = 0;

  constructor(text?: string) {
    if (text) {
      for (const ch of text) {
        this.extendChar(ch);
      }
    }
  }

  public extendChar(c: string): void {
    const cur = this.states.length;
    this.states.push({
      len: this.states[this.lastState]!.len + 1,
      link: 0,
      next: new Map()
    });

    let p = this.lastState;
    while (p !== -1 && !this.states[p]!.next.has(c)) {
      this.states[p]!.next.set(c, cur);
      p = this.states[p]!.link;
    }

    if (p === -1) {
      this.states[cur]!.link = 0;
    } else {
      const q = this.states[p]!.next.get(c)!;
      if (this.states[p]!.len + 1 === this.states[q]!.len) {
        this.states[cur]!.link = q;
      } else {
        const clone = this.states.length;
        this.states.push({
          len: this.states[p]!.len + 1,
          link: this.states[q]!.link,
          next: new Map(this.states[q]!.next)
        });
        while (p !== -1 && this.states[p]!.next.get(c) === q) {
          this.states[p]!.next.set(c, clone);
          p = this.states[p]!.link;
        }
        this.states[q]!.link = clone;
        this.states[cur]!.link = clone;
      }
    }

    this.lastState = cur;
  }

  public containsSubstring(pattern: string): boolean {
    let curr = 0;
    for (const ch of pattern) {
      const next = this.states[curr]!.next.get(ch);
      if (next === undefined) return false;
      curr = next;
    }
    return true;
  }

  /**
   * Computes the exact count of distinct non-empty substrings in O(|states|) using
   * sum_{u > 0} (len(u) - len(link(u))).
   */
  public countDistinctSubstrings(): number {
    let total = 0;
    for (let i = 1; i < this.states.length; i++) {
      const st = this.states[i]!;
      const linkSt = this.states[st.link]!;
      total += st.len - linkSt.len;
    }
    return total;
  }

  public findLongestCommonSubstring(otherText: string): string {
    let v = 0;
    let l = 0;
    let bestLen = 0;
    let bestEndPos = 0;

    for (let i = 0; i < otherText.length; i++) {
      const ch = otherText[i]!;
      while (v !== 0 && !this.states[v]!.next.has(ch)) {
        v = this.states[v]!.link;
        l = this.states[v]!.len;
      }
      if (this.states[v]!.next.has(ch)) {
        v = this.states[v]!.next.get(ch)!;
        l++;
      }
      if (l > bestLen) {
        bestLen = l;
        bestEndPos = i;
      }
    }

    if (bestLen === 0) return "";
    return otherText.slice(bestEndPos - bestLen + 1, bestEndPos + 1);
  }
}
