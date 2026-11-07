"use strict";
// Adapted from Gemini's vault-document-extractor/archive inspector. Memory-only:
// no filesystem extraction, DTD, external entities, relationships fetch or Office.
const zlib = require("node:zlib"),
  path = require("node:path"),
  { createHash } = require("node:crypto");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  P = "http://schemas.openxmlformats.org/presentationml/2006/main",
  A = "http://schemas.openxmlformats.org/drawingml/2006/main",
  R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const invalid = () => {
  throw Error("VAULT_DOCUMENT_INVALID");
};
const utf8 = (b) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    invalid();
  }
};
const hash = (b) => createHash("sha256").update(b).digest("hex");
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function unpack(bytes, workLimit) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > 10 * 1024 * 1024) invalid();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) invalid();
  const count = bytes.readUInt16LE(end + 10),
    start = bytes.readUInt32LE(end + 16),
    size = bytes.readUInt32LE(end + 12);
  if (
    bytes.readUInt32LE(end + 4) !== 0 ||
    count !== bytes.readUInt16LE(end + 8) ||
    !count ||
    count > 1000 ||
    start + size !== end
  )
    invalid();
  const entries = new Map(),
    names = new Set(),
    ranges = [];
  let at = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) invalid();
    const flags = bytes.readUInt16LE(at + 8),
      method = bytes.readUInt16LE(at + 10),
      crc = bytes.readUInt32LE(at + 16),
      packed = bytes.readUInt32LE(at + 20),
      length = bytes.readUInt32LE(at + 24),
      n = bytes.readUInt16LE(at + 28),
      extra = bytes.readUInt16LE(at + 30),
      comment = bytes.readUInt16LE(at + 32),
      offset = bytes.readUInt32LE(at + 42);
    if (
      flags & ~0x080e ||
      ![0, 8].includes(method) ||
      bytes.readUInt16LE(at + 34) !== 0 ||
      length > 8 * 1024 * 1024 ||
      (total += length) > workLimit ||
      at + 46 + n + extra + comment > end ||
      !n
    )
      invalid();
    const nameBytes = bytes.subarray(at + 46, at + 46 + n),
      name = utf8(nameBytes),
      key = name.normalize("NFC").toLowerCase();
    if (
      /[\\:\u0000-\u001f]/.test(name) ||
      name.startsWith("/") ||
      name.split("/").some((p) => p === ".." || p === ".") ||
      names.has(key) ||
      ((bytes.readUInt32LE(at + 38) >>> 16) & 0o170000) === 0o120000 ||
      /\.(?:exe|dll|com|bat|cmd|ps1|vbs|scr|lnk)$/i.test(name)
    )
      invalid();
    names.add(key);
    if (
      offset + 30 > start ||
      bytes.readUInt32LE(offset) !== 0x04034b50 ||
      bytes.readUInt16LE(offset + 6) !== flags ||
      bytes.readUInt16LE(offset + 8) !== method
    )
      invalid();
    const localName = bytes.readUInt16LE(offset + 26),
      localExtra = bytes.readUInt16LE(offset + 28),
      data = offset + 30 + localName + localExtra;
    if (
      data + packed > start ||
      localName !== n ||
      !bytes.subarray(offset + 30, offset + 30 + n).equals(nameBytes)
    )
      invalid();
    if (
      !(flags & 8) &&
      (bytes.readUInt32LE(offset + 14) !== crc ||
        bytes.readUInt32LE(offset + 18) !== packed ||
        bytes.readUInt32LE(offset + 22) !== length)
    )
      invalid();
    let dataEnd = data + packed;
    if (flags & 8) {
      if (dataEnd + 12 > start) invalid();
      if (bytes.readUInt32LE(dataEnd) === 0x08074b50) dataEnd += 4;
      if (
        dataEnd + 12 > start ||
        bytes.readUInt32LE(dataEnd) !== crc ||
        bytes.readUInt32LE(dataEnd + 4) !== packed ||
        bytes.readUInt32LE(dataEnd + 8) !== length
      )
        invalid();
      dataEnd += 12;
    }
    ranges.push([offset, dataEnd]);
    let output;
    try {
      output =
        method === 0
          ? Buffer.from(bytes.subarray(data, data + packed))
          : zlib.inflateRawSync(bytes.subarray(data, data + packed), {
              maxOutputLength: Math.max(1, length)
            });
    } catch {
      invalid();
    }
    if (output.length !== length || crc32(output) !== crc) invalid();
    if (!name.endsWith("/")) entries.set(name, output);
    at += 46 + n + extra + comment;
  }
  if (at !== end) invalid();
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) invalid();
  return { entries, expanded: total };
}
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const xmlName = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
function entities(value) {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(value)) invalid();
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (_, v) => {
    if (v[0] !== "#") return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[v];
    const n = v[1] === "x" ? parseInt(v.slice(2), 16) : Number(v.slice(1));
    if (
      !Number.isInteger(n) ||
      n > 0x10ffff ||
      n === 0 ||
      (n >= 0xd800 && n <= 0xdfff) ||
      (n < 32 && ![9, 10, 13].includes(n)) ||
      n === 0xfffe ||
      n === 0xffff
    )
      invalid();
    return String.fromCodePoint(n);
  });
}
// Small fail-closed event reader for XML data, not an entity-resolving parser.
// Prefixes resolve by namespace URI. Unknown encodings/declarations are refused.
function xml(bytes, visit, { preserveSource = false } = {}) {
  if (!bytes) invalid();
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  let decoded;
  try {
    decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    invalid();
  }
  let source = preserveSource ? decoded : decoded.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"),
    at = 0,
    events = 0,
    roots = 0;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]/u.test(source)) invalid();
  const stack = [];
  const text = (value) => {
    if (!stack.length) {
      if (value.trim()) invalid();
    } else visit({ event: "text", text: value }, stack);
  };
  while (at < source.length) {
    if (++events > 200000) invalid();
    if (source[at] !== "<") {
      const next = source.indexOf("<", at),
        end = next < 0 ? source.length : next;
      text(entities(source.slice(at, end)));
      at = end;
      continue;
    }
    if (source.startsWith("<!--", at)) {
      const end = source.indexOf("-->", at + 4);
      if (end < 0 || source.slice(at + 4, end).includes("--")) invalid();
      at = end + 3;
      continue;
    }
    if (source.startsWith("<?", at)) {
      const end = source.indexOf("?>", at + 2);
      if (
        end < 0 ||
        at !== 0 ||
        !/^(?:<\?xml\s)[\s\S]*\?>$/.test(source.slice(at, end + 2)) ||
        /encoding\s*=\s*['"](?!UTF-8['"]|UTF-16(?:LE|BE)?['"])/i.test(source.slice(at, end))
      )
        invalid();
      const declared = source
        .slice(at, end)
        .match(/encoding\s*=\s*['"]([^'"]+)['"]/i)?.[1]
        ?.toLowerCase();
      if (
        declared &&
        (declared === "utf-8"
          ? encoding !== declared
          : declared === "utf-16"
            ? encoding === "utf-8"
            : declared !== encoding)
      )
        invalid();
      at = end + 2;
      continue;
    }
    if (source.startsWith("<![CDATA[", at)) {
      const end = source.indexOf("]]>", at + 9);
      if (end < 0) invalid();
      text(source.slice(at + 9, end));
      at = end + 3;
      continue;
    }
    if (source.startsWith("<!", at)) invalid();
    const tagStart = at;
    let end = at + 1,
      quote = "";
    for (; end < source.length; end++) {
      const c = source[end];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (end === source.length || end - at > 32768) invalid();
    let body = source.slice(at + 1, end);
    at = end + 1;
    if (body.startsWith("/")) {
      const name = body.slice(1).trim(),
        e = stack.at(-1);
      if (!e || name !== e.qname) invalid();
      visit({ ...e, event: "close", tagStart, tagEnd: at }, stack);
      stack.pop();
      continue;
    }
    const self = /\/\s*$/.test(body);
    if (self) body = body.replace(/\/\s*$/, "");
    const match = body.match(xmlName);
    if (!match || stack.length >= 128) invalid();
    const qname = match[0],
      rawAttrs = new Map();
    let rest = body.slice(qname.length);
    while (rest.trim()) {
      const attr = rest.match(/^\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/);
      if (!attr || rawAttrs.has(attr[1])) invalid();
      rawAttrs.set(attr[1], entities(attr[2] ?? attr[3]));
      rest = rest.slice(attr[0].length);
    }
    const namespaces = new Map(stack.at(-1)?.namespaces || [["xml", XML_NS]]);
    for (const [k, v] of rawAttrs)
      if (k === "xmlns") namespaces.set("", v);
      else if (k.startsWith("xmlns:")) namespaces.set(k.slice(6), v);
    const expand = (name, isAttr = false) => {
      const pieces = name.split(":");
      if (pieces.length > 2) invalid();
      const prefix = pieces.length === 2 ? pieces[0] : "",
        local = pieces.at(-1);
      const uri = prefix ? namespaces.get(prefix) : isAttr ? "" : namespaces.get("") || "";
      if (prefix && !uri) invalid();
      return { local, uri, key: "{" + uri + "}" + local };
    };
    const expanded = expand(qname),
      attrs = new Map();
    for (const [k, v] of rawAttrs) {
      if (k === "xmlns" || k.startsWith("xmlns:")) continue;
      const key = expand(k, true).key;
      if (attrs.has(key)) invalid();
      attrs.set(key, v);
    }
    if (!stack.length && ++roots !== 1) invalid();
    const e = { qname, ...expanded, attrs, namespaces, tagStart, tagEnd: at, self };
    stack.push(e);
    visit({ ...e, event: "open" }, stack);
    if (self) {
      visit({ ...e, event: "close" }, stack);
      stack.pop();
    }
  }
  if (stack.length || roots !== 1) invalid();
}
const attr = (e, name, uri = "") => e.attrs.get("{" + uri + "}" + name);
function extractOfficeText(name, bytes, { workLimit = 16 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(workLimit) || workLimit < 0) invalid();
  const format = String(name).toLowerCase().split(".").at(-1);
  if (!["docx", "xlsx", "pptx"].includes(format)) invalid();
  const { entries, expanded } = unpack(bytes, Math.min(16 * 1024 * 1024, Math.max(0, workLimit)));
  let output = "";
  const append = (value) => {
    if (output.length + value.length > 256000) throw Error("VAULT_DOCUMENT_TEXT_LIMIT");
    output += value;
  };
  const parse = (part, fn) => xml(entries.get(part), fn);
  const mainParts = {
    docx: ["/word/document.xml", "wordprocessingml.document.main"],
    xlsx: ["/xl/workbook.xml", "spreadsheetml.sheet.main"],
    pptx: ["/ppt/presentation.xml", "presentationml.presentation.main"]
  };
  let contentType = false;
  parse("[Content_Types].xml", (e) => {
    if (
      e.event !== "open" ||
      e.uri !== "http://schemas.openxmlformats.org/package/2006/content-types" ||
      e.local !== "Override"
    )
      return;
    if (/macroEnabled|vbaProject/i.test(attr(e, "ContentType") || "")) invalid();
    if (
      attr(e, "PartName") === mainParts[format][0] &&
      attr(e, "ContentType") ===
        "application/vnd.openxmlformats-officedocument." + mainParts[format][1] + "+xml"
    )
      contentType = true;
  });
  if (!contentType) invalid();
  const orderedParts = (rootPart, local, expectedType) => {
    const base = path.posix.dirname(rootPart),
      rels = new Map(),
      result = [];
    parse(base + "/_rels/" + path.posix.basename(rootPart) + ".rels", (e) => {
      if (e.event !== "open" || e.uri !== REL || e.local !== "Relationship") return;
      const id = attr(e, "Id"),
        target = attr(e, "Target"),
        type = attr(e, "Type");
      if (!id || rels.has(id) || !target) invalid();
      rels.set(id, { target, type, external: attr(e, "TargetMode") === "External" });
    });
    parse(rootPart, (e) => {
      if (e.event !== "open" || e.local !== local || e.uri !== (format === "xlsx" ? S : P)) return;
      const rel = rels.get(attr(e, "id", R));
      if (!rel || rel.external || rel.type !== R + "/" + expectedType || /[\\:#?]/.test(rel.target))
        invalid();
      const part = path.posix.resolve("/" + base, rel.target).slice(1);
      if (!part.startsWith(base + "/") || !entries.has(part)) invalid();
      result.push({ part, name: attr(e, "name") });
    });
    if (!result.length || result.length > 500) invalid();
    return { parts: result, rels, base };
  };
  if (format === "docx") {
    parse("word/document.xml", (e, stack) => {
      if (
        e.event === "text" &&
        stack.some((s) => s.uri === W && s.local === "t") &&
        !stack.some((s) => s.uri === W && s.local === "del")
      )
        append(e.text);
      else if (e.uri === W && e.event === "open" && ["tab", "br", "cr"].includes(e.local))
        append(e.local === "tab" ? "\t" : "\n");
      else if (e.uri === W && e.event === "close" && ["p", "tr", "tc"].includes(e.local))
        append(e.local === "tc" ? "\t" : "\n");
    });
  } else if (format === "pptx") {
    const { parts } = orderedParts("ppt/presentation.xml", "sldId", "slide");
    parts.forEach(({ part }, i) => {
      append("[Slide " + (i + 1) + "]\n");
      parse(part, (e, stack) => {
        if (e.event === "text" && stack.at(-1)?.uri === A && stack.at(-1)?.local === "t")
          append(e.text);
        else if (e.event === "close" && e.uri === A && e.local === "p") append("\n");
      });
    });
  } else {
    const { parts, rels, base } = orderedParts("xl/workbook.xml", "sheet", "worksheet"),
      strings = [];
    const shared = [...rels.values()].find((r) => r.type === R + "/sharedStrings");
    if (shared) {
      if (shared.external || /[\\:#?]/.test(shared.target)) invalid();
      const part = path.posix.resolve("/" + base, shared.target).slice(1);
      if (!part.startsWith(base + "/")) invalid();
      let value = "",
        chars = 0;
      parse(part, (e, stack) => {
        if (e.event === "open" && e.uri === S && e.local === "si") value = "";
        if (
          e.event === "text" &&
          stack.at(-1)?.uri === S &&
          stack.at(-1)?.local === "t" &&
          !stack.some((s) => s.local === "rPh" && s.uri === S)
        ) {
          value += e.text;
          chars += e.text.length;
          if (chars > 256000) invalid();
        }
        if (e.event === "close" && e.uri === S && e.local === "si") {
          if (strings.length >= 20000) invalid();
          strings.push(value);
        }
      });
    }
    for (const { part, name: sheet } of parts) {
      append("[Sheet " + sheet + "]\n");
      let cell = null,
        cells = 0;
      parse(part, (e, stack) => {
        if (e.event === "open" && e.uri === S && e.local === "c") {
          if (cell || ++cells > 20000) invalid();
          cell = {
            ref: attr(e, "r"),
            type: attr(e, "t") || "n",
            value: "",
            formula: "",
            hasFormula: false,
            inline: ""
          };
        }
        if (e.event === "open" && cell && e.uri === S && e.local === "f") cell.hasFormula = true;
        if (e.event === "text" && cell && stack.at(-1)?.uri === S) {
          const local = stack.at(-1).local;
          if (local === "v") cell.value += e.text;
          else if (local === "f") cell.formula += e.text;
          else if (local === "t") cell.inline += e.text;
        }
        if (e.event === "close" && e.uri === S && e.local === "c") {
          if (!cell || !/^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/.test(cell.ref)) invalid();
          let value = cell.type === "inlineStr" ? cell.inline : cell.value;
          if (cell.type === "s") {
            if (!/^\d+$/.test(value) || strings[Number(value)] === undefined) invalid();
            value = strings[Number(value)];
          }
          append(
            cell.ref +
              "\t" +
              JSON.stringify(
                cell.hasFormula
                  ? { formula: cell.formula, cached_value: cell.value || null }
                  : { type: cell.type, value }
              ) +
              "\n"
          );
          cell = null;
        }
      });
    }
  }
  if (!output.trim()) throw Error("VAULT_DOCUMENT_NO_TEXT");
  return {
    text: output,
    expanded_bytes: expanded,
    representation: {
      kind: "office_text",
      format,
      version: "openxml-text-v1",
      complete_document: false,
      sha256: hash(output),
      limitations: [
        "Text extraction only; images, charts, formatting, notes and headers are not included. Formulas are not evaluated; numeric/date cells retain stored values."
      ]
    }
  };
}
module.exports = { extractOfficeText, unpack, xml, attr };
