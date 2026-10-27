import { createHash } from "node:crypto";
import {
  computeCodeAgentSnapshotDigest,
  type CodeAgentWorkspaceFile
} from "./code-agent-workspace.js";

export type CodeDiffErrorCode =
  | "PATCH_LIMIT"
  | "PATCH_FORMAT"
  | "PATCH_TRUNCATED"
  | "PATCH_PATH"
  | "PATCH_UNSUPPORTED"
  | "PATCH_CONTEXT"
  | "PATCH_AMBIGUOUS"
  | "PATCH_POSITION"
  | "PATCH_BASE"
  | "PATCH_SNAPSHOT"
  | "PATCH_FILE_NOT_READ"
  | "PATCH_INDEX"
  | "PATCH_EMPTY";
export class CodeDiffError extends Error {
  constructor(
    readonly code: CodeDiffErrorCode,
    readonly path?: string,
    readonly line?: number
  ) {
    super(code);
  }
}
function fail(code: CodeDiffErrorCode, path?: string, line?: number): never {
  throw new CodeDiffError(code, path, line);
}
const MAX_PATCH = 200_000,
  MAX_LINES = 20_000,
  MAX_HUNKS = 128;
const bytes = (s: string) => Buffer.byteLength(s, "utf8");
function isArrayValue(value: unknown): boolean {
  return Array.isArray(value);
}
export const isSafeCodeAgentDiffPath = (path: string): boolean =>
  path.length > 0 &&
  path.length <= 240 &&
  !path.includes("\\") &&
  !path.toLowerCase().startsWith(".github/") &&
  path
    .split("/")
    .every(
      (p) =>
        /^[\p{L}\p{N}._ -]+$/u.test(p) &&
        p !== "." &&
        p !== ".." &&
        !/^\.git$|^\.env(?:\.|$)|secret|credential|\.pem$|\.key$/i.test(p)
    );
type TextLine = { text: string; newline: boolean };
type BodyLine = TextLine & { kind: " " | "-" | "+" };
type Hunk = {
  oldStart: number;
  newStart: number;
  body: BodyLine[];
  line: number;
  oldCount: number;
  newCount: number;
};
type FilePatch = {
  path: string;
  added: boolean;
  hunks: Hunk[];
  index?: { before: string; after: string };
};
export type CodeDiffNormalization = { path: string; line: number; before: string; after: string };
type Parsed = {
  files: FilePatch[];
  normalizedDiff: string;
  normalizations: CodeDiffNormalization[];
};
export type CodeDiffApplication = {
  files: Array<{ path: string; before: string | null; content: string }>;
  normalizedDiff: string;
  normalizations: CodeDiffNormalization[];
  snapshotDigest: string;
  resultDigest: string;
  baseSha: string;
};

