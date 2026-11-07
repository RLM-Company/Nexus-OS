// Pure reconstruction of positional OCR output into readable text. No model,
// no network, no second engine: the caller still owns the OCR engine, and
// words are only rearranged, never dropped or rewritten. Limits mirror the
// page reader contract (180000 UTF-16 units); oversize or ambiguous layouts
// return null so the caller keeps the engine's plain text.
export function collectOcrWords(blocks) {
  const words = [];
  if (!Array.isArray(blocks)) return words;
  for (const block of blocks) {
    if (!block || !Array.isArray(block.paragraphs)) continue;
    for (const paragraph of block.paragraphs) {
      if (!paragraph || !Array.isArray(paragraph.lines)) continue;
      for (const line of paragraph.lines) {
        if (!line || !Array.isArray(line.words)) continue;
        const lineWords = [];
        for (const word of line.words) {
          const text = typeof word?.text === "string" ? word.text.trim() : "";
          const bbox = word?.bbox;
          if (
            !text ||
            !bbox ||
            [bbox.x0, bbox.y0, bbox.x1, bbox.y1].some(
              (value) => !Number.isFinite(value) || value < 0
            ) ||
            bbox.x1 <= bbox.x0 ||
            bbox.y1 <= bbox.y0
          )
            continue;
          lineWords.push({
            text,
            bbox: { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 }
          });
        }
        lineWords.sort((a, b) => a.bbox.x0 - b.bbox.x0 || a.bbox.x1 - b.bbox.x1);
        words.push(...lineWords);
      }
    }
  }
  return words;
}

function median(list) {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function groupLines(words, medianHeight) {
  const ordered = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const lines = [];
  for (const word of ordered) {
    const center = (word.bbox.y0 + word.bbox.y1) / 2;
    let matched = null;
    // Lines are created in y0 order; only the last few can overlap.
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
      const line = lines[i];
      if (center >= line.top - medianHeight * 0.5 && center <= line.bottom + medianHeight * 0.5) {
        matched = line;
        break;
      }
    }
    if (matched) {
      matched.top = Math.min(matched.top, word.bbox.y0);
      matched.bottom = Math.max(matched.bottom, word.bbox.y1);
      matched.words.push(word);
    } else {
      lines.push({ top: word.bbox.y0, bottom: word.bbox.y1, words: [word] });
    }
  }
  for (const line of lines)
    line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0 || a.bbox.x1 - b.bbox.x1);
  return lines;
}

function splitLineCells(lineWords, minGap) {
  const cells = [];
  let current = [];
  for (let i = 0; i < lineWords.length; i++) {
    current.push(lineWords[i]);
    if (i < lineWords.length - 1) {
      const gap = lineWords[i + 1].bbox.x0 - lineWords[i].bbox.x1;
      if (gap >= minGap) {
        cells.push({ words: current });
        current = [];
      }
    }
  }
  cells.push({ words: current });
  return cells;
}

function cellText(cell) {
  return cell.words.map((word) => word.text).join(" ");
}

export function layoutFromWords(rawWords, { maxText = 180000 } = {}) {
  const words = Array.isArray(rawWords) ? rawWords : [];
  const MAX_WORDS = 5000;
  const MIN_TABLE_ROWS = 3;
  if (!words.length || words.length > MAX_WORDS) return null;
  const medianHeight = median(words.map((word) => word.bbox.y1 - word.bbox.y0));
  if (!(medianHeight > 0)) return null;
  const lines = groupLines(words, medianHeight);
  if (lines.length < MIN_TABLE_ROWS) return null;
  const minGap = Math.max(medianGapOf(lines) * 3, medianHeight * 0.8);
  const candidates = lines
    .map((line) => ({ line, cells: splitLineCells(line.words, minGap) }))
    .filter((entry) => entry.cells.length >= 2);
  if (candidates.length < MIN_TABLE_ROWS) return null;
  // Modal shared cell count k*; enough lines must agree on it.
  const counts = new Map();
  for (const { cells } of candidates) counts.set(cells.length, (counts.get(cells.length) || 0) + 1);
  let k = 0;
  let kRows = 0;
  for (const [count, rows] of counts)
    if (count >= 2 && rows > kRows) {
      k = count;
      kRows = rows;
    }
  if (k < 2 || kRows < Math.max(MIN_TABLE_ROWS, Math.ceil(candidates.length * 0.3))) return null;
  const kCandidates = candidates.filter((entry) => entry.cells.length === k);
  // Column boundary clusters: median start-x per boundary position.
  const tolerance = medianHeight * 0.6;
  const clusters = Array.from({ length: k - 1 }, () => []);
  for (const { cells } of kCandidates)
    for (let j = 0; j < k - 1; j++) clusters[j].push(cells[j + 1].words[0].bbox.x0);
  const boundaries = clusters.map((positions) => median(positions));
  for (let j = 0; j < boundaries.length - 1; j++)
    if (boundaries[j + 1] <= boundaries[j] + tolerance) return null;
  const matchesGrid = (cells) =>
    cells.length === k &&
    cells.every((cell, index) => {
      if (index === 0 || index === k - 1) return true;
      const start = cell.words[0].bbox.x0;
      const previous = cells[index - 1].words.at(-1).bbox.x1;
      if (start - previous < minGap) return false;
      return Math.abs(start - boundaries[index - 1]) <= tolerance;
    });
  const tableLines = kCandidates
    .filter((entry) => matchesGrid(entry.cells))
    .map((entry) => entry.line);
  if (tableLines.length < Math.max(MIN_TABLE_ROWS, Math.ceil(kRows * 0.6))) return null;
  const isTable = new Set(tableLines);
  const partsFor = new Map();
  let used = 0;
  for (const entry of candidates) {
    const parts =
      isTable.has(entry.line) && matchesGrid(entry.cells)
        ? entry.cells.map((cell) => cellText(cell))
        : [cellText({ words: entry.line.words })];
    partsFor.set(entry.line, parts);
    used += parts.join("\t").length + 1;
  }
  for (const line of lines) {
    if (partsFor.has(line)) continue;
    const parts = [cellText({ words: line.words })];
    partsFor.set(line, parts);
    used += parts.join("\t").length + 1;
  }
  const text =
    [...lines]
      .sort((a, b) => a.top - b.top || a.words[0].bbox.x0 - b.words[0].bbox.x0)
      .map((line) => partsFor.get(line).join("\t"))
      .join("\n") + "\n";
  if (used > maxText + lines.length && text.length > maxText) return null;
  return { kind: "table", text, rows: tableLines.length, columns: k };
}

function medianGapOf(lines) {
  const gaps = [];
  for (const line of lines)
    for (let i = 1; i < line.words.length; i++)
      gaps.push(line.words[i].bbox.x0 - line.words[i - 1].bbox.x1);
  return median(gaps.filter((gap) => gap > 0).sort((a, b) => a - b));
}
