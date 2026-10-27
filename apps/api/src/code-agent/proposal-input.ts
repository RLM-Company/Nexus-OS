import { CodeAgentError } from "./store.js";

/** Line labels belong to the prompt, never to the canonical snapshot or patch. */
export function codePromptFiles(files: Array<{ path: string; content: string }>) {
  return files.map(({ path, content }) => ({
    path,
    numbered_lines: content
      .split("\n")
      .map((line, index) => `${index + 1}: ${line}`)
      .join("\n")
  }));
}

/** Exact, unique replacements avoid model-invented diff line offsets. No fuzzy search. */
export function applyCodeExactEdits(
  input: unknown,
  snapshot: Array<{ path: string; content: string }>
): Array<{ path: string; content: string }> {
  if (!Array.isArray(input) || !input.length || input.length > 32)
    throw new CodeAgentError("INVALID_PATCH");
  const sources = new Map(snapshot.map((file) => [file.path, file.content]));
  const changed = new Map<string, string>();
  for (const candidate of input as unknown[]) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new CodeAgentError("INVALID_PATCH");
    const edit = candidate as Record<string, unknown>;
    if (
      Object.keys(edit).some((key) => !["path", "old_text", "new_text"].includes(key)) ||
      typeof edit.path !== "string" ||
      typeof edit.old_text !== "string" ||
      typeof edit.new_text !== "string" ||
      !edit.old_text ||
      Buffer.byteLength(edit.old_text) > 50000 ||
      Buffer.byteLength(edit.new_text) > 50000 ||
      edit.old_text.includes("\0") ||
      edit.new_text.includes("\0")
    )
      throw new CodeAgentError("INVALID_PATCH");
    if (!sources.has(edit.path)) throw new CodeAgentError("FILE_NOT_READ");
    const source = changed.get(edit.path) ?? sources.get(edit.path)!;
    const at = source.indexOf(edit.old_text);
    if (at < 0) throw new CodeAgentError("PATCH_CONTEXT");
    if (source.indexOf(edit.old_text, at + 1) >= 0) throw new CodeAgentError("PATCH_AMBIGUOUS");
    if (edit.old_text === edit.new_text) throw new CodeAgentError("EMPTY_CHANGE");
    const content = source.slice(0, at) + edit.new_text + source.slice(at + edit.old_text.length);
    if (Buffer.byteLength(content) > 50000) throw new CodeAgentError("PATCH_LIMIT");
    changed.set(edit.path, content);
    if (changed.size > 8) throw new CodeAgentError("PATCH_LIMIT");
  }
  const files = [...changed].map(([path, content]) => ({ path, content }));
  if (files.reduce((total, file) => total + Buffer.byteLength(file.content), 0) > 160000)
    throw new CodeAgentError("PATCH_LIMIT");
  return files;
}

/** Repository validation uses the complete tree; model input needs only nearby paths. */
export function selectCodeTreePaths(
  entries: Array<{ path: string }>,
  selected: string[]
): string[] {
  const selectedSet = new Set(selected);
  const result = [...selected];
  const parents = new Set(
    selected.map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""))
  );
  const nearby = entries
    .filter(
      (e) =>
        !selectedSet.has(e.path) &&
        (parents.has(e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : "") ||
          ["package.json", "README.md", "tsconfig.json"].includes(e.path))
    )
    .map((e) => e.path)
    .sort();
  let bytes = Buffer.byteLength(JSON.stringify(result));
  for (const path of nearby) {
    const size = Buffer.byteLength(JSON.stringify(path)) + 1;
    if (result.length >= 128 || bytes + size > 12000) break;
    result.push(path);
    bytes += size;
  }
  return result;
}

/** One bounded response. Never call a model to repair/paraphrase a malformed patch. */
export function decodeCodeProposal(text: string): unknown {
  if (Buffer.byteLength(text) > 200_000) throw new CodeAgentError("PATCH_LIMIT");
  let value = text;
  if (
    value.startsWith("```diff\n") ||
    value.startsWith("```patch\n") ||
    value.startsWith("```json\n")
  ) {
    const start = value.indexOf("\n") + 1;
    if (!value.endsWith("\n```\n") && !value.endsWith("\n```"))
      throw new CodeAgentError("PATCH_FORMAT");
    value = value.slice(start, value.endsWith("\n") ? -4 : -3);
  }
  if (value.startsWith("diff --git ") || value.startsWith("--- "))
    return { summary: "Предложен текстовый патч", diff: value };
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new CodeAgentError("PATCH_FORMAT");
  }
}

/** No paid file-selection turn: exact paths, then a small deterministic filename shortlist. */
export function selectCodeContextPaths(
  task: string,
  requested: string[],
  entries: Array<{ path: string }>
): string[] {
  if (requested.length) return requested;
  const explicit = entries.filter((e) => task.includes(e.path)).map((e) => e.path);
  if (explicit.length > 32) throw new CodeAgentError("WORKSPACE_LIMIT");
  if (explicit.length) return explicit;
  const words = new Set(task.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const ranked = entries
    .filter((e) => /\.(?:[cm]?[jt]sx?|md)$/iu.test(e.path))
    .map((e) => {
      const name = e.path.split("/").at(-1)!.toLowerCase();
      const parts = name.split(".").filter((part) => part.length >= 3);
      const score = [...words].reduce(
        (n, w) => n + (name.includes(w) || parts.some((part) => w.endsWith(part)) ? 1 : 0),
        0
      );
      return { path: e.path, score };
    })
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (ranked.length > 8 && !ranked.some((e) => e.score > 0))
    throw new CodeAgentError("CONTEXT_FILES_REQUIRED");
  return ranked
    .filter((e) => ranked.length <= 8 || e.score > 0)
    .slice(0, 8)
    .map((e) => e.path);
}
