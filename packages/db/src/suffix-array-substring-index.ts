import { DatabaseSync } from "node:sqlite";

export interface SubstringMatchLocation {
  offset: number;
  line: number;
  column: number;
  contextSnippet: string;
}

export interface LongestRepeatedClone {
  substring: string;
  length: number;
  firstOffset: number;
  secondOffset: number;
}

/**
 * Suffix Array (SA) & Kasai's Longest Common Prefix (LCP) Array Substring & Clone Index.
 * Enables O(P log N) exact arbitrary substring search (including mid-token code/log fragments)
 * and O(N) duplicate code clone detection via the LCP array, with SQLite snapshot persistence.
 */
export class SuffixArraySubstringIndex {
  public readonly corpusId: string;
  public readonly text: string;
  public readonly suffixArray: Int32Array;
  public readonly lcpArray: Int32Array;
  private readonly lineStarts: number[];

  constructor(
    corpusId: string,
    text: string,
    precomputed?: { suffixArray: Int32Array; lcpArray: Int32Array }
  ) {
    this.corpusId = corpusId;
    this.text = text;
    this.lineStarts = SuffixArraySubstringIndex.computeLineStarts(text);

    if (precomputed) {
      this.suffixArray = precomputed.suffixArray;
      this.lcpArray = precomputed.lcpArray;
    } else {
      this.suffixArray = SuffixArraySubstringIndex.buildSuffixArray(text);
      this.lcpArray = SuffixArraySubstringIndex.buildKasaiLcpArray(text, this.suffixArray);
    }
  }

