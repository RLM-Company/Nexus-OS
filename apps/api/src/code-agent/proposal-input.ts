import { CodeAgentError } from "./store.js";

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
