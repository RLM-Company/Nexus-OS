export type MarkdownAction = "bold" | "italic" | "heading" | "quote" | "list" | "code";
export function editMarkdown(text: string, start: number, end: number, action: MarkdownAction) {
  start = Math.max(0, Math.min(text.length, start));
  end = Math.max(start, Math.min(text.length, end));
  const selected = text.slice(start, end);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  if (action === "bold" || action === "italic" || action === "code") {
    const marker =
      action === "bold"
        ? "**"
        : action === "italic"
          ? "_"
          : selected.includes("\n")
            ? "```" + newline
            : "`";
    const closing = marker.startsWith("```") ? newline + "```" : marker;
    if (
      start >= marker.length &&
      text.slice(start - marker.length, start) === marker &&
      text.slice(end, end + closing.length) === closing
    ) {
      return {
        text: text.slice(0, start - marker.length) + selected + text.slice(end + closing.length),
        start: start - marker.length,
        end: end - marker.length
      };
    }
    const leading = action !== "code" ? (selected.match(/^\s*/)?.[0] ?? "") : "";
    const trailing =
      action !== "code" && selected.trim() ? (selected.match(/\s*$/)?.[0] ?? "") : "";
    const value =
      (action !== "code" ? selected.trim() : selected) || (action === "code" ? "код" : "текст");
    return {
      text: text.slice(0, start) + leading + marker + value + closing + trailing + text.slice(end),
      start: start + leading.length + marker.length,
      end: start + leading.length + marker.length + value.length
    };
  }
  const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = text.indexOf("\n", end);
  const stop = lineEnd < 0 ? text.length : lineEnd;
  const prefix = action === "heading" ? "## " : action === "quote" ? "> " : "- ";
  const value = text
    .slice(lineStart, stop)
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
  return {
    text: text.slice(0, lineStart) + value + text.slice(stop),
    start: lineStart,
    end: lineStart + value.length
  };
}
