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
const fail = (reason = "UNSUPPORTED") => { throw Error("WORKSPACE_OFFICE_" + reason); };
const literal = (s) => {
  if (typeof s !== "string" || s.length > 4000 || !s.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(s)) fail("INVALID");
  return s;
};
function tree(bytes) {
  if (!bytes) fail();
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (source.startsWith("\uFEFF") || /encoding\s*=\s*['"](?!utf-8['"])/i.test(source)) fail();
  const nodes = [], stack = [];
  xml(bytes, (e) => {
    if (e.event === "open") {
      const node = { ...e, parent: stack.at(-1), children: [], text: "", end: e.tagEnd };
      node.parent?.children.push(node); nodes.push(node); stack.push(node);
    } else if (e.event === "text") {
      for (const n of stack) n.text += e.text;
    } else {
      const n = stack.pop(); n.end = e.tagEnd; n.closeStart = e.self ? n.tagEnd : e.tagStart;
    }
  }, { preserveSource: true });
  return { source, nodes };
}
const descendants = (n, uri, local) => {
  const result = [];
  const walk = (v) => { for (const c of v.children) { if (c.uri === uri && c.local === local) result.push(c); walk(c); } };
  walk(n); return result;
};
const children = (n, uri, local) => n.children.filter((c) => c.uri === uri && c.local === local);
function packageView(name, bytes) {
  const representation = extractOfficeText(name, bytes).representation;
  const { entries } = unpack(bytes, 16 * 1024 * 1024);
  // Validate even XML parts outside the text representation; never resolve resources.
  for (const [part, data] of entries) {
    if (/vbaProject|activeX|embeddings\//i.test(part)) fail();
    if (/\.(xml|rels)$/i.test(part)) xml(data, () => {});
  }
  return { entries, representation };
}
function ordered(entries, format) {
  const base = format === "xlsx" ? "xl" : "ppt";
  const root = format === "xlsx" ? "workbook.xml" : "presentation.xml";
  const rels = tree(entries.get(`${base}/_rels/${root}.rels`)).nodes;
  const refs = tree(entries.get(`${base}/${root}`)).nodes.filter((n) => n.uri === (format === "xlsx" ? S : P) && n.local === (format === "xlsx" ? "sheet" : "sldId"));
  return refs.map((n) => {
    const rel = rels.find((r) => r.uri === REL && r.local === "Relationship" && attr(r, "Id") === attr(n, "id", R));
    if (!rel || attr(rel, "TargetMode") === "External") fail();
    const part = require("node:path").posix.normalize(base + "/" + attr(rel, "Target"));
    if (!part.startsWith(base + "/") || !entries.has(part)) fail();
    return { part, name: attr(n, "name") };
  });
}
function targets(entries, format) {
  const result = [];
  if (format === "docx") {
    const part = "word/document.xml", doc = tree(entries.get(part));
    let p = 0, table = 0;
    for (const n of doc.nodes) {
      if (n.uri !== W) continue;
      if (n.local === "p") result.push({ id: `paragraph:${++p}`, part, node: n, doc, uri: W });
      if (n.local === "tbl") {
        const t = ++table;
        children(n, W, "tr").forEach((r, ri) => children(r, W, "tc").forEach((c, ci) => result.push({ id: `table:${t}/row:${ri + 1}/cell:${ci + 1}`, part, node: c, doc, uri: W })));
      }
    }
  } else if (format === "pptx") {
    ordered(entries, format).forEach(({ part }, i) => {
      const doc = tree(entries.get(part));
      for (const n of doc.nodes.filter((n) => n.uri === P && n.local === "sp")) {
        const id = descendants(n, P, "cNvPr")[0];
        if (id && descendants(n, P, "txBody").length) result.push({ id: `slide:${i + 1}/shape:${attr(id, "id")}`, part, node: n, doc, uri: A });
      }
    });
  } else {
    ordered(entries, format).forEach(({ part, name }, i) => {
      const doc = tree(entries.get(part));
      result.push({ id: `sheet:${i + 1}`, name, part, node: doc.nodes.find((n) => n.uri === S && n.local === "sheetData"), doc, uri: S });
    });
  }
  return result;
}
function inspectOffice(name, bytes) {
  const { entries, representation } = packageView(name, bytes), format = representation.format;
  const list = targets(entries, format).map((t) => format === "xlsx" ? {
    id: t.id, name: t.name, cells: descendants(t.node, S, "c").slice(0, 100).map((c) => ({ address: attr(c, "r"), type: attr(c, "t") || "n", text: c.text, formula: descendants(c, S, "f")[0]?.text ?? null }))
  } : { id: t.id, text: descendants(t.node, t.uri, "t").map((n) => n.text).join("") });
  if (list.length > 300 || Buffer.byteLength(JSON.stringify(list)) > 10000) fail("VIEW_LIMIT");
  return { ...computeBufferVersion(bytes), targets: list, representation };
}
function validateEdits(operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 40 || Buffer.byteLength(JSON.stringify(operations)) > 16000) fail("INVALID");
  for (const op of operations) {
    if (!op || typeof op !== "object" || Array.isArray(op)) fail("INVALID");
    const keys = op.kind === "replace_text" ? ["kind", "target", "find", "replace"] : op.kind === "set_cell" ? ["kind", "target", "address", "value"] : op.kind === "add_sheet" ? ["kind", "name"] : [];
    if (!keys.length || Object.keys(op).length !== keys.length || keys.some((k) => !Object.hasOwn(op, k))) fail("INVALID");
    if (op.kind === "replace_text") { literal(op.target); literal(op.find); literal(op.replace); if (!op.find) fail("INVALID"); }
    if (op.kind === "add_sheet") {
      buildOfficeDocument({ kind: "workspace_create_xlsx", path: "validate.xlsx", sheets: [{ name: op.name, rows: [[null]] }] });
    }
    if (op.kind === "set_cell") {
      if (!/^sheet:[1-9][0-9]{0,2}$/.test(op.target) || !/^[A-Z]{1,3}[1-9][0-9]{0,5}$/.test(op.address)) fail("INVALID");
      const col = op.address.match(/^[A-Z]+/)[0].split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
      if (col > 16384) fail("INVALID");
      buildOfficeDocument({ kind: "workspace_create_xlsx", path: "validate.xlsx", sheets: [{ name: "Data", rows: [[op.value]] }] });
    }
  }
}
function replaceText(t, op) {
  // Refuse fields, revisions and complex selected objects before writing.
  if (t.doc.nodes.some((n) => n.tagStart >= t.node.tagStart && n.end <= t.node.end && ["fldChar", "instrText", "del", "ins", "drawing", "object", "graphicFrame", "tab", "br", "cr"].includes(n.local))) fail();
  const runs = descendants(t.node, t.uri, "t");
  const full = runs.map((n) => n.text).join("");
  const start = full.indexOf(op.find);
  if (start < 0 || full.indexOf(op.find, start + 1) >= 0) fail("AMBIGUOUS_TEXT");
  let offset = 0; const patches = [];
  for (const n of runs) {
    const a = Math.max(start, offset), b = Math.min(start + op.find.length, offset + n.text.length);
    if (a < b) {
      if (n.self || n.children.length || /[\r\n\t]/.test(op.replace)) fail();
      const value = n.text.slice(0, a - offset) + (a === start ? op.replace : "") + n.text.slice(b - offset);
      // Preserve run/style nodes and whitespace semantics.
      const opening = t.doc.source.slice(n.tagStart, n.tagEnd).replace(/\s+xml:space\s*=\s*(?:"[^"]*"|'[^']*')/, "").replace(/>$/, ' xml:space="preserve">');
      patches.push([n.tagStart, n.closeStart, opening + esc(value)]);
    }
    offset += n.text.length;
  }
  let source = t.doc.source;
  for (const [a, b, value] of patches.reverse()) source = source.slice(0, a) + value + source.slice(b);
  return { source, before: full, after: full.slice(0, start) + op.replace + full.slice(start + op.find.length) };
}
function setCell(t, op) {
  if (!t.node || t.node.self) fail();
  // Conservative: merged/shared/array formula structures require dedicated handling.
  if (t.doc.nodes.some((n) => ["mergeCell", "tablePart", "extLst"].includes(n.local)) || t.doc.nodes.some((n) => n.local === "f" && n.attrs.size)) fail();
  const cell = descendants(t.node, S, "c").find((c) => attr(c, "r") === op.address);
  const prefix = t.node.qname.includes(":") ? t.node.qname.split(":")[0] + ":" : "";
  const tag = (n, text, attrs = "") => `<${prefix}${n}${attrs}>${text}</${prefix}${n}>`;
  const v = op.value;
  let body = "", type = "";
  if (typeof v === "number") { type = ' t="n"'; body = tag("v", String(v)); }
  else if (typeof v === "string") { type = ' t="inlineStr"'; body = tag("is", tag("t", esc(v), ' xml:space="preserve"')); }
  else if (v !== null) { formula(v.formula); body = tag("f", esc(v.formula)); }
  const style = cell && attr(cell, "s") !== undefined ? ` s="${esc(attr(cell, "s"))}"` : "";
  const replacement = tag("c", body, ` r="${op.address}"${style}${type}`);
  let source = t.doc.source;
  if (cell) {
    if (cell.children.some((n) => n.uri !== S || !["v", "f", "is"].includes(n.local)) || [...cell.attrs.keys()].some((k) => !["{}r", "{}s", "{}t"].includes(k))) fail();
    source = source.slice(0, cell.tagStart) + replacement + source.slice(cell.end);
  } else {
    const rowNum = Number(op.address.match(/\d+/)[0]);
    const row = children(t.node, S, "row").find((n) => Number(attr(n, "r")) === rowNum);
    const col = (address) => address.match(/^[A-Z]+/)[0].split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    if (row) {
      if (row.self) fail();
      const next = children(row, S, "c").find((n) => col(attr(n, "r")) > col(op.address));
      const at = next?.tagStart ?? row.closeStart;
      source = source.slice(0, at) + replacement + source.slice(at);
    } else {
      const next = children(t.node, S, "row").find((n) => Number(attr(n, "r")) > rowNum);
      const at = next?.tagStart ?? t.node.closeStart;
      source = source.slice(0, at) + tag("row", replacement, ` r="${rowNum}"`) + source.slice(at);
    }
  }
  // Existing dimension/calculation chains can become stale; refuse rather than silently corrupt.
  if (t.doc.nodes.some((n) => n.local === "dimension") && !cell) fail();
  return { source, before: cell?.text ?? null, after: v };
}
function addSheet(entries, name) {
  const sheets = ordered(entries, "xlsx");
  if (sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) fail("INVALID");
  const book = tree(entries.get("xl/workbook.xml"));
  const rel = tree(entries.get("xl/_rels/workbook.xml.rels"));
  const types = tree(entries.get("[Content_Types].xml"));
  const id = 1 + Math.max(0, ...book.nodes.filter((n) => n.local === "sheet").map((n) => Number(attr(n, "sheetId"))));
  let num = 1; while (entries.has(`xl/worksheets/sheet${num}.xml`)) num++;
  const part = `xl/worksheets/sheet${num}.xml`, rid = `koswork${id}`;
  if (rel.nodes.some((n) => attr(n, "Id") === rid)) fail();
  const insert = (doc, node, value) => {
    if (!node || node.self) fail();
    return doc.source.slice(0, node.closeStart) + value + doc.source.slice(node.closeStart);
  };
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  entries.set("xl/workbook.xml", Buffer.from(insert(book, book.nodes.find((n) => n.uri === S && n.local === "sheets"), `<sheet ${ns} xmlns:r="${R}" name="${esc(name)}" sheetId="${id}" r:id="${rid}"/>`)));
  entries.set("xl/_rels/workbook.xml.rels", Buffer.from(insert(rel, rel.nodes[0], `<Relationship xmlns="${REL}" Id="${rid}" Type="${R}/worksheet" Target="worksheets/sheet${num}.xml"/>`)));
  entries.set("[Content_Types].xml", Buffer.from(insert(types, types.nodes[0], `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)));
  entries.set(part, Buffer.from(`<worksheet ${ns}><sheetData></sheetData></worksheet>`));
}
function editOffice(name, bytes, operations) {
  validateEdits(operations);
  const { entries, representation } = packageView(name, bytes), format = representation.format;
  if (entries.has("xl/calcChain.xml") || [...entries.keys()].some((p) => p.startsWith("_xmlsignatures/"))) fail();
  const diff = [];
  for (const op of operations) {
    if (op.kind === "add_sheet") {
      if (format !== "xlsx") fail(); addSheet(entries, op.name); diff.push({ ...op, before: null, after: op.name }); continue;
    }
    const t = targets(entries, format).find((t) => t.id === op.target);
    if (!t) fail("TARGET_NOT_FOUND");
    if ((format === "xlsx") !== (op.kind === "set_cell")) fail();
    const result = op.kind === "replace_text" ? replaceText(t, op) : setCell(t, op);
    entries.set(t.part, Buffer.from(result.source));
    diff.push({ ...op, before: result.before, after: result.after });
  }
  const buffer = zip([...entries], { maxEntries: 1000, maxExpanded: 16 * 1024 * 1024 });
  const readback = extractOfficeText(name, buffer);
  return { buffer, diff, representation: readback.representation, ...computeBufferVersion(buffer) };
}
module.exports = { inspectOffice, editOffice, validateEdits };