function textLines(text: string): TextLine[] {
  if (!text) return [];
  const parts = text.split("\n");
  const finalNewline = text.endsWith("\n");
  if (finalNewline) parts.pop();
  return parts.map((part, i) => ({ text: part, newline: i < parts.length - 1 || finalNewline }));
}
const same = (a: TextLine, b: TextLine) => a.text === b.text && a.newline === b.newline;
function decodedToken(input: string): { path: string; used: number } {
  if (input[0] !== '"') {
    const end = input.indexOf(" ");
    return {
      path: end === -1 ? input : input.slice(0, end),
      used: end === -1 ? input.length : end
    };
  }
  const chunks: Buffer[] = [];
  let start = 1;
  for (let i = 1; i < input.length; i++) {
    if (input[i] === '"') {
      chunks.push(Buffer.from(input.slice(start, i)));
      try {
        return {
          path: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
          used: i + 1
        };
      } catch {
        return fail("PATCH_PATH");
      }
    }
    if (input[i] !== "\\") continue;
    chunks.push(Buffer.from(input.slice(start, i)));
    const next = input[++i];
    if (next === '"' || next === "\\") chunks.push(Buffer.from(next));
    else if (next && /^[0-7]$/u.test(next) && /^[0-7]{3}$/u.test(input.slice(i, i + 3))) {
      const value = Number.parseInt(input.slice(i, i + 3), 8);
      if (value > 255) fail("PATCH_PATH");
      chunks.push(Buffer.from([value]));
      i += 2;
    } else fail("PATCH_PATH");
    start = i + 1;
  }
  return fail("PATCH_PATH");
}
function headerPath(input: string, side: "a" | "b", allowNull = false): string | null {
  if (allowNull && input === "/dev/null") return null;
  let path = input;
  if (input[0] === '"') {
    const token = decodedToken(input);
    if (token.used !== input.length) fail("PATCH_PATH");
    path = token.path;
  }
  if (!path.startsWith(`${side}/`) || !isSafeCodeAgentDiffPath(path.slice(2))) fail("PATCH_PATH");
  return path.slice(2); // Exactly one explicit git prefix, never substitute repository paths.
}
function gitHeader(line: string): string {
  const input = line.slice("diff --git ".length);
  const a = decodedToken(input);
  if (input[a.used] !== " ") fail("PATCH_PATH");
  const rest = input.slice(a.used + 1),
    b = decodedToken(rest);
  if (b.used !== rest.length) fail("PATCH_AMBIGUOUS");
  const oldPath = headerPath(a.path, "a"),
    newPath = headerPath(b.path, "b");
  if (oldPath !== newPath || !oldPath) fail("PATCH_UNSUPPORTED");
  return oldPath;
}

