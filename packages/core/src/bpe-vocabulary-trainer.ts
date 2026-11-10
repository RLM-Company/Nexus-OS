export interface BpeMergeRule {
  leftTokenId: number;
  rightTokenId: number;
  mergedTokenId: number;
  mergedString: string;
}

/**
 * Pure TypeScript Byte-Pair Encoding (BPE) Vocabulary Trainer & Lossless Subword Tokenizer.
 * Trains iterative pair-merge tables from domain corpora, encodes UTF-8 strings into compact
 * subword token ID sequences, and decodes back to the exact original string.
 */
export class BpeVocabularyTrainer {
  private readonly vocabIdToString = new Map<number, string>();
  private readonly mergeRules: BpeMergeRule[] = [];

  constructor() {
    // Initialize base 256 byte-level tokens (0..255)
    for (let b = 0; b < 256; b++) {
      this.vocabIdToString.set(b, String.fromCharCode(b));
    }
  }

  public train(corpusText: string, numMerges = 32): BpeMergeRule[] {
    const utf8Bytes = Buffer.from(corpusText, "utf8");
    let tokenSeq: number[] = Array.from(utf8Bytes);

    let nextTokenId = 256 + this.mergeRules.length;

    for (let m = 0; m < numMerges; m++) {
      if (tokenSeq.length < 2) break;

      const pairCounts = new Map<string, { left: number; right: number; count: number }>();
      let bestPair: { left: number; right: number; count: number } | null = null;

      for (let i = 0; i < tokenSeq.length - 1; i++) {
        const left = tokenSeq[i]!;
        const right = tokenSeq[i + 1]!;
        const key = `${left}:${right}`;
        let entry = pairCounts.get(key);
        if (!entry) {
          entry = { left, right, count: 0 };
          pairCounts.set(key, entry);
        }
        entry.count++;
        if (!bestPair || entry.count > bestPair.count) {
          bestPair = entry;
        }
      }

      if (!bestPair || bestPair.count < 2) break;

      const mergedTokenId = nextTokenId++;
      const mergedString =
        (this.vocabIdToString.get(bestPair.left) ?? "") +
        (this.vocabIdToString.get(bestPair.right) ?? "");
      this.vocabIdToString.set(mergedTokenId, mergedString);

      const rule: BpeMergeRule = {
        leftTokenId: bestPair.left,
        rightTokenId: bestPair.right,
        mergedTokenId,
        mergedString
      };
      this.mergeRules.push(rule);

      // Apply merge across tokenSeq
      const nextSeq: number[] = [];
      let idx = 0;
      while (idx < tokenSeq.length) {
        if (
          idx < tokenSeq.length - 1 &&
          tokenSeq[idx] === bestPair.left &&
          tokenSeq[idx + 1] === bestPair.right
        ) {
          nextSeq.push(mergedTokenId);
          idx += 2;
        } else {
          nextSeq.push(tokenSeq[idx]!);
          idx++;
        }
      }
      tokenSeq = nextSeq;
    }

    return [...this.mergeRules];
  }

  public encode(text: string): number[] {
    let seq: number[] = Array.from(Buffer.from(text, "utf8"));
    for (const rule of this.mergeRules) {
      const nextSeq: number[] = [];
      let i = 0;
      while (i < seq.length) {
        if (
          i < seq.length - 1 &&
          seq[i] === rule.leftTokenId &&
          seq[i + 1] === rule.rightTokenId
        ) {
          nextSeq.push(rule.mergedTokenId);
          i += 2;
        } else {
          nextSeq.push(seq[i]!);
          i++;
        }
      }
      seq = nextSeq;
    }
    return seq;
  }

  public decode(tokenIds: number[]): string {
    const byteValues: number[] = [];
    for (const id of tokenIds) {
      const str = this.vocabIdToString.get(id);
      if (!str) {
        throw new Error(`UNKNOWN_BPE_TOKEN_ID: ${id}`);
      }
      for (let i = 0; i < str.length; i++) {
        byteValues.push(str.charCodeAt(i) & 0xff);
      }
    }
    return Buffer.from(byteValues).toString("utf8");
  }

  public get vocabularySize(): number {
    return this.vocabIdToString.size;
  }
}
