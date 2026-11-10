"use strict";

const crypto = require("node:crypto");
const zlib = require("node:zlib");

const MAX_DOCUMENT_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB per file (matches Local Vault limit)
const MAX_UNCOMPRESSED_ZIP_BYTES = 16 * 1024 * 1024; // 16 MiB zip-bomb ceiling
const MAX_ZIP_ENTRIES = 1000;
const MAX_SINGLE_ENTRY_BYTES = 8 * 1024 * 1024;
const DEFAULT_HANDOFF_SLICE_CHARS = 12_000; // Matches 12,000-char chat handoff ceiling

const EXTRACTION_ERROR_CODES = Object.freeze({
  VAULT_DOC_EMPTY: "VAULT_DOC_EMPTY",
  VAULT_DOC_TOO_LARGE: "VAULT_DOC_TOO_LARGE",
  VAULT_DOC_UNSUPPORTED_FORMAT: "VAULT_DOC_UNSUPPORTED_FORMAT",
  VAULT_DOC_CORRUPT_ARCHIVE: "VAULT_DOC_CORRUPT_ARCHIVE",
  VAULT_DOC_ZIP_BOMB_DETECTED: "VAULT_DOC_ZIP_BOMB_DETECTED",
  VAULT_DOC_CORRUPT_PDF: "VAULT_DOC_CORRUPT_PDF",
  VAULT_DOC_SLICE_OUT_OF_RANGE: "VAULT_DOC_SLICE_OUT_OF_RANGE",
  VAULT_SNAPSHOT_TOO_LARGE: "VAULT_SNAPSHOT_TOO_LARGE",
  VAULT_SNAPSHOT_INVALID: "VAULT_SNAPSHOT_INVALID"
});

class VaultDocumentError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "VaultDocumentError";
    this.code = EXTRACTION_ERROR_CODES[code] || code;
    if (details && typeof details === "object") {
      this.details = Object.freeze({ ...details });
    }
  }
}