function parse(diff: string): Parsed {
  if (typeof diff !== "string" || bytes(diff) > MAX_PATCH || diff.includes("\0"))
    fail("PATCH_LIMIT");
  if (!diff.endsWith("\n")) fail("PATCH_TRUNCATED");
  const lines = diff.split("\n");
  lines.pop();
  if (lines.length > MAX_LINES) fail("PATCH_LIMIT");
  const normalized = [...lines],
    files: FilePatch[] = [],
    normalizations: CodeDiffNormalization[] = [];
  let cursor = 0,
    hunkTotal = 0;
  const seen = new Set<string>();
  while (cursor < lines.length) {
    let path: string | undefined,
      addedMode = false,
      index: FilePatch["index"];
    const withGit = lines[cursor]!.startsWith("diff --git ");
    if (withGit) path = gitHeader(lines[cursor++]!);
    else if (files.length || !lines[cursor]!.startsWith("--- "))
      fail("PATCH_FORMAT", path, cursor + 1);
    while (cursor < lines.length && !lines[cursor]!.startsWith("--- ")) {
      const line = lines[cursor++]!;
      if (line === "new file mode 100644" && !addedMode) addedMode = true;
      else {
        const match = /^index ([a-f0-9]{7,40})\.\.([a-f0-9]{7,40})(?: (100644|100755))?$/u.exec(
          line
        );
        if (!match || index) fail("PATCH_UNSUPPORTED", path, cursor);
        index = { before: match[1]!, after: match[2]! };
      }
    }
    const oldHeader = lines[cursor++];
    const newHeader = lines[cursor++];
    if (!oldHeader?.startsWith("--- ") || !newHeader?.startsWith("+++ "))
      fail("PATCH_FORMAT", path, cursor);
    const oldPath = headerPath(oldHeader.slice(4), "a", true);
    if (newHeader === "+++ /dev/null") fail("PATCH_UNSUPPORTED", path, cursor);
    const newPath = headerPath(newHeader.slice(4), "b");
    if (
      !newPath ||
      (oldPath !== null && oldPath !== newPath) ||
      (path && path !== newPath) ||
      (addedMode && oldPath !== null)
    )
      fail("PATCH_PATH", path, cursor);
    path = newPath;
    const key = path.normalize("NFKC").toLowerCase();
    if (seen.has(key)) fail("PATCH_AMBIGUOUS", path);
    seen.add(key);
    const file: FilePatch = {
      path,
      added: oldPath === null,
      hunks: [],
      ...(index ? { index } : {})
    };
    while (cursor < lines.length && !lines[cursor]!.startsWith("diff --git ")) {
      const at = cursor,
        header = lines[cursor++]!;
      const match =
        /^@@ -(0|[1-9][0-9]{0,8})(?:,(0|[1-9][0-9]{0,8}))? \+(0|[1-9][0-9]{0,8})(?:,(0|[1-9][0-9]{0,8}))? @@(.*)$/u.exec(
          header
        );
      if (!match) fail("PATCH_FORMAT", path, at + 1);
      if (++hunkTotal > MAX_HUNKS) fail("PATCH_LIMIT", path);
      const body: BodyLine[] = [];
      while (
        cursor < lines.length &&
        !lines[cursor]!.startsWith("@@ ") &&
        !lines[cursor]!.startsWith("diff --git ")
      ) {
        const raw = lines[cursor++]!;
        if (raw === "\\ No newline at end of file") {
          const last = body.at(-1);
          if (!last || !last.newline) fail("PATCH_FORMAT", path, cursor);
          last.newline = false;
          continue;
        }
        const kind = raw[0];
        if (kind !== " " && kind !== "-" && kind !== "+") fail("PATCH_FORMAT", path, cursor);
        body.push({ kind, text: raw.slice(1), newline: true });
      }
      const oldCount = body.filter((l) => l.kind !== "+").length,
        newCount = body.filter((l) => l.kind !== "-").length;
      if (!body.length || body.every((l) => l.kind === " ")) fail("PATCH_EMPTY", path, at + 1);
      if (Number(match[2] ?? 1) !== oldCount || Number(match[4] ?? 1) !== newCount) {
        const after = `@@ -${match[1]},${oldCount} +${match[3]},${newCount} @@${match[5]}`;
        normalized[at] = after;
        normalizations.push({ path, line: at + 1, before: header, after });
      }
      file.hunks.push({
        oldStart: Number(match[1]),
        newStart: Number(match[3]),
        body,
        line: at + 1,
        oldCount,
        newCount
      });
    }
    if (!file.hunks.length) fail("PATCH_EMPTY", path);
    files.push(file);
    if (files.length > 8) fail("PATCH_LIMIT");
  }
  if (!files.length) fail("PATCH_EMPTY");
  for (const file of files) {
    const parts = file.path.normalize("NFKC").toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++)
      if (seen.has(parts.slice(0, i).join("/"))) fail("PATCH_PATH", file.path);
  }
  return { files, normalizedDiff: normalized.join("\n") + "\n", normalizations };
}

/** Inspect exact target paths before fetching blobs. It never guesses/replaces paths. */
export function inspectCodeAgentUnifiedDiff(diff: string): {
  paths: string[];
  addedPaths: string[];
} {
  const parsed = parse(diff);
  return {
    paths: parsed.files.map((f) => f.path),
    addedPaths: parsed.files.filter((f) => f.added).map((f) => f.path)
  };
}
function occurrences(haystack: TextLine[], needle: TextLine[]): number {
  // KMP; linear in base lines + hunk lines. Stop after the second match.
  const prefix = new Array<number>(needle.length).fill(0);
  for (let i = 1, j = 0; i < needle.length; i++) {
    while (j && !same(needle[i]!, needle[j]!)) j = prefix[j - 1]!;
    if (same(needle[i]!, needle[j]!)) j++;
    prefix[i] = j;
  }
  let count = 0;
  for (let i = 0, j = 0; i < haystack.length; i++) {
    while (j && !same(haystack[i]!, needle[j]!)) j = prefix[j - 1]!;
    if (same(haystack[i]!, needle[j]!)) j++;
    if (j === needle.length) {
      if (++count > 1) return count;
      j = prefix[j - 1]!;
    }
  }
  return count;
}
const blob = (content: string) =>
  createHash("sha1")
    .update(`blob ${bytes(content)}\0`)
    .update(content)
    .digest("hex");
