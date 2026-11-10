interface HuffmanNode {
  symbol?: string;
  freq: number;
  left?: HuffmanNode;
  right?: HuffmanNode;
}

export interface HuffmanEncodedBundle {
  codeTable: Record<string, string>; // symbol -> bitstring ("010")
  encodedBitString: string;
  shannonEntropyBitsPerSymbol: number;
  averageCodeLengthBits: number;
}

/**
 * Optimal Prefix-Free Huffman Entropy Codec & Empirical Shannon Entropy Analyzer.
 * Computes exact Shannon entropy H(X) = -sum(p_i * log2(p_i)), builds the optimal binary
 * Huffman tree, and performs lossless bitstring encoding and decoding.
 */
export class CanonicalHuffmanEntropyCodec {
  public static encode(input: string): HuffmanEncodedBundle {
    if (input.length === 0) {
      return {
        codeTable: {},
        encodedBitString: "",
        shannonEntropyBitsPerSymbol: 0,
        averageCodeLengthBits: 0
      };
    }

    const freqMap = new Map<string, number>();
    for (const ch of input) {
      freqMap.set(ch, (freqMap.get(ch) ?? 0) + 1);
    }

    const n = input.length;
    let shannonEntropy = 0;
    for (const count of freqMap.values()) {
      const p = count / n;
      shannonEntropy -= p * Math.log2(p);
    }

    if (freqMap.size === 1) {
      const onlyChar = Array.from(freqMap.keys())[0]!;
      return {
        codeTable: { [onlyChar]: "0" },
        encodedBitString: "0".repeat(n),
        shannonEntropyBitsPerSymbol: 0,
        averageCodeLengthBits: 1
      };
    }

    const pq: HuffmanNode[] = Array.from(freqMap.entries()).map(([symbol, freq]) => ({
      symbol,
      freq
    }));

    while (pq.length > 1) {
      pq.sort((a, b) => a.freq - b.freq || (a.symbol ?? "").localeCompare(b.symbol ?? ""));
      const left = pq.shift()!;
      const right = pq.shift()!;
      pq.push({
        freq: left.freq + right.freq,
        left,
        right
      });
    }

    const root = pq[0]!;
    const codeTable: Record<string, string> = {};

    const buildCodes = (node: HuffmanNode, prefix: string) => {
      if (node.symbol !== undefined) {
        codeTable[node.symbol] = prefix || "0";
        return;
      }
      if (node.left) buildCodes(node.left, `${prefix}0`);
      if (node.right) buildCodes(node.right, `${prefix}1`);
    };
    buildCodes(root, "");

    let encodedBitString = "";
    for (const ch of input) {
      encodedBitString += codeTable[ch]!;
    }

    return {
      codeTable,
      encodedBitString,
      shannonEntropyBitsPerSymbol: Number(shannonEntropy.toFixed(6)),
      averageCodeLengthBits: Number((encodedBitString.length / n).toFixed(6))
    };
  }

  public static decode(bundle: HuffmanEncodedBundle): string {
    const revMap = new Map<string, string>();
    for (const [sym, code] of Object.entries(bundle.codeTable)) {
      revMap.set(code, sym);
    }

    let cur = "";
    const out: string[] = [];
    for (const bit of bundle.encodedBitString) {
      cur += bit;
      const sym = revMap.get(cur);
      if (sym !== undefined) {
        out.push(sym);
        cur = "";
      }
    }
    return out.join("");
  }
}