function sha256Hex(bufferOrString) {
  return crypto.createHash("sha256").update(bufferOrString).digest("hex");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Safely unpacks an Office OpenXML (.docx, .xlsx, .pptx) ZIP archive in memory
 * with strict zip-bomb, entry-count, path-safety, and CRC32 checks.
 */
function unpackSafeZipArchive(rawBuffer) {
  const buf = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
  if (buf.byteLength === 0) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_EMPTY,
      "Файл документа пуст."
    );
  }
  if (buf.byteLength > MAX_DOCUMENT_FILE_BYTES) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_TOO_LARGE,
      `Размер файла (${buf.byteLength} Б) превышает лимит 10 МиБ.`,
      { sizeBytes: buf.byteLength, maxBytes: MAX_DOCUMENT_FILE_BYTES }
    );
  }

  // Locate End of Central Directory (0x06054b50) searching backwards up to 65 KiB comment window
  let eocdOffset = -1;
  const minSearch = Math.max(0, buf.byteLength - 65557);
  for (let pos = buf.byteLength - 22; pos >= minSearch; pos -= 1) {
    if (buf.readUInt32LE(pos) === 0x06054b50) {
      eocdOffset = pos;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
      "Повреждённый контейнер Office OpenXML (отсутствует EOCD)."
    );
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buf.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  if (
    totalEntries > MAX_ZIP_ENTRIES ||
    centralDirOffset + centralDirSize > eocdOffset
  ) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_ZIP_BOMB_DETECTED,
      "Превышено допустимое число файлов или повреждён каталог контейнера Office."
    );
  }

  const entries = new Map();
  let totalUncompressed = 0;
  let ptr = centralDirOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (ptr + 46 > eocdOffset || buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new VaultDocumentError(
        EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
        "Повреждена запись центрального каталога ZIP."
      );
    }
    const compressionMethod = buf.readUInt16LE(ptr + 10);
    const expectedCrc = buf.readUInt32LE(ptr + 16);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);

    if (
      uncompressedSize > MAX_SINGLE_ENTRY_BYTES ||
      totalUncompressed + uncompressedSize > MAX_UNCOMPRESSED_ZIP_BYTES
    ) {
      throw new VaultDocumentError(
        EXTRACTION_ERROR_CODES.VAULT_DOC_ZIP_BOMB_DETECTED,
        "Распакованный размер документа превышает защитный предел 16 МиБ."
      );
    }

    const nameStart = ptr + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd + extraLen + commentLen > eocdOffset) {
      throw new VaultDocumentError(
        EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
        "Выход за границы буфера в имени файла ZIP."
      );
    }
    const entryName = buf.subarray(nameStart, nameEnd).toString("utf8");
    if (
      entryName.startsWith("/") ||
      entryName.includes("\\") ||
      entryName.includes("..") ||
      entryName.includes("\u0000")
    ) {
      throw new VaultDocumentError(
        EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
        "Недопустимый путь внутри контейнера Office."
      );
    }

    if (
      localHeaderOffset + 30 > centralDirOffset ||
      buf.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw new VaultDocumentError(
        EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
        "Повреждён локальный заголовок ZIP."
      );
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralDirOffset) {
      throw new VaultDocumentError(
        EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
        "Сжатые данные выходят за пределы контейнера ZIP."
      );
    }

    const rawSlice = buf.subarray(dataStart, dataEnd);
    let data;
    if (compressionMethod === 0) {
      if (compressedSize !== uncompressedSize) {
        throw new VaultDocumentError(
          EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
          "Несовпадение размера несжатой записи ZIP."
        );
      }
      data = Buffer.from(rawSlice);
    } else if (compressionMethod === 8) {
      try {
        data = zlib.inflateRawSync(rawSlice, {
          maxOutputLength: Math.min(
            MAX_SINGLE_ENTRY_BYTES,
            MAX_UNCOMPRESSED_ZIP_BYTES - totalUncompressed
          )
        });
      } catch (err) {
        if (err && err.code === "ERR_BUFFER_TOO_LARGE") {
          throw new VaultDocumentError(
            EXTRACTION_ERROR_CODES.VAULT_DOC_ZIP_BOMB_DETECTED,
            "Обнаружено превышение лимита распаковки (zip-bomb)."
          );
        }
        throw new VaultDocumentError(
          EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
          "Ошибка распаковки Deflate в контейнере Office."
        );
      }
    } else {
      throw new VaultDocumentError(
        EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
        `Неподдерживаемый метод сжатия ZIP: ${compressionMethod}.`
      );
    }

    if (data.byteLength !== uncompressedSize || crc32(data) !== expectedCrc) {
      throw new VaultDocumentError(
        EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
        `Несовпадение контрольной суммы CRC32 для "${entryName}".`
      );
    }

    totalUncompressed += data.byteLength;
    entries.set(entryName, data);
    ptr = nameEnd + extraLen + commentLen;
  }

  return entries;
}

function decodeXmlEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractDocxText(entries) {
  const docXmlBuf = entries.get("word/document.xml");
  if (!docXmlBuf) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
      "В файле .docx отсутствует word/document.xml."
    );
  }
  const xml = docXmlBuf.toString("utf8");
  const paragraphs = [];
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const inner = pMatch[1]
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n");
    const runs = [];
    const tRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|\t|\n/g;
    let tMatch;
    while ((tMatch = tRegex.exec(inner)) !== null) {
      if (tMatch[1] !== undefined) {
        runs.push(decodeXmlEntities(tMatch[1]));
      } else {
        runs.push(tMatch[0]);
      }
    }
    const line = runs.join("").trim();
    if (line) paragraphs.push(line);
  }
  return {
    format: "docx",
    sectionCount: paragraphs.length,
    sections: [
      {
        index: 1,
        label: "Документ Word",
        text: paragraphs.join("\n\n")
      }
    ],
    text: paragraphs.join("\n\n")
  };
}

