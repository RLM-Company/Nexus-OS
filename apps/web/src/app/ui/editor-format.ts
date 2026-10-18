export type EditorFormatCommand =
  "bold" | "italic" | "heading" | "bullet" | "numbered" | "quote" | "code" | "link";

export type EditorSelection = { content: string; start: number; end: number };

/** Markdown only: selection offsets use the same UTF-16 positions as a textarea. */
export function formatEditorSelection(
  content: string,
  start: number,
  end: number,
  command: EditorFormatCommand,
  maxBytes: number
): EditorSelection | null {
  const from = Math.max(0, Math.min(content.length, Math.trunc(start)));
  const to = Math.max(from, Math.min(content.length, Math.trunc(end)));
  const selected = content.slice(from, to);
  let result: EditorSelection;
  if (["heading", "bullet", "numbered", "quote"].includes(command)) {
    const blockStart = from === 0 ? 0 : content.lastIndexOf("\n", from - 1) + 1;
    // Selecting through a line ending must not also format the following line.
    const lastPosition = to > from && content[to - 1] === "\n" ? to - 1 : to;
    const nextBreak = content.indexOf("\n", lastPosition);
    const blockEnd = nextBreak === -1 ? content.length : nextBreak;
    const lines = content.slice(blockStart, blockEnd).split("\n");
    const marker =
      command === "heading"
        ? /^#{1,6} /
        : command === "bullet"
          ? /^[-*+] /
          : command === "quote"
            ? /^> ?/
            : /^\d+\. /;
    const remove = lines.every((line) => marker.test(line));
    const replacement = lines
      .map((line, index) => {
        if (remove) return line.replace(marker, "");
        const prefix =
          command === "heading"
            ? "## "
            : command === "bullet"
              ? "- "
              : command === "quote"
                ? "> "
                : `${index + 1}. `;
        return prefix + line.replace(marker, "");
      })
      .join("\n");
    result = {
      content: content.slice(0, blockStart) + replacement + content.slice(blockEnd),
      start: blockStart,
      end: blockStart + replacement.length
    };
  } else if (command === "link") {
    const label = selected || "ссылка";
    const replacement = `[${label}](https://)`;
    result = {
      content: content.slice(0, from) + replacement + content.slice(to),
      start: from + label.length + 3,
      end: from + label.length + 11
    };
  } else if (command === "code" && selected.includes("\n")) {
    const blockStart = from === 0 ? 0 : content.lastIndexOf("\n", from - 1) + 1;
    const lastPosition = to > from && content[to - 1] === "\n" ? to - 1 : to;
    const nextBreak = content.indexOf("\n", lastPosition);
    const blockEnd = nextBreak === -1 ? content.length : nextBreak;
    const text = content.slice(blockStart, blockEnd);
    let tickCount = 3;
    for (const match of text.matchAll(/`+/g)) tickCount = Math.max(tickCount, match[0].length + 1);
    const ticks = "`".repeat(tickCount);
    const prefix = `${ticks}\n`;
    result = {
      content:
        content.slice(0, blockStart) + prefix + text + `\n${ticks}` + content.slice(blockEnd),
      start: blockStart + prefix.length,
      end: blockStart + prefix.length + text.length
    };
  } else {
    // A fence longer than any selected run of backticks keeps literal code intact.
    let tickCount = selected.includes("\n") ? 3 : 1;
    if (command === "code") {
      for (const match of selected.matchAll(/`+/g)) {
        tickCount = Math.max(tickCount, match[0].length + 1);
      }
    }
    const ticks = command === "code" ? "`".repeat(tickCount) : "";
    const padCode = command === "code" && !selected.includes("\n") && /^`|`$/.test(selected);
    const prefix =
      command === "bold"
        ? "**"
        : command === "italic"
          ? "*"
          : selected.includes("\n")
            ? `${ticks}\n`
            : ticks + (padCode ? " " : "");
    const suffix =
      command === "code"
        ? selected.includes("\n")
          ? `\n${ticks}`
          : (padCode ? " " : "") + ticks
        : prefix;
    const wrapped =
      content.slice(Math.max(0, from - prefix.length), from) === prefix &&
      content.slice(to, to + suffix.length) === suffix;
    if (wrapped) {
      result = {
        content:
          content.slice(0, from - prefix.length) + selected + content.slice(to + suffix.length),
        start: from - prefix.length,
        end: to - prefix.length
      };
    } else {
      // A double-click selection often includes spaces; emphasis markers must hug the word.
      const leading = command !== "code" ? (selected.match(/^\s*/)?.[0] ?? "") : "";
      const trailing =
        command !== "code" ? (selected.slice(leading.length).match(/\s*$/)?.[0] ?? "") : "";
      const text =
        selected.slice(leading.length, selected.length - trailing.length) ||
        (command === "code" ? "код" : "текст");
      result = {
        content:
          content.slice(0, from) + leading + prefix + text + suffix + trailing + content.slice(to),
        start: from + leading.length + prefix.length,
        end: from + leading.length + prefix.length + text.length
      };
    }
  }
  return new TextEncoder().encode(result.content).byteLength <= maxBytes ? result : null;
}
