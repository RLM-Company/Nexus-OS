/**
 * Mapping of a Web Worker stack line back to the game.js source line.
 *
 * `gameWorkerSource(code)` wraps `code` in a fixed preamble. The first line of
 * the generated worker source is empty (the raw template starts with '\n'), so
 * the user's line 1 lands at worker line PREAMBLE_LINES + 1. We compute the
 * offset from the runtime itself rather than hard-coding it, and refuse to
 * guess when the code was not found at the expected position.
 */
export type GameDiagnostic = {
  source: "game.js";
  line: number | null;
  message: string;
  /** Short hash of the exact game.js bytes that produced the error. */
  sourceVersion: string;
};

/** Stable, bounded version label for the source that produced a diagnostic. */
export function gameSourceVersion(gameSource: string): string {
  let hash = 2166136261;
  for (let i = 0; i < gameSource.length; i += 1) {
    hash ^= gameSource.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const STACK_LINE = /(?:blob:[^\s)]+|https?:\/\/[^\s)]+):(\d+):(\d+)/;

export function mapWorkerErrorToGameLine(
  workerSource: string,
  gameSource: string,
  stack: string
): number | null {
  const at = workerSource.indexOf(gameSource);
  if (at < 0 || gameSource.length === 0) return null;
  const preambleLines = workerSource.slice(0, at).split("\n").length - 1;
  const match = STACK_LINE.exec(stack);
  if (!match) return null;
  const workerLine = Number(match[1]);
  if (!Number.isInteger(workerLine)) return null;
  const line = workerLine - preambleLines;
  const count = gameSource.split("\n").length;
  return line >= 1 && line <= count ? line : null;
}

/** Bounded, lossless extraction of the first error line from a worker stack. */
export function gameErrorMessage(stack: string): string {
  const first = stack.split("\n", 1)[0]?.trim() ?? "";
  return first.slice(0, 300) || "Ошибка в game.js";
}