function extractXlsxText(entries) {
  const sharedStrings = [];
  const ssBuf = entries.get("xl/sharedStrings.xml");
  if (ssBuf) {
    const ssXml = ssBuf.toString("utf8");
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch;
    while ((siMatch = siRegex.exec(ssXml)) !== null) {
      const parts = [];
      const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;
      let tMatch;
      while ((tMatch = tRegex.exec(siMatch[1])) !== null) {
        parts.push(decodeXmlEntities(tMatch[1]));
      }
      sharedStrings.push(parts.join(""));
    }
  }

  const sheetNames = [];
  const wbBuf = entries.get("xl/workbook.xml");
  if (wbBuf) {
    const wbXml = wbBuf.toString("utf8");
    const sheetRegex = /<sheet\b[^>]*name="([^"]+)"[^>]*\/?>/g;
    let sMatch;
    while ((sMatch = sheetRegex.exec(wbXml)) !== null) {
      sheetNames.push(decodeXmlEntities(sMatch[1]));
    }
  }

  const sheetFiles = [...entries.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const na = Number(/\d+/.exec(a)?.[0] ?? 0);
      const nb = Number(/\d+/.exec(b)?.[0] ?? 0);
      return na - nb;
    });

  if (sheetFiles.length === 0) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
      "В файле .xlsx отсутствуют листы xl/worksheets/sheet*.xml."
    );
  }

  const sections = [];
  sheetFiles.forEach((sheetPath, idx) => {
    const xml = entries.get(sheetPath).toString("utf8");
    const rows = [];
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rMatch;
    while ((rMatch = rowRegex.exec(xml)) !== null) {
      const cells = [];
      const cRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cMatch;
      while ((cMatch = cRegex.exec(rMatch[1])) !== null) {
        const attrs = cMatch[1];
        const cellBody = cMatch[2];
        const typeMatch = /\bt="([^"]+)"/.exec(attrs);
        const cellType = typeMatch ? typeMatch[1] : "n";
        if (cellType === "inlineStr") {
          const isParts = [];
          const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;
          let tMatch;
          while ((tMatch = tRegex.exec(cellBody)) !== null) {
            isParts.push(decodeXmlEntities(tMatch[1]));
          }
          cells.push(isParts.join(""));
        } else {
          const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellBody);
          const rawVal = vMatch ? decodeXmlEntities(vMatch[1].trim()) : "";
          if (cellType === "s") {
            const ssIdx = Number.parseInt(rawVal, 10);
            cells.push(sharedStrings[ssIdx] ?? rawVal);
          } else {
            cells.push(rawVal);
          }
        }
      }
      if (cells.some((c) => c !== "")) {
        rows.push(cells.join("\t"));
      }
    }
    const label = sheetNames[idx] || `Лист ${idx + 1}`;
    const body = rows.join("\n");
    sections.push({
      index: idx + 1,
      label,
      text: `[Лист: ${label}]\n${body}`.trim()
    });
  });

  return {
    format: "xlsx",
    sectionCount: sections.length,
    sections,
    text: sections.map((s) => s.text).join("\n\n")
  };
}

function extractPptxText(entries) {
  const slideFiles = [...entries.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const na = Number(/\d+/.exec(a)?.[0] ?? 0);
      const nb = Number(/\d+/.exec(b)?.[0] ?? 0);
      return na - nb;
    });

  if (slideFiles.length === 0) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE,
      "В файле .pptx отсутствуют слайды ppt/slides/slide*.xml."
    );
  }

  const sections = [];
  slideFiles.forEach((slidePath, idx) => {
    const xml = entries.get(slidePath).toString("utf8");
    const paragraphs = [];
    const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
    let pMatch;
    while ((pMatch = pRegex.exec(xml)) !== null) {
      const runs = [];
      const tRegex = /<a:t(?:\s+[^>]*)?>([\s\S]*?)<\/a:t>/g;
      let tMatch;
      while ((tMatch = tRegex.exec(pMatch[1])) !== null) {
        runs.push(decodeXmlEntities(tMatch[1]));
      }
      const line = runs.join("").trim();
      if (line) paragraphs.push(line);
    }
    const label = `Слайд ${idx + 1}`;
    sections.push({
      index: idx + 1,
      label,
      text: `[${label}]\n${paragraphs.join("\n")}`.trim()
    });
  });

  return {
    format: "pptx",
    sectionCount: sections.length,
    sections,
    text: sections.map((s) => s.text).join("\n\n")
  };
}

