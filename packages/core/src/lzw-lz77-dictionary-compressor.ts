/**
 * Lempel-Ziv-Welch (LZW) Adaptive Dictionary Lossless Compressor & Decompressor.
 * Dynamically builds multi-character phrase codes on the fly starting from base 256 ASCII/UTF-16 symbols
 * without transmitting the dictionary table.
 */
export class LempelZivWelchDictionaryCodec {
  public static compress(input: string): number[] {
    if (input.length === 0) return [];

    const dict = new Map<string, number>();
    for (let i = 0; i < 256; i++) {
      dict.set(String.fromCharCode(i), i);
    }

    let nextCode = 256;
    let w = "";
    const result: number[] = [];

    for (let i = 0; i < input.length; i++) {
      const c = input[i]!;
      if (!dict.has(c)) {
        dict.set(c, c.charCodeAt(0));
      }
      const wc = w + c;
      if (dict.has(wc)) {
        w = wc;
      } else {
        result.push(dict.get(w)!);
        dict.set(wc, nextCode++);
        w = c;
      }
    }

    if (w !== "") {
      result.push(dict.get(w)!);
    }
    return result;
  }

  public static decompress(codes: number[]): string {
    if (codes.length === 0) return "";

    const dict = new Map<number, string>();
    for (let i = 0; i < 256; i++) {
      dict.set(i, String.fromCharCode(i));
    }

    let nextCode = 256;
    let w = dict.get(codes[0]!) ?? String.fromCharCode(codes[0]!);
    const result: string[] = [w];

    for (let i = 1; i < codes.length; i++) {
      const k = codes[i]!;
      let entry: string;
      if (dict.has(k)) {
        entry = dict.get(k)!;
      } else if (k === nextCode) {
        // Special LZW cScSc case where phrase is used immediately after creation
        entry = w + w[0]!;
      } else {
        entry = String.fromCharCode(k);
      }

      result.push(entry);
      dict.set(nextCode++, w + entry[0]!);
      w = entry;
    }

    return result.join("");
  }
}
