export interface KnuthPlassLayoutResult {
  optimalLines: string[];
  greedyLines: string[];
  optimalBadnessScore: number;
  greedyBadnessScore: number;
}

/**
 * Donald Knuth & Michael Plass O(N^2) Dynamic Programming Paragraph Line-Breaking Optimizer.
 * Minimizes the sum of cubic slackness badness (lineWidth - occupiedWidth)^3 across all
 * non-final lines, avoiding ugly loose lines that greedy first-fit wrapping produces.
 */
export class KnuthPlassOptimalLineBreaker {
  public static computeLineBadness(lineText: string, maxWidth: number, isLastLine: boolean): number {
    if (lineText.length > maxWidth) return Infinity;
    if (isLastLine) return 0;
    const slack = maxWidth - lineText.length;
    return slack * slack * slack;
  }

  public static breakParagraph(text: string, maxWidth: number): KnuthPlassLayoutResult {
    const words = text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const n = words.length;
    if (n === 0) {
      return {
        optimalLines: [],
        greedyLines: [],
        optimalBadnessScore: 0,
        greedyBadnessScore: 0
      };
    }

    // 1. Greedy line breaking
    const greedyLines: string[] = [];
    let current = words[0]!;
    for (let i = 1; i < n; i++) {
      const w = words[i]!;
      if (current.length + 1 + w.length <= maxWidth) {
        current += " " + w;
      } else {
        greedyLines.push(current);
        current = w;
      }
    }
    greedyLines.push(current);

    let greedyBadness = 0;
    for (let i = 0; i < greedyLines.length; i++) {
      greedyBadness += KnuthPlassOptimalLineBreaker.computeLineBadness(
        greedyLines[i]!,
        maxWidth,
        i === greedyLines.length - 1
      );
    }

    // 2. Knuth-Plass DP: dp[i] = min badness to format words[i .. n-1]
    const dp = new Array<number>(n + 1).fill(Infinity);
    const nextBreak = new Array<number>(n).fill(n);
    dp[n] = 0;

    for (let i = n - 1; i >= 0; i--) {
      let lineLen = 0;
      for (let j = i; j < n; j++) {
        lineLen += (j === i ? 0 : 1) + words[j]!.length;
        if (lineLen > maxWidth) {
          if (j === i) {
            // Single word exceeds maxWidth: allow it on its own line
            dp[i] = dp[j + 1]!;
            nextBreak[i] = j + 1;
          }
          break;
        }
        const isLast = j === n - 1;
        const slack = maxWidth - lineLen;
        const cost = isLast ? 0 : slack * slack * slack;
        const total = cost + dp[j + 1]!;
        if (total < dp[i]!) {
          dp[i] = total;
          nextBreak[i] = j + 1;
        }
      }
    }

    const optimalLines: string[] = [];
    let idx = 0;
    while (idx < n) {
      const end = nextBreak[idx]!;
      optimalLines.push(words.slice(idx, end).join(" "));
      idx = end;
    }

    return {
      optimalLines,
      greedyLines,
      optimalBadnessScore: dp[0]!,
      greedyBadnessScore: greedyBadness
    };
  }
}
