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

function lines(text: string): string[] {
  if (text === "") return [];
  const result = text.split("\n");
  if (text.endsWith("\n")) result.pop();
  return result;
}

/** Linear, whole-file replacement hunks: deliberately no expensive line matching. */
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
    chunks.push(
      `@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n`
    );
    for (const line of oldLines) chunks.push(`-${line}\n`);
    if (oldLines.length && !file.before?.endsWith("\n"))
      chunks.push("\\ No newline at end of file\n");
    for (const line of newLines) chunks.push(`+${line}\n`);
    if (newLines.length && !file.content.endsWith("\n"))
      chunks.push("\\ No newline at end of file\n");
  }
  const text = chunks.join("");
  return encoder.encode(text).byteLength > OUTPUT_LIMIT
    ? { limited: true, text: "" }
    : { limited: false, text };
}
