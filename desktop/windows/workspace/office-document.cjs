"use strict";
// Adapted from the Gemini 2026-11-03 Word/Excel/PowerPoint buffer builders.
// Original delivery is pinned in docs/research/gemini-delivery-2026-11-03.
// Filesystem access, owner grants and confirmations belong to workspace-service.
const zlib = require("node:zlib");
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const DRAW = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PRES = "http://schemas.openxmlformats.org/presentationml/2006/main";
const formats = Object.freeze({
  workspace_create_docx: "docx",
  workspace_create_xlsx: "xlsx",
  workspace_create_pptx: "pptx"
});
const invalid = () => {
  throw Error("WORKSPACE_DOCUMENT_INVALID");
};
function text(value, max, empty = true) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    !value.isWellFormed() ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value)
  )
    invalid();
  return value;
}
function shape(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    invalid();
}
function list(value, max) {
  if (!Array.isArray(value) || !value.length || value.length > max) invalid();
}
function formula(value) {
  text(value, 256, false);
  const ref = "\\$?[A-Z]{1,3}\\$?[1-9][0-9]{0,5}";
  if (
    !new RegExp(
      "^(?:SUM|AVERAGE|MIN|MAX|COUNT)\\(" +
        ref +
        "(?::" +
        ref +
        ")?(?:," +
        ref +
        "(?::" +
        ref +
        ")?)*\\)$"
    ).test(value)
  )
    invalid();
}
function validateDocumentAction(action) {
  const format = formats[action?.kind];
  if (!format) invalid();
  const keys =
    format === "xlsx"
      ? ["kind", "path", "sheets"]
      : ["kind", "path", "title", format === "docx" ? "sections" : "slides"];
  shape(action, keys);
  text(action.path, 512, false);
  if (
    !action.path.toLowerCase().endsWith("." + format) ||
    Buffer.byteLength(JSON.stringify(action), "utf8") > 24000
  )
    invalid();
  if (format === "docx") {
    text(action.title, 180, false);
    list(action.sections, 8);
    for (const s of action.sections) {
      shape(s, ["heading", "text"]);
      text(s.heading, 180);
      text(s.text, 1600);
    }
  } else if (format === "pptx") {
    text(action.title, 180, false);
    list(action.slides, 12);
    for (const s of action.slides) {
      shape(s, ["title", "text"]);
      text(s.title, 180);
      text(s.text, 1600);
    }
  } else {
    list(action.sheets, 3);
    const names = new Set();
    for (const s of action.sheets) {
      shape(s, ["name", "rows"]);
      text(s.name, 31, false);
      if (
        /[\\/*?:\[\]]/.test(s.name) ||
        s.name.startsWith("'") ||
        s.name.endsWith("'") ||
        names.has(s.name.toLowerCase())
      )
        invalid();
      names.add(s.name.toLowerCase());
      list(s.rows, 40);
      for (const row of s.rows) {
        list(row, 10);
        for (const value of row) {
          if (value === null) continue;
          if (typeof value === "number") {
            if (
              !Number.isFinite(value) ||
              Math.abs(value) > 999999999999999 ||
              (Number.isInteger(value) && !Number.isSafeInteger(value))
            )
              invalid();
          } else if (typeof value === "string") text(value, 500);
          else {
            shape(value, ["formula"]);
            formula(value.formula);
          }
        }
      }
    }
  }
  return format;
}
function esc(v) {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(entries, { maxEntries = 100, maxExpanded = 2 * 1024 * 1024 } = {}) {
  const local = [],
    central = [];
  let offset = 0,
    total = 0;
  if (entries.length > maxEntries) invalid();
  const names = new Set();
  for (const [name, xml] of entries) {
    if (
      names.has(name) ||
      !/^\[Content_Types\]\.xml$|^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(name)
    )
      invalid();
    names.add(name);
    const bytes = Buffer.from(xml, "utf8"),
      nameBytes = Buffer.from(name),
      packed = zlib.deflateRawSync(bytes);
    total += bytes.length;
    if (total > maxExpanded) invalid();
    const h = Buffer.alloc(30 + nameBytes.length),
      c = Buffer.alloc(46 + nameBytes.length),
      crc = crc32(bytes);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt16LE(8, 8);
    h.writeUInt16LE(33, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(packed.length, 18);
    h.writeUInt32LE(bytes.length, 22);
    h.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(h, 30);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(bytes.length, 24);
    c.writeUInt16LE(nameBytes.length, 28);
    c.writeUInt32LE(offset, 42);
    nameBytes.copy(c, 46);
    local.push(h, packed);
    central.push(c);
    offset += h.length + packed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(
    central.reduce((n, c) => n + c.length, 0),
    12
  );
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
function relationships(items) {
  return (
    XML +
    `<Relationships xmlns="${REL}">` +
    items
      .map(
        ([id, type, target]) =>
          `<Relationship Id="${id}" Type="${type.startsWith("http:") ? type : OFFICE + type}" Target="${target}"/>`
      )
      .join("") +
    "</Relationships>"
  );
}
function types(items) {
  return (
    XML +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    items
      .map(
        ([name, type]) =>
          `<Override PartName="/${name}" ContentType="${type === "core-properties" ? "application/vnd.openxmlformats-package.core-properties+xml" : "application/vnd.openxmlformats-officedocument." + type + "+xml"}"/>`
      )
      .join("") +
    "</Types>"
  );
}
function word(action) {
  const p = (value, bold = false) =>
    "<w:p><w:r>" +
    (bold ? "<w:rPr><w:b/></w:rPr>" : "") +
    value
      .split(/\r\n|\r|\n/)
      .map((v) => `<w:t xml:space="preserve">${esc(v)}</w:t>`)
      .join("<w:br/>") +
    "</w:r></w:p>";
  const body =
    p(action.title, true) +
    action.sections.map((s) => (s.heading ? p(s.heading, true) : "") + p(s.text)).join("");
  return zip([
    [
      "[Content_Types].xml",
      types([
        ["word/document.xml", "wordprocessingml.document.main"],
        ["docProps/core.xml", "core-properties"]
      ])
    ],
    [
      "_rels/.rels",
      relationships([["rId1", "officeDocument", "word/document.xml"], coreRelationship()])
    ],
    ["docProps/core.xml", coreProperties(action.title)],
    [
      "word/document.xml",
      XML +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
    ]
  ]);
}
function workbook(action) {
  const entries = [],
    sheets = [],
    rels = [],
    overrides = [["xl/workbook.xml", "spreadsheetml.sheet.main"]];
  action.sheets.forEach((s, i) => {
    const num = i + 1,
      part = `xl/worksheets/sheet${num}.xml`;
    sheets.push(`<sheet name="${esc(s.name)}" sheetId="${num}" r:id="rId${num}"/>`);
    rels.push([`rId${num}`, "worksheet", `worksheets/sheet${num}.xml`]);
    overrides.push([part, "spreadsheetml.worksheet"]);
    const rows = s.rows
      .map(
        (row, r) =>
          '<row r="' +
          (r + 1) +
          '">' +
          row
            .map((value, c) => {
              const cell = String.fromCharCode(65 + c) + (r + 1);
              if (value === null) return "";
              if (typeof value === "number") return `<c r="${cell}" t="n"><v>${value}</v></c>`;
              if (typeof value === "object")
                return `<c r="${cell}"><f>${esc(value.formula)}</f></c>`;
              return `<c r="${cell}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
            })
            .join("") +
          "</row>"
      )
      .join("");
    entries.push([
      part,
      XML +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        rows +
        "</sheetData></worksheet>"
    ]);
  });
  return zip([
    ["[Content_Types].xml", types(overrides)],
    ["_rels/.rels", relationships([["rId1", "officeDocument", "xl/workbook.xml"]])],
    [
      "xl/workbook.xml",
      XML +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${OFFICE.slice(0, -1)}"><sheets>${sheets.join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`
    ],
    ["xl/_rels/workbook.xml.rels", relationships(rels)],
    ...entries
  ]);
}
function presentation(action) {
  const group =
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  const ns = `xmlns:a="${DRAW}" xmlns:r="${OFFICE.slice(0, -1)}" xmlns:p="${PRES}"`;
  const shape = (id, value, y, h, size) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="${y}"/><a:ext cx="10820400" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>` +
    value
      .split(/\r\n|\r|\n/)
      .map((v) => `<a:p><a:r><a:rPr lang="ru-RU" sz="${size}"/><a:t>${esc(v)}</a:t></a:r></a:p>`)
      .join("") +
    "</p:txBody></p:sp>";
  const entries = [],
    ids = [],
    rels = [["master", "slideMaster", "slideMasters/slideMaster1.xml"]],
    overrides = [
      ["ppt/presentation.xml", "presentationml.presentation.main"],
      ["ppt/slideMasters/slideMaster1.xml", "presentationml.slideMaster"],
      ["ppt/slideLayouts/slideLayout1.xml", "presentationml.slideLayout"],
      ["ppt/theme/theme1.xml", "theme"],
      ["docProps/core.xml", "core-properties"]
    ];
  action.slides.forEach((s, i) => {
    const num = i + 1,
      part = `ppt/slides/slide${num}.xml`;
    ids.push(`<p:sldId id="${256 + i}" r:id="rId${num}"/>`);
    rels.push([`rId${num}`, "slide", `slides/slide${num}.xml`]);
    overrides.push([part, "presentationml.slide"]);
    entries.push(
      [
        part,
        XML +
          `<p:sld ${ns}><p:cSld><p:spTree>${group}${shape(2, s.title, 365760, 914400, 3000)}${shape(3, s.text, 1463040, 4754880, 2000)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
      ],
      [
        `ppt/slides/_rels/slide${num}.xml.rels`,
        relationships([["layout", "slideLayout", "../slideLayouts/slideLayout1.xml"]])
      ]
    );
  });
  const colors =
    'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" ' +
    Array.from({ length: 6 }, (_, i) => `accent${i + 1}="accent${i + 1}"`).join(" ") +
    ' hlink="hlink" folHlink="folHlink"';
  return zip([
    ["[Content_Types].xml", types(overrides)],
    [
      "_rels/.rels",
      relationships([["rId1", "officeDocument", "ppt/presentation.xml"], coreRelationship()])
    ],
    ["docProps/core.xml", coreProperties(action.title)],
    [
      "ppt/presentation.xml",
      XML +
        `<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="master"/></p:sldMasterIdLst><p:sldIdLst>${ids.join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
    ],
    ["ppt/_rels/presentation.xml.rels", relationships(rels)],
    [
      "ppt/slideMasters/slideMaster1.xml",
      XML +
        `<p:sldMaster ${ns}><p:cSld><p:spTree>${group}</p:spTree></p:cSld><p:clrMap ${colors}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="layout"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`
    ],
    [
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      relationships([
        ["layout", "slideLayout", "../slideLayouts/slideLayout1.xml"],
        ["theme", "theme", "../theme/theme1.xml"]
      ])
    ],
    ["ppt/theme/theme1.xml", presentationTheme()],
    [
      "ppt/slideLayouts/slideLayout1.xml",
      XML +
        `<p:sldLayout ${ns} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
    ],
    [
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      relationships([["master", "slideMaster", "../slideMasters/slideMaster1.xml"]])
    ],
    ...entries
  ]);
}
function presentationTheme() {
  const palette = {
    dk1: "000000",
    lt1: "FFFFFF",
    dk2: "222222",
    lt2: "EEEEEE",
    accent1: "222222",
    accent2: "444444",
    accent3: "666666",
    accent4: "888888",
    accent5: "AAAAAA",
    accent6: "CCCCCC",
    hlink: "333333",
    folHlink: "666666"
  };
  const colors = Object.entries(palette)
    .map(([name, color]) => `<a:${name}><a:srgbClr val="${color}"/></a:${name}>`)
    .join("");
  const font = '<a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/>';
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = '<a:ln w="9525">' + fill + '<a:prstDash val="solid"/></a:ln>';
  return (
    XML +
    `<a:theme xmlns:a="${DRAW}" name="Koswork"><a:themeElements><a:clrScheme name="Koswork">${colors}</a:clrScheme><a:fontScheme name="Koswork"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme><a:fmtScheme name="Koswork"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${line.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
  );
}
function coreRelationship() {
  return [
    "metadata",
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
    "docProps/core.xml"
  ];
}
function coreProperties(title) {
  return (
    XML +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' +
    esc(title) +
    "</dc:title><dc:creator>Koswork</dc:creator></cp:coreProperties>"
  );
}
function buildOfficeDocument(action) {
  const format = validateDocumentAction(action);
  return {
    format,
    buffer:
      format === "docx" ? word(action) : format === "xlsx" ? workbook(action) : presentation(action)
  };
}
module.exports = { validateDocumentAction, buildOfficeDocument, zip, esc, formula };
