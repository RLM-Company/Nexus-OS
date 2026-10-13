export interface DiffLine {
  type: "equal" | "add" | "remove";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffStats {
  additions: number;
  deletions: number;
  unchanged: number;
  lines: DiffLine[];
}

/**
 * Pure local LCS-based line diff algorithm (0 external API calls).
 */
export function computeLineDiff(oldText: string, newText: string): DiffStats {
  const oldLines = oldText.replace(/\r\n/g, "\n").split("\n");
  const newLines = newText.replace(/\r\n/g, "\n").split("\n");

  const n = oldLines.length;
  const m = newLines.length;

  // Guard for very large files: fallback to simple prefix/suffix + changed block
  if (n * m > 2_500_000) {
    const lines: DiffLine[] = [];
    let additions = 0;
    let deletions = 0;
    let unchanged = 0;
    const maxLen = Math.max(n, m);
    for (let i = 0; i < maxLen; i++) {
      const o = oldLines[i];
      const nw = newLines[i];
      if (o === nw && o !== undefined) {
        lines.push({ type: "equal", content: o, oldLineNumber: i + 1, newLineNumber: i + 1 });
        unchanged++;
      } else {
        if (o !== undefined) {
          lines.push({ type: "remove", content: o, oldLineNumber: i + 1 });
          deletions++;
        }
        if (nw !== undefined) {
          lines.push({ type: "add", content: nw, newLineNumber: i + 1 });
          additions++;
        }
      }
    }
    return { additions, deletions, unchanged, lines };
  }

  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i]![j] = (dp[i + 1]?.[j + 1] ?? 0) + 1;
      } else {
        const down = dp[i + 1]?.[j] ?? 0;
        const right = dp[i]?.[j + 1] ?? 0;
        dp[i]![j] = down >= right ? down : right;
      }
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let additions = 0;
  let deletions = 0;
  let unchanged = 0;

  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      lines.push({
        type: "equal",
        content: oldLines[i]!,
        oldLineNumber: i + 1,
        newLineNumber: j + 1
      });
      unchanged++;
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      lines.push({
        type: "remove",
        content: oldLines[i]!,
        oldLineNumber: i + 1
      });
      deletions++;
      i++;
    } else {
      lines.push({
        type: "add",
        content: newLines[j]!,
        newLineNumber: j + 1
      });
      additions++;
      j++;
    }
  }

  while (i < n) {
    lines.push({
      type: "remove",
      content: oldLines[i]!,
      oldLineNumber: i + 1
    });
    deletions++;
    i++;
  }

  while (j < m) {
    lines.push({
      type: "add",
      content: newLines[j]!,
      newLineNumber: j + 1
    });
    additions++;
    j++;
  }

  return { additions, deletions, unchanged, lines };
}

export interface ExtractedEntities {
  urls: string[];
  emails: string[];
  ips: string[];
  dates: string[];
  codeBlocksCount: number;
}

/**
 * Deterministic regex entity extractor from raw text or logs (0 API calls).
 */
export function extractEntitiesLocal(text: string): ExtractedEntities {
  const urlRegex = /https?:\/\/[^\s"'<>)\]]+/gi;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const ipRegex = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
  const dateRegex = /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?\b/g;
  const codeBlockRegex = /```[\s\S]*?```/g;

  const unique = (arr: RegExpMatchArray | null): string[] =>
    arr ? Array.from(new Set(arr)) : [];

  return {
    urls: unique(text.match(urlRegex)),
    emails: unique(text.match(emailRegex)),
    ips: unique(text.match(ipRegex)),
    dates: unique(text.match(dateRegex)),
    codeBlocksCount: (text.match(codeBlockRegex) ?? []).length
  };
}

export interface TextMetrics {
  chars: number;
  charsNoSpaces: number;
  words: number;
  lines: number;
  estimatedTokens: number;
  readingTimeSec: number;
}

/**
 * Instant text and token metrics analyzer.
 */
export function analyzeTextMetrics(text: string): TextMetrics {
  if (!text) {
    return {
      chars: 0,
      charsNoSpaces: 0,
      words: 0,
      lines: 0,
      estimatedTokens: 0,
      readingTimeSec: 0
    };
  }
  const chars = text.length;
  const charsNoSpaces = text.replace(/\s+/g, "").length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text.split(/\r?\n/).length;
  const estimatedTokens = Math.max(Math.ceil(chars / 3.5), Math.ceil(words * 1.3));
  const readingTimeSec = Math.ceil((words / 200) * 60);

  return {
    chars,
    charsNoSpaces,
    words,
    lines,
    estimatedTokens,
    readingTimeSec
  };
}

/**
 * Local JSON array to Markdown table converter.
 */
export function convertJsonToMarkdownTable(jsonInput: string): string {
  const parsed: unknown = JSON.parse(jsonInput);
  const rows: Array<Record<string, unknown>> = Array.isArray(parsed)
    ? (parsed as Array<Record<string, unknown>>)
    : typeof parsed === "object" && parsed !== null
    ? [parsed as Record<string, unknown>]
    : [];

  if (rows.length === 0) {
    return "_Нет данных для таблицы_";
  }

  const headers = Array.from(
    new Set(rows.flatMap((row) => (typeof row === "object" && row ? Object.keys(row) : [])))
  );

  if (headers.length === 0) {
    return "_Объекты не содержат ключей_";
  }

  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = typeof val === "object" ? JSON.stringify(val) : String(val);
    return str.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  };

  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyLines = rows.map(
    (row) => `| ${headers.map((h) => escapeCell(row?.[h])).join(" | ")} |`
  );

  return [headerLine, separatorLine, ...bodyLines].join("\n");
}
