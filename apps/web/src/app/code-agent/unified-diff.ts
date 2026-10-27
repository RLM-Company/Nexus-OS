type DiffFile = { path: string; before: string | null; content: string };
type DiffPreview = { limited: false; text: string } | { limited: true; text: "" };
const encoder = new TextEncoder();
// Preview is exact or refused; it never silently cuts a patch in the middle.
const INPUT_LIMIT = 1_000_000;
const OUTPUT_LIMIT = 2_100_000;

function gitPath(path: string): string {
  const bytes = encoder.encode(path);
  if (bytes.every((byte) => byte >= 33 && byte <= 126 && byte !== 34 && byte !== 92)) return path;
  let quoted = '"';
  for (const byte of bytes) {
    if (byte === 34) quoted += '\\"';
    else if (byte === 92) quoted += "\\\\";
    else if (byte >= 33 && byte <= 126) quoted += String.fromCharCode(byte);
    else quoted += `\\${byte.toString(8).padStart(3, "0")}`;
  }
  return quoted + '"';
}

function lines(text: string): Array<{ text: string; newline: boolean }> {
  if (text === "") return [];
  const result = text.split("\n");
  if (text.endsWith("\n")) result.pop();
  return result.map((value, i) => ({
    text: value,
    newline: i < result.length - 1 || text.endsWith("\n")
  }));
}

/** Linear common-prefix/suffix hunks with three context lines; no quadratic matching. */
export function codeAgentUnifiedDiff(files: readonly DiffFile[]): DiffPreview {
  if (files.length > 8) return { limited: true, text: "" };
  let inputBytes = 0;
  for (const file of files) {
    if (
      file.path.length > 512 ||
      file.content.length > INPUT_LIMIT ||
      (file.before?.length ?? 0) > INPUT_LIMIT
    )
      return { limited: true, text: "" };
    inputBytes +=
      encoder.encode(file.content).byteLength + encoder.encode(file.before ?? "").byteLength;
    if (inputBytes > INPUT_LIMIT) return { limited: true, text: "" };
  }
  const chunks: string[] = [];
  for (const file of files) {
    if (file.before === file.content) continue;
    const oldPath = gitPath(`a/${file.path}`);
    const newPath = gitPath(`b/${file.path}`);
    chunks.push(`diff --git ${oldPath} ${newPath}\n`);
    if (file.before === null) chunks.push("new file mode 100644\n");
    const oldLines = lines(file.before ?? "");
    const newLines = lines(file.content);
    // Git creates an empty new file from the mode header without an empty hunk.
    if (!oldLines.length && !newLines.length) continue;
    chunks.push(`--- ${file.before === null ? "/dev/null" : oldPath}\n+++ ${newPath}\n`);
    const same = (a: { text: string; newline: boolean }, b: { text: string; newline: boolean }) =>
      a.text === b.text && a.newline === b.newline;
    let prefix = 0,
      suffix = 0;
    while (
      prefix < Math.min(oldLines.length, newLines.length) &&
      same(oldLines[prefix]!, newLines[prefix]!)
    )
      prefix++;
    while (
      suffix < Math.min(oldLines.length, newLines.length) - prefix &&
      same(oldLines[oldLines.length - suffix - 1]!, newLines[newLines.length - suffix - 1]!)
    )
      suffix++;
    const start = Math.max(0, prefix - 3),
      tail = Math.min(3, suffix),
      oldEnd = oldLines.length - suffix + tail,
      newEnd = newLines.length - suffix + tail;
    chunks.push(
      `@@ -${oldEnd > start ? start + 1 : start},${oldEnd - start} +${newEnd > start ? start + 1 : start},${newEnd - start} @@\n`
    );
    const emit = (kind: string, line: { text: string; newline: boolean }) => {
      chunks.push(`${kind}${line.text}\n`);
      if (!line.newline) chunks.push("\\ No newline at end of file\n");
    };
    for (const line of oldLines.slice(start, prefix)) emit(" ", line);
    for (const line of oldLines.slice(prefix, oldLines.length - suffix)) emit("-", line);
    for (const line of newLines.slice(prefix, newLines.length - suffix)) emit("+", line);
    for (const line of newLines.slice(newLines.length - suffix, newEnd)) emit(" ", line);
  }
  const text = chunks.join("");
  return encoder.encode(text).byteLength > OUTPUT_LIMIT
    ? { limited: true, text: "" }
    : { limited: false, text };
}
