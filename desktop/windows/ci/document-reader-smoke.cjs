"use strict";
// Real PDF.js/Tesseract in disposable headless Chromium; synthetic files only.
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { chromium } = require(
  path.resolve(__dirname, "../../../apps/web/node_modules/@playwright/test")
);
const { sources } = require("../document-reader/fixtures/independent.json");
async function run() {
  const root = path.resolve(__dirname, "../document-reader");
  const server = http.createServer((req, res) => {
    const key = new URL(req.url, "http://localhost").pathname;
    const target = path.resolve(root, "." + key);
    if (!target.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const data = fs.readFileSync(target);
      res.setHeader(
        "content-type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".wasm": "application/wasm"
        }[path.extname(target)] || "application/octet-stream"
      );
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true }),
    page = await browser.newPage({ viewport: { width: 900, height: 700 } }),
    external = [];
  try {
    await page.route("**/*", (route) => {
      if (
        !route
          .request()
          .url()
          .startsWith(origin + "/")
      ) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    page.on("console", (m) => {
      if (m.type() === "error") process.stderr.write(m.text() + "\n");
    });
    await page.goto(origin + "/index.html");
    await page.waitForFunction(() => typeof window.kosmoraReadPdf === "function");
    const start = Date.now();
    const text = await page.evaluate((args) => window.kosmoraReadPdf(args), {
      base64: sources[0].base64,
      pageIndex: 0,
      mode: "auto"
    });
    assert.equal(text.method, "pdf_text");
    assert.equal(text.page_count, 2);
    for (const word of sources[0].expected) assert.ok(text.text.includes(word), word);
    const second = await page.evaluate((args) => window.kosmoraReadPdf(args), {
      base64: sources[0].base64,
      pageIndex: 1,
      mode: "text"
    });
    assert.ok(second.text.includes("00456"));
    const before = await page.evaluate((args) => window.kosmoraReadPdf(args), {
      base64: sources[1].base64,
      pageIndex: 0,
      mode: "text"
    });
    assert.equal(before.text, "");
    assert.equal(before.needs_ocr, true);
    const scan = await page.evaluate((args) => window.kosmoraReadPdf(args), {
      base64: sources[1].base64,
      pageIndex: 0,
      mode: "auto"
    });
    assert.equal(scan.method, "ocr");
    for (const word of sources[1].expected)
      assert.ok(
        scan.text.toLowerCase().includes(word.toLowerCase()),
        "OCR omitted " + word + ": " + scan.text
      );
    assert.deepEqual(external, []);
    if (process.env.KOSWORK_PDF_PREVIEW) {
      await page.evaluate(async (base64) => {
        const p = await import("./vendor/pdf/pdf.mjs");
        const task = p.getDocument({
          data: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
          isEvalSupported: false
        });
        const doc = await task.promise;
        const pg = await doc.getPage(1),
          v = pg.getViewport({ scale: 1 });
        const c = document.createElement("canvas");
        c.width = v.width;
        c.height = v.height;
        document.body.append(c);
        await pg.render({ canvasContext: c.getContext("2d"), viewport: v }).promise;
        await task.destroy();
      }, sources[0].base64);
      await page.locator("canvas").screenshot({ path: process.env.KOSWORK_PDF_PREVIEW });
    }
    console.log(
      JSON.stringify({
        status: "passed",
        engine: "real Chromium PDF.js + Tesseract WASM",
        pdf_pages_verified: 2,
        scan_ocr: scan.text,
        ocr_confidence: scan.confidence,
        elapsed_ms: Date.now() - start,
        external_requests: external.length,
        paid_model_calls: 0,
        owner_desktop_input: false
      })
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