function decodePdfLiteralString(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i += 1;
    if (i >= raw.length) break;
    const next = raw[i];
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (/[0-7]/.test(next)) {
      let oct = next;
      if (i + 1 < raw.length && /[0-7]/.test(raw[i + 1])) {
        oct += raw[++i];
        if (i + 1 < raw.length && /[0-7]/.test(raw[i + 1])) {
          oct += raw[++i];
        }
      }
      out += String.fromCharCode(Number.parseInt(oct, 8));
    } else {
      out += next;
    }
  }
  return out;
}

function decodePdfHexString(hexRaw) {
  const clean = hexRaw.replace(/\s+/g, "");
  const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
  const buf = Buffer.from(padded, "hex");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    let str = "";
    for (let i = 2; i + 1 < buf.length; i += 2) {
      str += String.fromCharCode(buf.readUInt16BE(i));
    }
    return str;
  }
  return buf.toString("utf8");
}

function extractTextFromPdfContentStream(contentStr) {
  const lines = [];
  const btRegex = /\bBT\b([\s\S]*?)\bET\b/g;
  let btMatch;
  while ((btMatch = btRegex.exec(contentStr)) !== null) {
    const block = btMatch[1];
    const parts = [];
    const tokenRegex =
      /\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*Tj|\bT\*\b/g;
    let tok;
    while ((tok = tokenRegex.exec(block)) !== null) {
      if (tok[0] === "T*") {
        parts.push("\n");
      } else if (tok[1] !== undefined) {
        const arrStr = tok[1];
        const subRegex = /\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g;
        let sub;
        while ((sub = subRegex.exec(arrStr)) !== null) {
          if (sub[1] !== undefined) parts.push(decodePdfLiteralString(sub[1]));
          else if (sub[2] !== undefined) parts.push(decodePdfHexString(sub[2]));
        }
      } else if (tok[2] !== undefined) {
        parts.push(decodePdfLiteralString(tok[2]));
      } else if (tok[3] !== undefined) {
        parts.push(decodePdfHexString(tok[3]));
      }
    }
    const textLine = parts.join("").trim();
    if (textLine) lines.push(textLine);
  }
  return lines.join("\n");
}

function extractPdfText(rawBuffer) {
  const buf = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
  if (buf.byteLength === 0) {
    throw new VaultDocumentError(EXTRACTION_ERROR_CODES.VAULT_DOC_EMPTY, "PDF-файл пуст.");
  }
  if (buf.byteLength > MAX_DOCUMENT_FILE_BYTES) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_TOO_LARGE,
      `Размер PDF (${buf.byteLength} Б) превышает лимит 10 МиБ.`
    );
  }
  const header = buf.subarray(0, Math.min(1024, buf.byteLength)).toString("latin1");
  if (!header.includes("%PDF-")) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_PDF,
      "Файл не имеет корректного заголовка %PDF-."
    );
  }

  const latin = buf.toString("latin1");
  const sections = [];
  const streamRegex = /<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  let totalDecompressed = 0;

  while ((match = streamRegex.exec(latin)) !== null) {
    const dict = match[1];
    const bodyLatin = match[2];
    const bodyBuf = Buffer.from(bodyLatin, "latin1");
    let decodedStr = "";

    if (/\/Filter\s*(?:\[\s*)?\/FlateDecode\b/.test(dict)) {
      try {
        const inflated = zlib.inflateSync(bodyBuf, {
          maxOutputLength: Math.min(
            MAX_SINGLE_ENTRY_BYTES,
            MAX_UNCOMPRESSED_ZIP_BYTES - totalDecompressed
          )
        });
        totalDecompressed += inflated.byteLength;
        decodedStr = inflated.toString("latin1");
      } catch (err) {
        if (err && err.code === "ERR_BUFFER_TOO_LARGE") {
          throw new VaultDocumentError(
            EXTRACTION_ERROR_CODES.VAULT_DOC_ZIP_BOMB_DETECTED,
            "Превышен лимит распаковки потока PDF."
          );
        }
        continue;
      }
    } else if (!/\/Filter\b/.test(dict)) {
      decodedStr = bodyLatin;
    } else {
      continue;
    }

    if (decodedStr.includes("BT") && decodedStr.includes("ET")) {
      const extracted = extractTextFromPdfContentStream(decodedStr);
      if (extracted) {
        const idx = sections.length + 1;
        sections.push({
          index: idx,
          label: `Страница ${idx}`,
          text: `[Страница ${idx}]\n${extracted}`
        });
      }
    }
  }

  const combinedText = sections.map((s) => s.text).join("\n\n");
  return {
    format: "pdf",
    extractionStatus: combinedText.length > 0 ? "extracted" : "no_text_layer",
    sectionCount: sections.length,
    sections,
    text: combinedText
  };
}

