"use strict";
// Reproducible native filesystem acceptance for encoding, dimensions and paged reads.
// Uses generated fixture data only. No provider, shell tool or Office automation is exposed.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { zip } = require("../../workspace/office-document.cjs");
const { unpack, extractOfficeText } = require("../../workspace/office-text.cjs");
const { createKosworkWorkspaceService } = require("../../workspace/workspace-service.cjs");
const { input, docxFixture, ops } = require("./office-edit-brief.cjs");
const { pagedWord } = require("./office-paged-brief.cjs");
function encodedSource(format, encoding) {
  const entries = unpack(format === "docx" ? docxFixture() : input(format), 16000000).entries;
  if (format === "xlsx")
    entries.set(
      "xl/worksheets/sheet1.xml",
      Buffer.from(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><cols><col min="1" max="4" width="25" customWidth="1"/></cols><sheetData/></worksheet>'
      )
    );
  for (const [part, bytes] of entries)
    if (/\.(xml|rels)$/.test(part)) {
      const source = bytes.toString().replace(/encoding="UTF-8"/, 'encoding="UTF-16"');
      const body = Buffer.from(source, "utf16le");
      if (encoding === "utf16be") body.swap16();
      entries.set(
        part,
        Buffer.concat([Buffer.from(encoding === "utf16be" ? [0xfe, 0xff] : [0xff, 0xfe]), body])
      );
    }
  return zip([...entries]);
}
async function main() {
  const directory = path.resolve(process.argv[2] || "work/office-expanded-acceptance");
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "office-expanded-"));
  const service = createKosworkWorkspaceService({
    userDataPath: profile,
    requireOwnerScope: true,
    codec: {
      seal: (s) => Buffer.from(s).toString("base64"),
      open: (s) => Buffer.from(s, "base64").toString()
    }
  });
  const auth = { ownerId: "fixture-owner", origin: "https://fixture.example.test" },
    receipts = [];
  try {
    await service.connectFolder({ ...auth, folderPath: directory });
    for (const format of ["docx", "xlsx", "pptx"]) {
      const encoding = format === "pptx" ? "utf16le" : "utf16be",
        name = `${encoding}.${format}`,
        source = encodedSource(format, encoding);
      fs.writeFileSync(path.join(directory, name), source, { flag: "wx" });
      const opened = service.inspectOfficeDocument({ ...auth, relativePath: name });
      const operations =
        format !== "xlsx"
          ? ops[format]
          : [
              {
                kind: "set_range",
                target: "sheet:1",
                start: "A1",
                rows: [
                  ["Артикул", "Цена", "Дата", "Условие"],
                  ["00123", 19700, "07.11.2026", "кроме доставки"],
                  ["Итого", { formula: "SUM(B2:B2)" }, null, null]
                ]
              }
            ];
      const options = {
        ...auth,
        relativePath: name,
        expectedVersion: opened.version,
        outputPath: `${encoding}.updated.${format}`,
        operations
      };
      const preview = service.previewOfficeDocument(options),
        saved = await service.commitOfficeDocument({ ...options, planId: preview.plan_id });
      const text = extractOfficeText(
        saved.path,
        fs.readFileSync(path.join(directory, saved.path))
      ).text;
      for (const value of [
        "00123",
        "07.11.2026",
        "кроме доставки",
        format === "xlsx" ? "19700" : "19 700"
      ])
        if (!text.includes(value)) throw Error("READBACK_LITERAL_MISSING");
      if (!fs.readFileSync(path.join(directory, name)).equals(source))
        throw Error("SOURCE_CHANGED");
      fs.writeFileSync(
        path.join(directory, `${format}.readback.json`),
        JSON.stringify({ text }, null, 2) + "\n"
      );
      receipts.push({
        format,
        encoding,
        path: saved.path,
        source_version: opened.version,
        version: saved.version,
        sha256: saved.sha256,
        diff: preview.diff,
        readback: saved.readback,
        model_called: false
      });
    }
    const source = pagedWord(),
      name = "paged.docx";
    fs.writeFileSync(path.join(directory, name), source.buffer, { flag: "wx" });
    let cursor,
      version,
      pageCount = 0,
      maximumBytes = 0;
    const rebuilt = new Map();
    do {
      const page = service.inspectOfficeDocument({
        ...auth,
        relativePath: name,
        cursor,
        expectedVersion: version ?? null
      });
      version ??= page.version;
      pageCount++;
      maximumBytes = Math.max(maximumBytes, Buffer.byteLength(JSON.stringify(page)));
      for (const target of page.targets)
        rebuilt.set(target.id, (rebuilt.get(target.id) || "") + target.text);
      cursor = page.next_cursor;
    } while (cursor);
    source.texts.forEach((text, index) => {
      if (rebuilt.get(`paragraph:${index + 1}`) !== text) throw Error("PAGE_INTEGRITY_FAILED");
    });
    if (maximumBytes > 10000) throw Error("PAGE_BUDGET_EXCEEDED");
    const options = {
      ...auth,
      relativePath: name,
      expectedVersion: version,
      outputPath: "paged.updated.docx",
      operations: [
        {
          kind: "replace_text",
          target: `paragraph:${source.texts.length}`,
          find: "Раздел 420",
          replace: "Новый раздел 420"
        }
      ]
    };
    const preview = service.previewOfficeDocument(options),
      saved = await service.commitOfficeDocument({ ...options, planId: preview.plan_id });
    const text = extractOfficeText(
      saved.path,
      fs.readFileSync(path.join(directory, saved.path))
    ).text;
    if (!text.includes("Новый раздел 420")) throw Error("LATE_TARGET_NOT_CHANGED");
    if (!fs.readFileSync(path.join(directory, name)).equals(source.buffer))
      throw Error("SOURCE_CHANGED");
    receipts.push({
      format: "paged_docx",
      path: saved.path,
      source_version: version,
      version: saved.version,
      sha256: saved.sha256,
      diff: preview.diff,
      page_count: pageCount,
      maximum_page_bytes: maximumBytes,
      exact_text_rebuilt: true,
      readback: saved.readback,
      model_called: false
    });
    fs.writeFileSync(
      path.join(directory, "results.json"),
      JSON.stringify(receipts, null, 2) + "\n"
    );
    console.log(
      JSON.stringify({
        directory,
        native_files_written: receipts.length,
        paged_read_verified: true,
        maximum_page_bytes: maximumBytes,
        model_called: false
      })
    );
  } finally {
    await service.revokeAccess(auth);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
