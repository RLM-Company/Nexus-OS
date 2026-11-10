"use strict";
// Bounded OpenXML edits. No Office automation, model, network or formula evaluator.
const { unpack, xml, attr, extractOfficeText } = require("./office-text.cjs");
const { zip, esc, formula, buildOfficeDocument } = require("./office-document.cjs");
const { computeBufferVersion } = require("./version-backup.cjs");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const fail = (reason = "UNSUPPORTED") => {
  throw Error("WORKSPACE_OFFICE_" + reason);
};
const literal = (s) => {
  if (
    typeof s !== "string" ||
    s.length > 4000 ||
    !s.isWellFormed() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(s)
  )
    fail("INVALID");
  return s;
};
function tree(bytes) {
  if (!bytes) fail();
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  const source = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  const bom =
    encoding === "utf-8"
      ? bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
        ? bytes.subarray(0, 3)
        : Buffer.alloc(0)
      : bytes.subarray(0, 2);
  const encode = (value) => {
    let output = Buffer.from(value, encoding === "utf-8" ? "utf8" : "utf16le");
    if (encoding === "utf-16be") output = output.swap16();
    return Buffer.concat([bom, output]);
  };
  const nodes = [],
    stack = [];
  xml(
    bytes,
    (e) => {
      if (e.event === "open") {
        const node = { ...e, parent: stack.at(-1), children: [], text: "", end: e.tagEnd };
        node.parent?.children.push(node);
        nodes.push(node);
        stack.push(node);
      } else if (e.event === "text") {
        for (const n of stack) n.text += e.text;
      } else {
        const n = stack.pop();
        n.end = e.tagEnd;
        n.closeStart = e.self ? n.tagEnd : e.tagStart;
      }
    },
    { preserveSource: true }
  );
  return { source, nodes, encode };
}
const descendants = (n, uri, local) => {
  const result = [];
  const walk = (v) => {
    for (const c of v.children) {
      if (c.uri === uri && c.local === local) result.push(c);
      walk(c);
    }
  };
  walk(n);
  return result;
};
const children = (n, uri, local) => n.children.filter((c) => c.uri === uri && c.local === local);
function packageView(name, bytes) {
  const representation = extractOfficeText(name, bytes, { allowEmpty: true }).representation;
  const { entries } = unpack(bytes, 16 * 1024 * 1024);
  let signed = false;
  // Validate even XML parts outside the text representation; never resolve resources.
  for (const [part, data] of entries) {
    if (/vbaProject|activeX|embeddings\//i.test(part)) fail();
    if (/\.(xml|rels)$/i.test(part))
      xml(data, (e) => {
        if (e.event !== "open") return;
        if (
          (part === "[Content_Types].xml" &&
            e.uri === "http://schemas.openxmlformats.org/package/2006/content-types" &&
            ["Default", "Override"].includes(e.local) &&
            (attr(e, "ContentType") || "").startsWith(
              "application/vnd.openxmlformats-package.digital-signature-"
            )) ||
          (/\.rels$/i.test(part) &&
            e.uri === REL &&
            e.local === "Relationship" &&
            (attr(e, "Type") || "").startsWith(REL + "/digital-signature/"))
        )
          signed = true;
      });
  }
  return { entries, representation, signed };
}
function ordered(entries, format) {
  const base = format === "xlsx" ? "xl" : "ppt";
  const root = format === "xlsx" ? "workbook.xml" : "presentation.xml";
  const rels = tree(entries.get(`${base}/_rels/${root}.rels`)).nodes;
  const refs = tree(entries.get(`${base}/${root}`)).nodes.filter(
    (n) =>
      n.uri === (format === "xlsx" ? S : P) && n.local === (format === "xlsx" ? "sheet" : "sldId")
  );
  return refs.map((n) => {
    const rel = rels.find(
      (r) => r.uri === REL && r.local === "Relationship" && attr(r, "Id") === attr(n, "id", R)
    );
    if (!rel || attr(rel, "TargetMode") === "External") fail();
    const part = require("node:path")
      .posix.resolve("/" + base, attr(rel, "Target"))
      .slice(1);
    if (!part.startsWith(base + "/") || !entries.has(part)) fail();
    return { part, name: attr(n, "name") };
  });
}
function targets(entries, format) {
  const result = [];
  if (format === "docx") {
    const part = "word/document.xml",
      doc = tree(entries.get(part));
    let p = 0,
      table = 0;
    for (const n of doc.nodes) {
      if (n.uri !== W) continue;
      if (n.local === "p") result.push({ id: `paragraph:${++p}`, part, node: n, doc, uri: W });
      if (n.local === "tbl") {
        const t = ++table;
        result.push({ id: `table:${t}`, part, node: n, doc, uri: W });
        children(n, W, "tr").forEach((r, ri) =>
          children(r, W, "tc").forEach((c, ci) =>
            result.push({
              id: `table:${t}/row:${ri + 1}/cell:${ci + 1}`,
              part,
              node: c,
              doc,
              uri: W
            })
          )
        );
      }
    }
  } else if (format === "pptx") {
    ordered(entries, format).forEach(({ part }, i) => {
      const doc = tree(entries.get(part));
      for (const n of doc.nodes.filter((n) => n.uri === P && n.local === "sp")) {
        const id = descendants(n, P, "cNvPr")[0];
        if (id && descendants(n, P, "txBody").length)
          result.push({ id: `slide:${i + 1}/shape:${attr(id, "id")}`, part, node: n, doc, uri: A });
      }
    });
  } else {
    ordered(entries, format).forEach(({ part, name }, i) => {
      const doc = tree(entries.get(part));
      result.push({
        id: `sheet:${i + 1}`,
        name,
        part,
        node: doc.nodes.find((n) => n.uri === S && n.local === "sheetData"),
        doc,
        uri: S
      });
    });
  }
  return result;
}
function spreadsheetStrings(entries) {
  const rel = tree(entries.get("xl/_rels/workbook.xml.rels")).nodes.find(
    (n) => n.uri === REL && n.local === "Relationship" && attr(n, "Type") === R + "/sharedStrings"
  );
  if (!rel) return [];
  const part = require("node:path").posix.resolve("/xl", attr(rel, "Target")).slice(1);
  return tree(entries.get(part))
    .nodes.filter((n) => n.uri === S && n.local === "si")
    .map((n) =>
      descendants(n, S, "t")
        .filter((t) => {
          for (let p = t.parent; p !== n; p = p.parent) if (p.local === "rPh") return false;
          return true;
        })
        .map((t) => t.text)
        .join("")
    );
}
function inspectOffice(name, bytes, { cursor, expectedVersion = null, path: sourcePath } = {}) {
  const version = computeBufferVersion(bytes);
  if (expectedVersion !== null && expectedVersion !== version.version) fail("VERSION_CONFLICT");
  if (cursor && (cursor.target_offset > 0 || cursor.content_offset > 0) && expectedVersion === null)
    fail("VERSION_CONFLICT");
  const { entries, representation } = packageView(name, bytes),
    format = representation.format;
  const strings = format === "xlsx" ? spreadsheetStrings(entries) : [];
  const all = targets(entries, format);
  if (new Set(all.map((t) => t.id)).size !== all.length) fail();
  const project = (t) =>
    format === "xlsx"
      ? {
          id: t.id,
          name: t.name,
          total_cells: descendants(t.node, S, "c").length,
          cells_excerpt_only: false,
          cells: descendants(t.node, S, "c").map((c) => ({
            address: attr(c, "r"),
            type: attr(c, "t") || "n",
            text:
              attr(c, "t") === "s"
                ? strings[Number(children(c, S, "v")[0]?.text)]
                : attr(c, "t") === "inlineStr"
                  ? descendants(c, S, "t")
                      .map((n) => n.text)
                      .join("")
                  : (children(c, S, "v")[0]?.text ?? ""),
            cached_value: descendants(c, S, "f").length
              ? children(c, S, "v")[0]?.text || null
              : null,
            formula: descendants(c, S, "f")[0]?.text ?? null
          }))
        }
      : {
          id: t.id,
          text: descendants(t.node, t.uri, "t")
            .map((n) => n.text)
            .join("")
        };
  const cache = new Map();
  return require("./office-view.cjs").pageOfficeView(
    { ...version, representation, ...(sourcePath !== undefined ? { path: sourcePath } : {}) },
    {
      length: all.length,
      get(i) {
        if (!cache.has(i)) cache.set(i, project(all[i]));
        return cache.get(i);
      }
    },
    cursor
  );
}
function validateEdits(operations) {
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > 40 ||
    Buffer.byteLength(JSON.stringify(operations)) > 16000
  )
    fail("INVALID");
  const expandedCount = operations.reduce(
    (n, op) =>
      n +
      (op?.kind === "set_range" && Array.isArray(op.rows)
        ? op.rows.reduce((sum, row) => sum + (Array.isArray(row) ? row.length : 0), 0)
        : 1),
    0
  );
  if (expandedCount > 100) fail("INVALID");
  for (const op of operations) {
    if (!op || typeof op !== "object" || Array.isArray(op)) fail("INVALID");
    const keys =
      op.kind === "replace_text"
        ? ["kind", "target", "find", "replace"]
        : op.kind === "set_cell"
          ? ["kind", "target", "address", "value"]
          : op.kind === "add_sheet"
            ? ["kind", "name"]
            : op.kind === "set_range"
              ? ["kind", "target", "start", "rows"]
              : [];
    if (
      !keys.length ||
      Object.keys(op).length !== keys.length ||
      keys.some((k) => !Object.hasOwn(op, k))
    )
      fail("INVALID");
    if (op.kind === "set_range") {
      if (
        !Array.isArray(op.rows) ||
        !op.rows.length ||
        op.rows.length > 10 ||
        op.rows.some((r) => !Array.isArray(r) || !r.length || r.length > 10)
      )
        fail("INVALID");
      for (const cell of rangeCells(op)) validateEdits([cell]);
    }
    if (op.kind === "replace_text") {
      literal(op.target);
      literal(op.find);
      literal(op.replace);
      if (!op.find) fail("INVALID");
    }
    if (op.kind === "add_sheet") {
      buildOfficeDocument({
        kind: "workspace_create_xlsx",
        path: "validate.xlsx",
        sheets: [{ name: op.name, rows: [[null]] }]
      });
    }
    if (op.kind === "set_cell") {
      if (
        !/^sheet:[1-9][0-9]{0,2}$/.test(op.target) ||
        !/^[A-Z]{1,3}[1-9][0-9]{0,5}$/.test(op.address)
      )
        fail("INVALID");
      const col = op.address
        .match(/^[A-Z]+/)[0]
        .split("")
        .reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
      if (col > 16384) fail("INVALID");
      if (typeof op.value !== "boolean")
        buildOfficeDocument({
          kind: "workspace_create_xlsx",
          path: "validate.xlsx",
          sheets: [{ name: "Data", rows: [[op.value]] }]
        });
    }
  }
}
function rangeCells(op) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,5})$/.exec(op.start);
  if (!match) fail("INVALID");
  const col = match[1].split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const label = (n) => {
    let s = "";
    for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  return op.rows.flatMap((row, r) =>
    row.map((value, c) => ({
      kind: "set_cell",
      target: op.target,
      address: label(col + c) + (Number(match[2]) + r),
      value
    }))
  );
}
function replaceText(t, op) {
  // Refuse fields, revisions and complex selected objects before writing.
  if (
    t.doc.nodes.some(
      (n) =>
        n.tagStart >= t.node.tagStart &&
        n.end <= t.node.end &&
        [
          "fld",
          "fldChar",
          "fldSimple",
          "sdt",
          "instrText",
          "del",
          "ins",
          "drawing",
          "object",
          "graphicFrame",
          "tab",
          "br",
          "cr"
        ].includes(n.local)
    )
  )
    fail();
  const runs = descendants(t.node, t.uri, "t");
  const full = runs.map((n) => n.text).join("");
  const start = full.indexOf(op.find);
  if (start < 0 || full.indexOf(op.find, start + 1) >= 0) fail("AMBIGUOUS_TEXT");
  const paragraph = (n) => {
    while (n && !(n.uri === t.uri && n.local === "p")) n = n.parent;
    return n;
  };
  let selectedParagraph = null;
  for (let n = t.node; n; n = n.parent)
    if (["del", "ins", "fldSimple", "sdt"].includes(n.local)) fail();
  let offset = 0;
  const patches = [];
  for (const n of runs) {
    const a = Math.max(start, offset),
      b = Math.min(start + op.find.length, offset + n.text.length);
    if (a < b) {
      const p = paragraph(n);
      if (!p || (selectedParagraph && selectedParagraph !== p)) fail();
      selectedParagraph = p;
      if (
        n.self ||
        n.children.length ||
        t.doc.source.slice(n.tagEnd, n.closeStart).includes("<") ||
        /[\r\n\t]/.test(op.replace)
      )
        fail();
      const value =
        n.text.slice(0, a - offset) + (a === start ? op.replace : "") + n.text.slice(b - offset);
      // Preserve run/style nodes and whitespace semantics.
      const opening = t.doc.source
        .slice(n.tagStart, n.tagEnd)
        .replace(/\s+xml:space\s*=\s*(?:"[^"]*"|'[^']*')/, "")
        .replace(/>$/, ' xml:space="preserve">');
      patches.push([n.tagStart, n.closeStart, opening + esc(value)]);
    }
    offset += n.text.length;
  }
  let source = t.doc.source;
  for (const [a, b, value] of patches.reverse())
    source = source.slice(0, a) + value + source.slice(b);
  return {
    source,
    before: full,
    after: full.slice(0, start) + op.replace + full.slice(start + op.find.length)
  };
}
function coordinate(address) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(address);
  if (!match) fail();
  const col = match[1].split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0),
    row = Number(match[2]);
  if (col > 16384 || row > 1048576) fail();
  return { col, row };
}
function columnName(col) {
  let value = "";
  for (; col > 0; col = Math.floor((col - 1) / 26))
    value = String.fromCharCode(65 + ((col - 1) % 26)) + value;
  return value;
}
function applyPatches(source, patches) {
  const sorted = [...patches].sort((a, b) => b.start - a.start);
  let previous = source.length;
  for (const p of sorted) {
    if (p.start < 0 || p.end < p.start || p.end > previous) fail();
    source = source.slice(0, p.start) + p.value + source.slice(p.end);
    previous = p.start;
  }
  return source;
}
function expandEmpty(doc, node, value) {
  if (!node.self) fail();
  return {
    start: node.tagStart,
    end: node.end,
    value:
      doc.source.slice(node.tagStart, node.tagEnd).replace(/\/\s*>$/, ">") +
      value +
      `</${node.qname}>`
  };
}
function dimensionPatch(t, address) {
  const dimensions = t.doc.nodes.filter((n) => n.uri === S && n.local === "dimension");
  if (!dimensions.length) return null;
  if (dimensions.length !== 1) fail();
  const node = dimensions[0],
    ref = attr(node, "ref");
  if (!ref || ref.split(":").length > 2) fail();
  const [a, b = a] = ref.split(":"),
    first = coordinate(a),
    last = coordinate(b),
    target = coordinate(address);
  if (first.col > last.col || first.row > last.row) fail();
  const start = columnName(Math.min(first.col, target.col)) + Math.min(first.row, target.row);
  const end = columnName(Math.max(last.col, target.col)) + Math.max(last.row, target.row);
  const next = start === end ? start : start + ":" + end;
  if (next === ref) return null;
  const opening = t.doc.source.slice(node.tagStart, node.tagEnd);
  if (!/\sref\s*=\s*(?:"[^"<>]*"|'[^'<>]*')/.test(opening)) fail();
  return {
    start: node.tagStart,
    end: node.tagEnd,
    value: opening.replace(
      /(\sref\s*=\s*)(?:"[^"<>]*"|'[^'<>]*')/,
      (_, prefix) => prefix + '"' + next + '"'
    )
  };
}
function cellValue(cell, strings) {
  if (!cell) return null;
  const formula = descendants(cell, S, "f")[0],
    raw = children(cell, S, "v")[0]?.text ?? "";
  if (formula) return { formula: formula.text, cached_value: raw || null };
  const type = attr(cell, "t") || "n";
  if (type === "s") return strings[Number(raw)];
  if (type === "inlineStr")
    return descendants(cell, S, "t")
      .map((n) => n.text)
      .join("");
  return raw;
}
function setCell(t, op, strings) {
  if (!t.node) fail();
  // Merged/shared/array formula structures still require dedicated handling.
  if (
    t.doc.nodes.some((n) => ["mergeCell", "tablePart", "extLst"].includes(n.local)) ||
    t.doc.nodes.some((n) => n.local === "f" && n.attrs.size)
  )
    fail();
  const existingCells = descendants(t.node, S, "c"),
    rows = children(t.node, S, "row");
  if (
    new Set(existingCells.map((c) => attr(c, "r"))).size !== existingCells.length ||
    new Set(rows.map((r) => attr(r, "r"))).size !== rows.length
  )
    fail();
  if (
    t.node.children.some((n) => n.uri !== S || n.local !== "row") ||
    rows.reduce((n, row) => n + children(row, S, "c").length, 0) !== existingCells.length
  )
    fail();
  let lastRow = 0;
  for (const row of rows) {
    const value = attr(row, "r");
    if (!/^[1-9][0-9]{0,6}$/.test(value) || Number(value) <= lastRow || Number(value) > 1048576)
      fail();
    lastRow = Number(value);
    let lastCol = 0;
    for (const cell of children(row, S, "c")) {
      const c = coordinate(attr(cell, "r"));
      if (c.row !== lastRow || c.col <= lastCol) fail();
      lastCol = c.col;
    }
  }
  const cell = existingCells.find((c) => attr(c, "r") === op.address),
    position = coordinate(op.address);
  const prefix = t.node.qname.includes(":") ? t.node.qname.split(":")[0] + ":" : "";
  const tag = (name, value, attrs = "") => `<${prefix}${name}${attrs}>${value}</${prefix}${name}>`;
  const value = op.value;
  let body = "",
    type = "";
  if (typeof value === "boolean") {
    type = ' t="b"';
    body = tag("v", value ? "1" : "0");
  } else if (typeof value === "number") {
    type = ' t="n"';
    body = tag("v", String(value));
  } else if (typeof value === "string") {
    type = ' t="inlineStr"';
    body = tag("is", tag("t", esc(value), ' xml:space="preserve"'));
  } else if (value !== null) {
    formula(value.formula);
    body = tag("f", esc(value.formula));
  }
  const style = cell && attr(cell, "s") !== undefined ? ` s="${esc(attr(cell, "s"))}"` : "";
  const selectedRow = rows.find((n) => Number(attr(n, "r")) === position.row);
  const inherited = (cell?.parent ?? selectedRow ?? t.node).namespaces.get(
    prefix ? prefix.slice(0, -1) : ""
  );
  const namespace =
    inherited === S ? "" : ` xmlns${prefix ? ":" + prefix.slice(0, -1) : ""}="${S}"`;
  const replacement = tag("c", body, ` r="${op.address}"${style}${type}${namespace}`),
    patches = [];
  if (cell) {
    if (
      cell.children.some((n) => n.uri !== S || !["v", "f", "is"].includes(n.local)) ||
      [...cell.attrs.keys()].some((k) => !["{}r", "{}s", "{}t"].includes(k))
    )
      fail();
    patches.push({ start: cell.tagStart, end: cell.end, value: replacement });
  } else {
    const row = rows.find((n) => Number(attr(n, "r")) === position.row);
    if (row?.self) patches.push(expandEmpty(t.doc, row, replacement));
    else if (row) {
      const next = children(row, S, "c").find((n) => coordinate(attr(n, "r")).col > position.col),
        at = next?.tagStart ?? row.closeStart;
      patches.push({ start: at, end: at, value: replacement });
    } else {
      const newRow = tag("row", replacement, ` r="${position.row}"`);
      if (t.node.self) patches.push(expandEmpty(t.doc, t.node, newRow));
      else {
        const next = rows.find((n) => Number(attr(n, "r")) > position.row),
          at = next?.tagStart ?? t.node.closeStart;
        patches.push({ start: at, end: at, value: newRow });
      }
    }
  }
  const dimension = dimensionPatch(t, op.address);
  if (dimension) patches.push(dimension);
  return {
    source: applyPatches(t.doc.source, patches),
    before: cellValue(cell, strings),
    after: value
  };
}
function addSheet(entries, name) {
  const sheets = ordered(entries, "xlsx");
  if (sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) fail("INVALID");
  const book = tree(entries.get("xl/workbook.xml"));
  const rel = tree(entries.get("xl/_rels/workbook.xml.rels"));
  const types = tree(entries.get("[Content_Types].xml"));
  const sheetIds = book.nodes
    .filter((n) => n.uri === S && n.local === "sheet")
    .map((n) => attr(n, "sheetId"));
  if (
    new Set(sheetIds).size !== sheetIds.length ||
    sheetIds.some((id) => !/^[1-9][0-9]{0,9}$/.test(id) || Number(id) >= 2147483647)
  )
    fail();
  const id = 1 + Math.max(0, ...sheetIds.map(Number));
  let num = 1;
  while (entries.has(`xl/worksheets/sheet${num}.xml`)) num++;
  const part = `xl/worksheets/sheet${num}.xml`;
  const usedIds = new Set(
    rel.nodes.filter((n) => n.uri === REL && n.local === "Relationship").map((n) => attr(n, "Id"))
  );
  let rid = `koswork${id}`,
    suffix = 0;
  while (usedIds.has(rid)) rid = `koswork${id}_${++suffix}`;
  const insert = (doc, node, value) => {
    if (!node || node.self) fail();
    return doc.source.slice(0, node.closeStart) + value + doc.source.slice(node.closeStart);
  };
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  entries.set(
    "xl/workbook.xml",
    book.encode(
      insert(
        book,
        book.nodes.find((n) => n.uri === S && n.local === "sheets"),
        `<sheet ${ns} xmlns:r="${R}" name="${esc(name)}" sheetId="${id}" r:id="${rid}"/>`
      )
    )
  );
  entries.set(
    "xl/_rels/workbook.xml.rels",
    rel.encode(
      insert(
        rel,
        rel.nodes[0],
        `<Relationship xmlns="${REL}" Id="${rid}" Type="${R}/worksheet" Target="worksheets/sheet${num}.xml"/>`
      )
    )
  );
  entries.set(
    "[Content_Types].xml",
    types.encode(
      insert(
        types,
        types.nodes[0],
        `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
    )
  );
  entries.set(part, Buffer.from(`<worksheet ${ns}><sheetData></sheetData></worksheet>`));
}
function editOffice(name, bytes, operations) {
  validateEdits(operations);
  const { entries, representation, signed } = packageView(name, bytes),
    format = representation.format;
  if (
    signed ||
    entries.has("xl/calcChain.xml") ||
    [...entries.keys()].some((p) => p.toLowerCase().startsWith("_xmlsignatures/"))
  )
    fail();
  const diff = [];
  for (const op of operations.flatMap((op) => (op.kind === "set_range" ? rangeCells(op) : [op]))) {
    if (op.kind === "add_sheet") {
      if (format !== "xlsx") fail();
      addSheet(entries, op.name);
      diff.push({ ...op, before: null, after: op.name });
      continue;
    }
    const t = targets(entries, format).find((t) => t.id === op.target);
    if (!t) fail("TARGET_NOT_FOUND");
    if ((format === "xlsx") !== (op.kind === "set_cell")) fail();
    const result =
      op.kind === "replace_text" ? replaceText(t, op) : setCell(t, op, spreadsheetStrings(entries));
    entries.set(t.part, t.doc.encode(result.source));
    diff.push({ ...op, before: result.before, after: result.after });
  }
  if (Buffer.byteLength(JSON.stringify(diff)) > 10000) fail("VIEW_LIMIT");
  const buffer = zip([...entries], { maxEntries: 1000, maxExpanded: 16 * 1024 * 1024 });
  const readback = extractOfficeText(name, buffer);
  return { buffer, diff, representation: readback.representation, ...computeBufferVersion(buffer) };
}
module.exports = { inspectOffice, editOffice, validateEdits };
