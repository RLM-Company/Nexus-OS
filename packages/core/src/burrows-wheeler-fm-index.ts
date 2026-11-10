export interface BwtMtfEncodedBundle {
  bwtLastColumn: string;
  primaryRowIndex: number;
  mtfCodes: number[];
  alphabet: string[];
}

/**
 * Lossless Burrows-Wheeler Transform (BWT) Block-Sorting Reversible Transform +
 * Move-To-Front (MTF) Entropy Pre-Coder + LF-Mapping Inverse Reconstruction.
 */
export class BurrowsWheelerTransformCodec {
  public static encodeBwtAndMtf(input: string): BwtMtfEncodedBundle {
    const text = `${input}\u0000`;
    const n = text.length;

    const rotations = Array.from({ length: n }, (_, idx) => ({
      idx,
      rotated: text.slice(idx) + text.slice(0, idx)
    }));

    rotations.sort((a, b) => (a.rotated < b.rotated ? -1 : a.rotated > b.rotated ? 1 : 0));

    let primaryRowIndex = 0;
    const lastColChars: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = rotations[i]!;
      if (r.idx === 0) primaryRowIndex = i;
      lastColChars.push(r.rotated[n - 1]!);
    }

    const bwtLastColumn = lastColChars.join("");

    // Move-To-Front (MTF) encoding
    const alphabet = Array.from(new Set(lastColChars)).sort();
    const mtfList = [...alphabet];
    const mtfCodes: number[] = [];

    for (const ch of lastColChars) {
      const pos = mtfList.indexOf(ch);
      mtfCodes.push(pos);
      if (pos > 0) {
        mtfList.splice(pos, 1);
        mtfList.unshift(ch);
      }
    }

    return {
      bwtLastColumn,
      primaryRowIndex,
      mtfCodes,
      alphabet
    };
  }

  public static decodeBwtAndMtf(bundle: BwtMtfEncodedBundle): string {
    // 1. Inverse Move-To-Front
    const mtfList = [...bundle.alphabet];
    const lastCol: string[] = [];
    for (const code of bundle.mtfCodes) {
      const ch = mtfList[code]!;
      lastCol.push(ch);
      if (code > 0) {
        mtfList.splice(code, 1);
        mtfList.unshift(ch);
      }
    }

    // 2. Inverse BWT via LF-Mapping (Last-to-First rank mapping)
    const n = lastCol.length;
    const tuples = lastCol.map((ch, originalRow) => ({ ch, originalRow }));
    tuples.sort((a, b) =>
      a.ch < b.ch ? -1 : a.ch > b.ch ? 1 : a.originalRow - b.originalRow
    );

    const outChars: string[] = [];
    let row = bundle.primaryRowIndex;
    for (let i = 0; i < n; i++) {
      const t = tuples[row]!;
      outChars.push(t.ch);
      row = t.originalRow;
    }

    const full = outChars.join("");
    return full.endsWith("\u0000") ? full.slice(0, -1) : full;
  }
}