export function applyCodeAgentUnifiedDiff(input: {
  diff: string;
  snapshot: readonly CodeAgentWorkspaceFile[];
  baseSha: string;
  expectedBaseSha: string;
  expectedSnapshotDigest: string;
  existingPaths?: readonly string[];
}): CodeDiffApplication {
  if (!/^[a-f0-9]{40}$/u.test(input.baseSha) || input.baseSha !== input.expectedBaseSha)
    fail("PATCH_BASE");
  if (
    !isArrayValue(input.snapshot) ||
    input.snapshot.length > 40 ||
    input.snapshot.reduce((n, f) => n + bytes(f.content), 0) > 500_000
  )
    fail("PATCH_LIMIT");
  const snapshotDigest = computeCodeAgentSnapshotDigest(input.snapshot);
  if (snapshotDigest !== input.expectedSnapshotDigest) fail("PATCH_SNAPSHOT");
  const parsed = parse(input.diff),
    snapshot = new Map(input.snapshot.map((f) => [f.path, f.content]));
  const existing = new Set(
    (input.existingPaths ?? [...snapshot.keys()]).map((path) =>
      path.normalize("NFKC").toLowerCase()
    )
  );
  const output: CodeDiffApplication["files"] = [];
  for (const file of parsed.files) {
    const before = snapshot.get(file.path);
    const pathKey = file.path.normalize("NFKC").toLowerCase();
    if (
      file.added
        ? !input.existingPaths || existing.has(pathKey) || before !== undefined
        : before === undefined
    )
      fail("PATCH_FILE_NOT_READ", file.path);
    if (
      file.added &&
      [...existing].some((path) => pathKey.startsWith(path + "/") || path.startsWith(pathKey + "/"))
    )
      fail("PATCH_PATH", file.path);
    if (before !== undefined && bytes(before) > 50_000) fail("PATCH_LIMIT", file.path);
    if (
      file.index &&
      (file.added ? !/^0+$/u.test(file.index.before) : !blob(before!).startsWith(file.index.before))
    )
      fail("PATCH_INDEX", file.path);
    const original = textLines(before ?? ""),
      result: TextLine[] = [];
    let cursor = 0;
    for (const hunk of file.hunks) {
      const start = hunk.oldCount ? hunk.oldStart - 1 : hunk.oldStart;
      if (start < cursor || start > original.length || start + hunk.oldCount > original.length)
        fail("PATCH_POSITION", file.path, hunk.line);
      if (file.added && (hunk.oldCount || hunk.oldStart || file.hunks.length !== 1))
        fail("PATCH_POSITION", file.path, hunk.line);
      result.push(...original.slice(cursor, start));
      if (hunk.newStart !== result.length + (hunk.newCount ? 1 : 0))
        fail("PATCH_POSITION", file.path, hunk.line);
      const preimage = hunk.body.filter((l) => l.kind !== "+");
      if (preimage.some((line, i) => !same(line, original[start + i]!)))
        fail("PATCH_CONTEXT", file.path, hunk.line);
      if (preimage.length && occurrences(original, preimage) !== 1)
        fail("PATCH_AMBIGUOUS", file.path, hunk.line);
      if (
        original.length &&
        !(start === 0 && hunk.oldCount === original.length) &&
        !hunk.body.some((l) => l.kind === " ")
      )
        fail("PATCH_AMBIGUOUS", file.path, hunk.line);
      result.push(...hunk.body.filter((l) => l.kind !== "-"));
      cursor = start + hunk.oldCount;
    }
    result.push(...original.slice(cursor));
    if (result.slice(0, -1).some((l) => !l.newline)) fail("PATCH_FORMAT", file.path);
    const content = result.map((l) => l.text + (l.newline ? "\n" : "")).join("");
    if (content === before) fail("PATCH_EMPTY", file.path);
    if (bytes(content) > 50_000) fail("PATCH_LIMIT", file.path);
    if (file.index && !blob(content).startsWith(file.index.after)) fail("PATCH_INDEX", file.path);
    output.push({ path: file.path, before: before ?? null, content });
  }
  if (output.reduce((n, f) => n + bytes(f.content), 0) > 160_000) fail("PATCH_LIMIT");
  const merged = new Map(input.snapshot.map((f) => [f.path, f]));
  for (const f of output) merged.set(f.path, f);
  return {
    files: output,
    normalizedDiff: parsed.normalizedDiff,
    normalizations: parsed.normalizations,
    snapshotDigest,
    resultDigest: computeCodeAgentSnapshotDigest([...merged.values()]),
    baseSha: input.baseSha
  };
}

