"use strict";
const assert = require("node:assert/strict");
async function runNativePdfAcceptance({ app }) {
  if (
    !app.isPackaged ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.RUNNER_ENVIRONMENT !== "github-hosted"
  )
    throw Error("PDF_ACCEPTANCE_REQUIRES_CI");
  const { BrowserWindow, session } = require("electron"),
    { createPdfReaderHost } = require("./host.cjs"),
    { sources } = require("./fixtures/independent.json");
  const host = createPdfReaderHost({ BrowserWindow, session });
  const text = await host.read({
    bytes: Buffer.from(sources[0].base64, "base64"),
    pageIndex: 0,
    mode: "auto"
  });
  for (const word of sources[0].expected) assert.ok(text.text.includes(word));
  const scan = await host.read({
    bytes: Buffer.from(sources[1].base64, "base64"),
    pageIndex: 0,
    mode: "auto"
  });
  assert.equal(scan.method, "ocr");
  for (const word of sources[1].expected)
    assert.ok(scan.text.toLowerCase().includes(word.toLowerCase()));
  return {
    transport: "packaged sandboxed Electron + private asset protocol",
    pdf_text: true,
    offline_russian_english_ocr: true,
    ocr_numbers_and_exception_preserved: true,
    owner_files: false,
    paid_model: false
  };
}
module.exports = { runNativePdfAcceptance };