  private static computeLineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") {
        starts.push(i + 1);
      }
    }
    return starts;
  }

  private offsetToLineCol(offset: number): { line: number; column: number } {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.lineStarts[mid]! <= offset) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIdx = Math.max(0, high);
    return {
      line: lineIdx + 1,
      column: offset - this.lineStarts[lineIdx]! + 1
    };
  }

  public static buildSuffixArray(text: string): Int32Array {
    const n = text.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((a, b) => {
      const maxLen = Math.min(n - a, n - b, 128);
      for (let k = 0; k < maxLen; k++) {
        const diff = text.charCodeAt(a + k) - text.charCodeAt(b + k);
        if (diff !== 0) return diff;
      }
      return (n - a) - (n - b);
    });
    return new Int32Array(indices);
  }

  /**
   * Kasai's O(N) algorithm to construct the Longest Common Prefix (LCP) array
   * between adjacent suffixes in the sorted Suffix Array.
   */
  public static buildKasaiLcpArray(text: string, sa: Int32Array): Int32Array {
    const n = sa.length;
    const lcp = new Int32Array(n);
    if (n === 0) return lcp;

    const rank = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      rank[sa[i]!] = i;
    }

    let h = 0;
    for (let i = 0; i < n; i++) {
      const r = rank[i]!;
      if (r > 0) {
        const j = sa[r - 1]!;
        while (i + h < n && j + h < n && text.charCodeAt(i + h) === text.charCodeAt(j + h)) {
          h++;
        }
        lcp[r] = h;
        if (h > 0) h--;
      }
    }
    return lcp;
  }

  private comparePatternAt(suffixOffset: number, pattern: string): number {
    const n = this.text.length;
    const m = pattern.length;
    for (let k = 0; k < m; k++) {
      if (suffixOffset + k >= n) return -1; // suffix is shorter than pattern
      const diff = this.text.charCodeAt(suffixOffset + k) - pattern.charCodeAt(k);
      if (diff !== 0) return diff;
    }
    return 0; // suffix starts with pattern
  }

  /**
   * Binary searches the Suffix Array in O(P log N) time to find all occurrences of `pattern`.
   */
  public searchSubstring(pattern: string): SubstringMatchLocation[] {
    if (!pattern || this.suffixArray.length === 0) return [];

    const n = this.suffixArray.length;
    // Lower bound binary search
    let low = 0;
    let high = n - 1;
    let firstMatch = -1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const cmp = this.comparePatternAt(this.suffixArray[mid]!, pattern);
      if (cmp >= 0) {
        if (cmp === 0) firstMatch = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    if (firstMatch === -1) return [];

    // Upper bound binary search
    low = firstMatch;
    high = n - 1;
    let lastMatch = firstMatch;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const cmp = this.comparePatternAt(this.suffixArray[mid]!, pattern);
      if (cmp <= 0) {
        if (cmp === 0) lastMatch = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const offsets: number[] = [];
    for (let idx = firstMatch; idx <= lastMatch; idx++) {
      offsets.push(this.suffixArray[idx]!);
    }
    offsets.sort((a, b) => a - b);

    return offsets.map((offset) => {
      const { line, column } = this.offsetToLineCol(offset);
      const startCtx = Math.max(0, offset - 12);
      const endCtx = Math.min(this.text.length, offset + pattern.length + 12);
      return {
        offset,
        line,
        column,
        contextSnippet: this.text.slice(startCtx, endCtx)
      };
    });
  }

  /**
   * Finds the longest repeated substring (code clone or duplicate log block) in O(N) via the LCP array.
   */
  public findLongestRepeatedClone(minLength = 4): LongestRepeatedClone | null {
    let maxLen = 0;
    let bestRank = -1;

    for (let i = 1; i < this.lcpArray.length; i++) {
      if (this.lcpArray[i]! > maxLen) {
        maxLen = this.lcpArray[i]!;
        bestRank = i;
      }
    }

    if (bestRank === -1 || maxLen < minLength) return null;

    const offsetA = this.suffixArray[bestRank - 1]!;
    const offsetB = this.suffixArray[bestRank]!;
    const firstOffset = Math.min(offsetA, offsetB);
    const secondOffset = Math.max(offsetA, offsetB);

    return {
      substring: this.text.slice(firstOffset, firstOffset + maxLen),
      length: maxLen,
      firstOffset,
      secondOffset
    };
  }

  public saveToSqlite(sqlite: DatabaseSync, ownerId: string): string {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_suffix_array_snapshots (
        snapshot_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        corpus_id TEXT NOT NULL,
        corpus_text TEXT NOT NULL,
        suffix_array_json TEXT NOT NULL,
        lcp_array_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, corpus_id)
      );
    `);

    const snapshotId = `sa_${ownerId}_${this.corpusId}`;
    sqlite
      .prepare(
        `INSERT INTO kosmora_suffix_array_snapshots
          (snapshot_id, owner_id, corpus_id, corpus_text, suffix_array_json, lcp_array_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, corpus_id) DO UPDATE SET
          corpus_text = excluded.corpus_text,
          suffix_array_json = excluded.suffix_array_json,
          lcp_array_json = excluded.lcp_array_json,
          updated_at = excluded.updated_at`
      )
      .run(
        snapshotId,
        ownerId,
        this.corpusId,
        this.text,
        JSON.stringify(Array.from(this.suffixArray)),
        JSON.stringify(Array.from(this.lcpArray)),
        new Date().toISOString()
      );

    return snapshotId;
  }

  public static loadFromSqlite(
    sqlite: DatabaseSync,
    ownerId: string,
    corpusId: string
  ): SuffixArraySubstringIndex | null {
    const row = sqlite
      .prepare(
        `SELECT corpus_text, suffix_array_json, lcp_array_json
         FROM kosmora_suffix_array_snapshots
         WHERE owner_id = ? AND corpus_id = ?`
      )
      .get(ownerId, corpusId) as
      | { corpus_text: string; suffix_array_json: string; lcp_array_json: string }
      | undefined;

    if (!row) return null;

    return new SuffixArraySubstringIndex(row.corpus_text ? corpusId : corpusId, row.corpus_text, {
      suffixArray: new Int32Array(JSON.parse(row.suffix_array_json)),
      lcpArray: new Int32Array(JSON.parse(row.lcp_array_json))
    });
  }
}