function gitPath(path: string): string {
  const data = Buffer.from(path);
  if ([...data].every((b) => b >= 33 && b <= 126 && b !== 34 && b !== 92)) return path;
  return (
    '"' +
    [...data]
      .map((b) =>
        b === 34
          ? '\\"'
          : b === 92
            ? "\\\\"
            : b >= 33 && b <= 126
              ? String.fromCharCode(b)
              : `\\${b.toString(8).padStart(3, "0")}`
      )
      .join("") +
    '"'
  );
}
/** Linear common prefix/suffix preview. One exact hunk per file, 3 lines of context. */
export function renderCodeAgentUnifiedDiff(
  files: readonly { path: string; before: string | null; content: string }[]
): string {
  if (
    files.length > 8 ||
    files.reduce((n, f) => n + bytes(f.before ?? "") + bytes(f.content), 0) > 660_000
  )
    fail("PATCH_LIMIT");
  const chunks: string[] = [];
  for (const file of files) {
    if (!isSafeCodeAgentDiffPath(file.path)) fail("PATCH_PATH");
    if (file.before === file.content) continue;
    const a = gitPath(`a/${file.path}`),
      b = gitPath(`b/${file.path}`);
    chunks.push(`diff --git ${a} ${b}\n`);
    if (file.before === null) chunks.push("new file mode 100644\n");
    const old = textLines(file.before ?? ""),
      next = textLines(file.content);
    if (!old.length && !next.length) continue;
    chunks.push(`--- ${file.before === null ? "/dev/null" : a}\n+++ ${b}\n`);
    let prefix = 0,
      suffix = 0;
    while (prefix < Math.min(old.length, next.length) && same(old[prefix]!, next[prefix]!))
      prefix++;
    while (
      suffix < Math.min(old.length, next.length) - prefix &&
      same(old[old.length - suffix - 1]!, next[next.length - suffix - 1]!)
    )
      suffix++;
    const start = Math.max(0, prefix - 3),
      tail = Math.min(3, suffix);
    const oldEnd = old.length - suffix + tail,
      newEnd = next.length - suffix + tail;
    chunks.push(
      `@@ -${oldEnd > start ? start + 1 : start},${oldEnd - start} +${newEnd > start ? start + 1 : start},${newEnd - start} @@\n`
    );
    const emit = (kind: string, line: TextLine) => {
      chunks.push(kind + line.text + "\n");
      if (!line.newline) chunks.push("\\ No newline at end of file\n");
    };
    for (const line of old.slice(start, prefix)) emit(" ", line);
    for (const line of old.slice(prefix, old.length - suffix)) emit("-", line);
    for (const line of next.slice(prefix, next.length - suffix)) emit("+", line);
    for (const line of next.slice(next.length - suffix, newEnd)) emit(" ", line);
  }
  const diff = chunks.join("");
  if (bytes(diff) > 700_000) fail("PATCH_LIMIT");
  return diff;
}
