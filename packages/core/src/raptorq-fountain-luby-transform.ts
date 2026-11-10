export interface LtEncodedDroplet {
  dropletId: number;
  sourceBlockIndices: number[];
  xorPayload: Uint8Array;
}

/**
 * Luby Transform (LT) Rateless Fountain Codec with Belief-Propagation Peeling Decoder.
 * Generates an arbitrary stream of XOR-combined droplets and reconstructs all K source blocks
 * iteratively by peeling degree-1 ripple droplets without requiring finite-field matrix inversion.
 */
export class LubyTransformFountainCodec {
  public static encodeDroplets(
    sourceBlocks: Uint8Array[],
    dropletSpecs: Array<{ dropletId: number; sourceBlockIndices: number[] }>
  ): LtEncodedDropletsBundle {
    if (sourceBlocks.length === 0) {
      throw new Error("EMPTY_FOUNTAIN_SOURCE_BLOCKS");
    }
    const blockByteLength = sourceBlocks[0]!.length;
    const droplets: LtEncodedDroplet[] = [];

    for (const spec of dropletSpecs) {
      const xorPayload = new Uint8Array(blockByteLength);
      for (const idx of spec.sourceBlockIndices) {
        const blk = sourceBlocks[idx]!;
        for (let b = 0; b < blockByteLength; b++) {
          xorPayload[b] ^= blk[b]!;
        }
      }
      droplets.push({
        dropletId: spec.dropletId,
        sourceBlockIndices: [...spec.sourceBlockIndices],
        xorPayload
      });
    }

    return {
      sourceBlockCountK: sourceBlocks.length,
      blockByteLength,
      droplets
    };
  }

  public static peelDecode(params: {
    sourceBlockCountK: number;
    blockByteLength: number;
    droplets: LtEncodedDroplet[];
  }): {
    decodedAll: boolean;
    recoveredBlocks: Array<Uint8Array | null>;
    peelingStepsExecuted: number;
  } {
    const k = params.sourceBlockCountK;
    const recovered: Array<Uint8Array | null> = new Array(k).fill(null);
    let recoveredCount = 0;
    let peelingStepsExecuted = 0;

    // Clone droplets so we can mutate their remaining degree sets and XOR payloads
    const activeDroplets = params.droplets.map((d) => ({
      dropletId: d.dropletId,
      neighborSet: new Set<number>(d.sourceBlockIndices),
      payload: new Uint8Array(d.xorPayload)
    }));

    let progress = true;
    while (progress && recoveredCount < k) {
      progress = false;

      // Find any droplet in the ripple (degree == 1)
      for (const drop of activeDroplets) {
        if (drop.neighborSet.size === 1) {
          const solvedIdx = Array.from(drop.neighborSet)[0]!;
          drop.neighborSet.clear();

          if (recovered[solvedIdx] === null) {
            const solvedData = new Uint8Array(drop.payload);
            recovered[solvedIdx] = solvedData;
            recoveredCount++;
            peelingStepsExecuted++;
            progress = true;

            // Peel solvedIdx out of all other droplets that reference it
            for (const other of activeDroplets) {
              if (other.neighborSet.has(solvedIdx)) {
                other.neighborSet.delete(solvedIdx);
                for (let b = 0; b < params.blockByteLength; b++) {
                  other.payload[b] ^= solvedData[b]!;
                }
              }
            }
          }
        }
      }
    }

    return {
      decodedAll: recoveredCount === k,
      recoveredBlocks: recovered,
      peelingStepsExecuted
    };
  }
}

export interface LtEncodedDropletsBundle {
  sourceBlockCountK: number;
  blockByteLength: number;
  droplets: LtEncodedDroplet[];
}