/**
 * Extracts structured text and addressable chunks from PDF, Word (.docx),
 * Excel (.xlsx), PowerPoint (.pptx), or plain text files.
 */
function extractVaultDocument(
  rawBuffer,
  { filename = "document.txt", sliceMaxChars = DEFAULT_HANDOFF_SLICE_CHARS } = {}
) {
  const buf = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
  if (buf.byteLength === 0) {
    throw new VaultDocumentError(EXTRACTION_ERROR_CODES.VAULT_DOC_EMPTY, "Файл документа пуст.");
  }
  if (buf.byteLength > MAX_DOCUMENT_FILE_BYTES) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_TOO_LARGE,
      `Размер файла (${buf.byteLength} Б) превышает лимит 10 МиБ.`
    );
  }

  const ext = String(filename).toLowerCase().split(".").pop() || "";
  const documentSha256 = sha256Hex(buf);
  let extracted;

  if (ext === "pdf") {
    extracted = extractPdfText(buf);
  } else if (ext === "docx" || ext === "xlsx" || ext === "pptx") {
    const entries = unpackSafeZipArchive(buf);
    if (ext === "docx") extracted = extractDocxText(entries);
    else if (ext === "xlsx") extracted = extractXlsxText(entries);
    else extracted = extractPptxText(entries);
    extracted.extractionStatus = extracted.text.length > 0 ? "extracted" : "empty_document";
  } else if (
    ["txt", "md", "json", "csv", "tsv", "log", "js", "ts", "py", "css", "html"].includes(ext)
  ) {
    const text = buf.toString("utf8");
    extracted = {
      format: ext,
      extractionStatus: "extracted",
      sectionCount: 1,
      sections: [{ index: 1, label: filename, text }],
      text
    };
  } else {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_UNSUPPORTED_FORMAT,
      `Формат ".${ext}" не поддерживает локальное извлечение текста.`
    );
  }

  const effectiveSliceChars = Math.max(
    500,
    Math.min(
      Number.isSafeInteger(sliceMaxChars) ? sliceMaxChars : DEFAULT_HANDOFF_SLICE_CHARS,
      DEFAULT_HANDOFF_SLICE_CHARS
    )
  );
  const chunks = splitTextIntoAddressableChunks(extracted.text, effectiveSliceChars);

  return {
    filename,
    format: extracted.format,
    extractionStatus: extracted.extractionStatus,
    documentSha256,
    sizeBytes: buf.byteLength,
    text: extracted.text,
    totalChars: extracted.text.length,
    sectionCount: extracted.sectionCount,
    sections: extracted.sections,
    totalChunks: chunks.length,
    chunks,
    requiresChunkedHandoff: extracted.text.length > DEFAULT_HANDOFF_SLICE_CHARS
  };
}

