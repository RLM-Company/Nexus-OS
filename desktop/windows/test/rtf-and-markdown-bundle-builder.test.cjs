"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  saveTriFormatBundleToWorkspace
} = require("../workspace/rtf-and-markdown-bundle-builder.cjs");

test("Tri-Format Document Compiler generates valid RTF 1.9.1 with Unicode Cyrillic escapes, Markdown, and Plain Text", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-rtf-"));
  try {
    const saved = saveTriFormatBundleToWorkspace(tempDir, "kosmora-executive-brief", {
      title: "Отчёт по ядру Kosmora OS",
      sections: [
        {
          heading: "1. Изоляция акторов и саги",
          paragraphs: [
            "Все распределённые транзакции защищены компенсирующими действиями LIFO."
          ]
        }
      ]
    });

    assert.equal(fs.existsSync(saved.rtfPath), true);
    assert.equal(fs.existsSync(saved.mdPath), true);
    assert.equal(fs.existsSync(saved.txtPath), true);

    const rtf = fs.readFileSync(saved.rtfPath, "utf8");
    const md = fs.readFileSync(saved.mdPath, "utf8");

    assert.ok(rtf.startsWith("{\\rtf1\\ansi"));
    assert.ok(rtf.includes("\\u1054?")); // Cyrillic 'О' = 1054
    assert.ok(md.includes("# Отчёт по ядру Kosmora OS"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
