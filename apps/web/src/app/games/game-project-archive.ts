import { unzipSync } from "fflate";
import { parseGameProject } from "@cosmora/contracts/game-project";

export const GAME_ARCHIVE_MAX_BYTES = 1024 * 1024;
const MAX_TOTAL_EXTRACTED = 1024 * 1024;
const entryLimits = new Map([
  ["project.json", 512 * 1024],
  ["scene.html", 64000],
  ["styles.css", 64000],
  ["game.js", 64000],
  ["index.html", 512 * 1024],
  ["README.txt", 64 * 1024]
]);
const sources = ["project.json", "scene.html", "styles.css", "game.js"] as const;

/**
 * Recover an existing exported Games package as inert source text only.
 * Reject unexpected names, duplicates, ZIP64 size sentinels and inflated-size
 * abuse before extracting. The executable offline index.html is never read.
 */
export function readGameProjectArchive(archive: Uint8Array): string {
  const invalid = (): never => {
    throw new Error("INVALID_GAME_ARCHIVE");
  };
  if (!archive.byteLength || archive.byteLength > GAME_ARCHIVE_MAX_BYTES) return invalid();

  let failed = false;
  let total = 0;
  const seen = new Set<string>();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive, {
      filter(info) {
        const limit = entryLimits.get(info.name);
        if (
          limit === undefined ||
          seen.has(info.name) ||
          !Number.isSafeInteger(info.originalSize) ||
          info.originalSize < 0 ||
          info.originalSize > limit ||
          !Number.isSafeInteger(info.size) ||
          info.size < 0 ||
          info.size > GAME_ARCHIVE_MAX_BYTES ||
          (info.compression !== 0 && info.compression !== 8) ||
          total + info.originalSize > MAX_TOTAL_EXTRACTED
        ) {
          failed = true;
          return false;
        }
        seen.add(info.name);
        total += info.originalSize;
        return sources.some((name) => name === info.name);
      }
    });
  } catch {
    return invalid();
  }
  if (failed || seen.size !== entryLimits.size) return invalid();
  const decode = (name: string) => {
    const bytes = entries[name];
    if (!bytes) return invalid();
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return invalid();
    }
  };
  const text = decode("project.json");
  try {
    const project = parseGameProject(text);
    for (const file of project.files) {
      if (decode(file.name) !== file.content) return invalid();
    }
    return text;
  } catch {
    return invalid();
  }
}