/**
 * Splits a potentially large document text into addressable slices (<= maxChars each,
 * never exceeding 12,000 characters for chat handoff) on paragraph/line boundaries
 * without silently truncating any characters.
 */
function splitTextIntoAddressableChunks(fullText, maxChars = DEFAULT_HANDOFF_SLICE_CHARS) {
  const text = String(fullText ?? "");
  if (text.length === 0) {
    return [];
  }
  const limit = Math.max(100, Math.min(maxChars, DEFAULT_HANDOFF_SLICE_CHARS));
  const chunks = [];
  let cursor = 0;

  while (cursor < text.length) {
    let end = Math.min(cursor + limit, text.length);
    if (end < text.length) {
      const newlineBreak = text.lastIndexOf("\n", end);
      if (newlineBreak > cursor + Math.floor(limit * 0.5)) {
        end = newlineBreak + 1;
      }
    }
    const sliceText = text.slice(cursor, end);
    const chunkIndex = chunks.length + 1;
    chunks.push({
      chunkIndex,
      totalChunks: 0, // populated after loop
      charStart: cursor,
      charEnd: end,
      charLength: sliceText.length,
      sha256: sha256Hex(sliceText),
      text: sliceText
    });
    cursor = end;
  }

  for (const ch of chunks) {
    ch.totalChunks = chunks.length;
  }
  return chunks;
}

/**
 * Returns a single addressable chunk/slice of an extracted document for explicit
 * chat handoff or preview, guaranteeing the returned slice never exceeds 12,000 chars
 * and never silently drops surrounding content (includes navigation metadata).
 */
function readAddressableVaultSlice(extractedDoc, { chunkIndex = 1 } = {}) {
  if (!extractedDoc || !Array.isArray(extractedDoc.chunks)) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_SLICE_OUT_OF_RANGE,
      "Документ не содержит текстовых фрагментов для чтения."
    );
  }
  if (extractedDoc.chunks.length === 0) {
    return {
      filename: extractedDoc.filename,
      documentSha256: extractedDoc.documentSha256,
      extractionStatus: extractedDoc.extractionStatus,
      chunkIndex: 0,
      totalChunks: 0,
      charStart: 0,
      charEnd: 0,
      totalChars: 0,
      hasPrevious: false,
      hasNext: false,
      truncatedSilently: false,
      text: ""
    };
  }
  if (
    !Number.isSafeInteger(chunkIndex) ||
    chunkIndex < 1 ||
    chunkIndex > extractedDoc.chunks.length
  ) {
    throw new VaultDocumentError(
      EXTRACTION_ERROR_CODES.VAULT_DOC_SLICE_OUT_OF_RANGE,
      `Запрошенный фрагмент #${chunkIndex} выходит за диапазон 1..${extractedDoc.chunks.length}.`,
      { requestedChunk: chunkIndex, totalChunks: extractedDoc.chunks.length }
    );
  }
  const chunk = extractedDoc.chunks[chunkIndex - 1];
  return {
    filename: extractedDoc.filename,
    format: extractedDoc.format,
    documentSha256: extractedDoc.documentSha256,
    extractionStatus: extractedDoc.extractionStatus,
    chunkIndex: chunk.chunkIndex,
    totalChunks: chunk.totalChunks,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    charLength: chunk.charLength,
    totalChars: extractedDoc.totalChars,
    chunkSha256: chunk.sha256,
    hasPrevious: chunk.chunkIndex > 1,
    hasNext: chunk.chunkIndex < chunk.totalChunks,
    truncatedSilently: false,
    text: chunk.text
  };
}

module.exports = {
  DEFAULT_HANDOFF_SLICE_CHARS,
  EXTRACTION_ERROR_CODES,
  MAX_DOCUMENT_FILE_BYTES,
  MAX_UNCOMPRESSED_ZIP_BYTES,
  VaultDocumentError,
  extractPdfText,
  extractVaultDocument,
  readAddressableVaultSlice,
  splitTextIntoAddressableChunks,
  unpackSafeZipArchive
};
