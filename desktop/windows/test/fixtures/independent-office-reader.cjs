"use strict";
// Independent OOXML reader for acceptance verification. Deliberately does NOT
// use the production engine: parses the ZIP central directory with zlib and
// extracts text with a separate regex-based walker. Used only by tests.
const zlib = require("node:zlib");
const { createHash } = require("node:crypto");

function readZip(bytes) {
  if (!Buffer.isBuffer(bytes)) throw Error("INDEPENDENT_READER_INVALID");
  const entries = new Map();
  // Scan local file headers from the start; production reader uses the central
  // directory, so this is an independent code path over the same bytes.
  let at = 0;
  while (at + 30 <= bytes.length && bytes.readUInt32LE(at) === 0x04034b50) {
    const flags = bytes.readUInt16LE(at + 6);
    const method = bytes.readUInt16LE(at + 8);
    const packed = bytes.readUInt32LE(at + 18);
    const nameLength = bytes.readUInt16LE(at + 26);
    const extraLength = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const start = at + 30 + nameLength + extraLength;
    const end = start + packed;
    if (end > bytes.length) throw Error("INDEPENDENT_READER_TRUNCATED");
    let data;
    try {
      data =
        method === 0 ? bytes.subarray(start, end) : zlib.inflateRawSync(bytes.subarray(start, end));
    } catch {
      throw Error("INDEPENDENT_READER_DEFLATE");
    }
    entries.set(name, data);
    // Data-descriptor ZIP entries are not produced by the engine; refuse them.
    if (flags & 8) throw Error("INDEPENDENT_READER_DESCRIPTOR");
    at = end;
  }
  if (!entries.size) throw Error("INDEPENDENT_READER_EMPTY");
  return entries;
}

function xmlText(bytes) {
  // Strip tags and decode the five XML entities; sufficient for text readback.
  const source = bytes.toString("utf8").replace(/^\ufeff/, "");
  return source
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function readOffice(name, bytes) {
  const format = name.toLowerCase().split(".").pop();
  if (!["docx", "xlsx", "pptx"].includes(format)) throw Error("INDEPENDENT_READER_FORMAT");
  const entries = readZip(bytes);
  const main = entries.get(
    format === "docx"
      ? "word/document.xml"
      : format === "xlsx"
        ? "xl/workbook.xml"
        : "ppt/presentation.xml"
  );
  if (!main) throw Error("INDEPENDENT_READER_MAIN_PART");
  const cells = new Map();
  if (format === "xlsx") {
    const shared = entries.get("xl/sharedStrings.xml");
    const strings = shared
      ? [...shared.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
          xmlText(Buffer.from(m[1]))
        )
      : [];
    for (const [part, data] of entries) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(part)) continue;
      const sheet = Number(/sheet(\d+)\.xml$/.exec(part)[1]);
      const xml = data.toString("utf8");
      for (const m of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const address = /\br="([A-Z]+\d+)"/.exec(m[1])?.[1];
        const type = /\bt="([^"]+)"/.exec(m[1])?.[1] ?? "n";
        const raw = /<v>([\s\S]*?)<\/v>/.exec(m[2])?.[1] ?? "";
        const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(m[2])?.[1] ?? "";
        const formula = /<f>([\s\S]*?)<\/f>/.exec(m[2])?.[1] ?? null;
        const value = type === "s" ? strings[Number(raw)] : type === "inlineStr" ? inline : raw;
        if (address) cells.set(`${sheet}!${address}`, { value, formula });
      }
    }
  }
  const text = [...entries.entries()]
    .filter(([part]) => /\.(xml)$/.test(part))
    .map(([, data]) => xmlText(data))
    .join("\n");
  return {
    format,
    entries: [...entries.keys()],
    text,
    cells,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

module.exports = { readOffice, readZip, xmlText };
