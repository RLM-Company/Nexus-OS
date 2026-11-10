export interface DiffEditOp {
  type: "equal" | "insert" | "delete";
  value: string;
}

export interface MyersDiffResult {
  editDistance: number;
  operations: DiffEditOp[];
  unifiedDiffText: string;
}

/**
 * Pure TypeScript Myers / LCS Minimal Edit Script & Unified Diff Engine.
 * Computes the minimal sequence of line/token insertions and deletions between two sequences.
 */
export class MyersDiffEngine {
  public static diffLines(oldText: string, newText: string, fileLabel = "file.txt"): MyersDiffResult {
    const oldLines = oldText.length === 0 ? [] : oldText.split("\n");
    const newLines = newText.length === 0 ? [] : newText.split("\n");
    return MyersDiffEngine.diffSequences(oldLines, newLines, fileLabel);
  }

  public static diffSequences(
    seqA: string[],
    seqB: string[],
    fileLabel = "file.txt"
  ): MyersDiffResult {
    const n = seqA.length;
    const m = seqB.length;

    // DP matrix for exact LCS to guarantee minimal edit script (N + M - 2 * LCS)
    const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        if (seqA[i] === seqB[j]) {
          dp[i]![j] = 1 + dp[i + 1]![j + 1]!;
        } else {
          dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
        }
      }
    }

    const operations: DiffEditOp[] = [];
    let i = 0;
    let j = 0;
    let editDistance = 0;

    while (i < n && j < m) {
      if (seqA[i] === seqB[j]) {
        operations.push({ type: "equal", value: seqA[i]! });
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        operations.push({ type: "delete", value: seqA[i]! });
        editDistance++;
        i++;
      } else {
        operations.push({ type: "insert", value: seqB[j]! });
        editDistance++;
        j++;
      }
    }

    while (i < n) {
      operations.push({ type: "delete", value: seqA[i++]! });
      editDistance++;
    }
    while (j < m) {
      operations.push({ type: "insert", value: seqB[j++]! });
      editDistance++;
    }

    const bodyLines = operations.map((op) => {
      if (op.type === "equal") return ` ${op.value}`;
      if (op.type === "delete") return `-${op.value}`;
      return `+${op.value}`;
    });

    const unifiedDiffText = [
      `--- a/${fileLabel}`,
      `+++ b/${fileLabel}`,
      `@@ -1,${n} +1,${m} @@`,
      ...bodyLines
    ].join("\n");

    return {
      editDistance,
      operations,
      unifiedDiffText
    };
  }
}
