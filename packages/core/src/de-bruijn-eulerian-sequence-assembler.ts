/**
 * Nicolaas de Bruijn Cyclic Sequence Generator B(k, n) & Eulerian k-mer Contig Assembler.
 * - Generates the lexicographically smallest de Bruijn cycle B(k, n) of length k^n via
 *   Martin's / Lyndon word concatenation so every k-ary word of length n appears as a cyclic
 *   substring exactly once.
 * - Assembles overlapping k-mer reads into a contiguous sequence by constructing the
 *   directed (k-1)-mer de Bruijn graph and traversing its Hierholzer Eulerian path.
 */
export class DeBruijnEulerianSequenceAssembler {
  public static generateDeBruijnSequence(alphabet: string, orderN: number): string {
    const k = alphabet.length;
    if (k === 0 || orderN <= 0) return "";
    const a = new Array<number>(k * orderN).fill(0);
    const sequenceIndices: number[] = [];

    const db = (t: number, p: number): void => {
      if (t > orderN) {
        if (orderN % p === 0) {
          for (let i = 1; i <= p; i++) {
            sequenceIndices.push(a[i]!);
          }
        }
      } else {
        a[t] = a[t - p]!;
        db(t + 1, p);
        for (let j = a[t - p]! + 1; j < k; j++) {
          a[t] = j;
          db(t + 1, t);
        }
      }
    };

    db(1, 1);
    return sequenceIndices.map((idx) => alphabet[idx]!).join("");
  }

  public static assembleKmersEulerian(kmers: string[]): string {
    if (kmers.length === 0) return "";
    const k = kmers[0]!.length;
    if (k <= 1) return kmers.join("");

    const adj = new Map<string, string[]>();
    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    const nodes = new Set<string>();

    for (const kmer of kmers) {
      const u = kmer.slice(0, k - 1);
      const v = kmer.slice(1);
      nodes.add(u);
      nodes.add(v);
      const list = adj.get(u) ?? [];
      list.push(v);
      adj.set(u, list);
      outDeg.set(u, (outDeg.get(u) ?? 0) + 1);
      inDeg.set(v, (inDeg.get(v) ?? 0) + 1);
    }

    for (const list of adj.values()) {
      list.sort().reverse(); // pop() visits lexicographically smallest first
    }

    // Find Eulerian path start node (outDeg - inDeg == 1)
    let startNode = kmers[0]!.slice(0, k - 1);
    for (const n of [...nodes].sort()) {
      const outD = outDeg.get(n) ?? 0;
      const inD = inDeg.get(n) ?? 0;
      if (outD - inD === 1) {
        startNode = n;
        break;
      }
    }

    const stack = [startNode];
    const path: string[] = [];
    while (stack.length > 0) {
      const u = stack[stack.length - 1]!;
      const neighbors = adj.get(u);
      if (neighbors && neighbors.length > 0) {
        stack.push(neighbors.pop()!);
      } else {
        path.push(stack.pop()!);
      }
    }
    path.reverse();

    if (path.length === 0) return "";
    let assembled = path[0]!;
    for (let i = 1; i < path.length; i++) {
      assembled += path[i]!.slice(-1);
    }
    return assembled;
  }
}
