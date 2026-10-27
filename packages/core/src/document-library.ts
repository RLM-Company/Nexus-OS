/** Bounded, deterministic text indexing. No model calls or external services. */
export type LibraryPage = { page: number | null; text: string };
export type LibraryChunk = {
  ordinal: number;
  page: number | null;
  line_start: number;
  line_end: number;
  content: string;
};

export const LIBRARY_LIMITS = {
  fileBytes: 20_000_000,
  textCharacters: 2_000_000,
  pdfPages: 500,
  chunksPerFile: 5_000,
  filesPerProject: 100,
  bytesPerProject: 100_000_000,
  maxHits: 8
} as const;

const fold = (text: string) => text.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е");
const stop = new Set([
  "что",
  "как",
  "для",
  "это",
  "или",
  "при",
  "где",
  "почему",
  "когда",
  "какие",
  "какой",
  "между",
  "которые",
  "который",
  "про",
  "все",
  "есть",
  "было",
  "были",
  "быть",
  "чем",
  "чего",
  "мне",
  "тебе",
  "нужно",
  "найди",
  "покажи",
  "документ",
  "файл",
  "из",
  "на",
  "по",
  "от",
  "до",
  "не",
  "но",
  "же",
  "ли",
  "the",
  "and",
  "with",
  "from",
  "are",
  "who",
  "what"
]);

export const libraryTerms = (text: string): string[] =>
  [...new Set(fold(text).match(/[\p{L}\p{N}]{3,}/gu) ?? [])]
    .filter((word) => !stop.has(word))
    .slice(0, 20);

/** Preserve source page and source line even when a single source line is huge. */
export function chunkLibraryPages(
  pages: readonly LibraryPage[],
  maxLength = 1_600
): LibraryChunk[] {
  if (!Number.isInteger(maxLength) || maxLength < 100 || maxLength > 4_500)
    throw new Error("Invalid chunk length");
  const chunks: LibraryChunk[] = [];
  let ordinal = 0;
  for (const page of pages) {
    let globalLine = 0;
    if (page.page !== null && (!Number.isInteger(page.page) || page.page < 1 || page.page > 500))
      throw new Error("Invalid document page");
    let current = "";
    let start = globalLine + 1;
    let end = start;
    const flush = () => {
      if (!current.trim()) {
        current = "";
        return;
      }
      if (chunks.length >= LIBRARY_LIMITS.chunksPerFile)
        throw new Error("Too many document chunks");
      chunks.push({
        ordinal: ordinal++,
        page: page.page,
        line_start: start,
        line_end: end,
        content: current
      });
      current = "";
    };
    for (const line of page.text.replace(/\r\n?/g, "\n").split("\n")) {
      globalLine++;
      // Do not drop or truncate a long CSV record / unbroken line.
      for (let offset = 0; offset < line.length || (offset === 0 && !line.length);) {
        let piece = line.slice(offset, offset + maxLength);
        if (piece.length && /[\uD800-\uDBFF]/.test(piece[piece.length - 1] ?? ""))
          piece = piece.slice(0, -1);
        if (current && current.length + piece.length + 1 > maxLength) flush();
        if (!current) start = globalLine;
        end = globalLine;
        current += (current ? "\n" : "") + piece;
        offset += piece.length || 1;
      }
    }
    flush();
  }
  return chunks;
}

export function rankLibraryChunks<T extends LibraryChunk>(
  chunks: readonly T[],
  query: string,
  limit = LIBRARY_LIMITS.maxHits
): Array<T & { score: number }> {
  const terms = libraryTerms(query);
  if (!terms.length) return [];
  const ranked = chunks.flatMap((chunk) => {
    const body = fold(chunk.content);
    const words = new Set(body.match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    let matched = 0;
    let score = 0;
    for (const term of terms) {
      if (words.has(term)) {
        score += 5;
        matched++;
      } else if (
        term.length >= 5 &&
        [...words].some((word) => word.startsWith(term.slice(0, Math.max(4, term.length - 2))))
      ) {
        score += 2;
        matched++;
      }
    }
    if (!matched) return [];
    // Reward coverage across independent query terms, not arbitrary file length.
    score += (matched * matched * 8) / terms.length;
    if (terms.length > 1 && body.includes(fold(query.trim()))) score += 8;
    return [{ ...chunk, score: Number(score.toFixed(3)) }];
  });
  return ranked
    .sort((a, b) => b.score - a.score || a.ordinal - b.ordinal)
    .slice(0, Math.min(Math.max(1, limit), LIBRARY_LIMITS.maxHits));
}

export const libraryCitation = (source: {
  name: string;
  page: number | null;
  line_start: number;
  line_end: number;
}) =>
  `${source.name}${source.page === null ? "" : `, стр. ${source.page}`}, строки ${source.line_start}–${source.line_end}`;
