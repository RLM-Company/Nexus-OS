"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const SCHEME = "kosmora-document",
  ORIGIN = SCHEME + "://reader";
function registerDocumentScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ]);
}
function assetPath(url, root, manifest) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== SCHEME + ":" || u.host !== "reader" || u.username || u.password || u.search)
    return null;
  const key = u.pathname.slice(1);
  if (
    !["index.html", "reader.js", "ocr-layout.mjs"].includes(key) &&
    !(key.startsWith("vendor/") && Object.hasOwn(manifest.files, key.slice(7)))
  )
    return null;
  return path.join(root, ...key.split("/"));
}
function validateResult(result, pageIndex) {
  if (
    !result ||
    typeof result !== "object" ||
    typeof result.text !== "string" ||
    !result.text.isWellFormed() ||
    result.text.length > 180000 ||
    result.page_index !== pageIndex ||
    !Number.isInteger(result.page_count) ||
    result.page_count < 1 ||
    result.page_count > 2000 ||
    pageIndex >= result.page_count ||
    !["pdf_text", "ocr"].includes(result.method) ||
    typeof result.needs_ocr !== "boolean" ||
    typeof result.text_clipped !== "boolean" ||
    (result.confidence !== null &&
      (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 100))
  )
    throw Error("PDF_RESULT_INVALID");
  return {
    text: result.text,
    page_index: pageIndex,
    page_count: result.page_count,
    method: result.method,
    confidence: result.confidence,
    needs_ocr: result.needs_ocr,
    text_clipped: result.text_clipped
  };
}
function createPdfReaderHost({ BrowserWindow, session, root = __dirname, timeoutMs = 60000 }) {
  let busy = false;
  const available = () => fs.existsSync(path.join(root, "assets-manifest.json"));
  async function read({ bytes, pageIndex, mode, signal }) {
    if (signal?.aborted) throw Error("PDF_CANCELLED");
    if (busy) throw Error("PDF_READER_BUSY");
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length > 26214400 ||
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex > 1999 ||
      !["auto", "text", "ocr"].includes(mode) ||
      !available()
    )
      throw Error("PDF_ARGUMENT_INVALID");
    busy = true;
    let win, timer, abort, partition;
    try {
      partition = session.fromPartition("document-" + randomUUID());
      const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets-manifest.json"), "utf8"));
      partition.setPermissionRequestHandler((_w, _p, cb) => cb(false));
      partition.setPermissionCheckHandler(() => false);
      partition.webRequest.onBeforeRequest(
        { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*", "file://*/*"] },
        (_d, cb) => cb({ cancel: true })
      );
      partition.protocol.handle(SCHEME, (request) => {
        const file = request.method === "GET" && assetPath(request.url, root, manifest);
        if (!file) return new Response("", { status: 403 });
        const ext = path.extname(file),
          type =
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".mjs": "text/javascript",
              ".wasm": "application/wasm"
            }[ext] || "application/octet-stream";
        try {
          return new Response(fs.readFileSync(file), {
            headers: { "content-type": type, "cache-control": "no-store" }
          });
        } catch {
          return new Response("", { status: 404 });
        }
      });
      win = new BrowserWindow({
        show: false,
        focusable: false,
        webPreferences: {
          session: partition,
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          backgroundThrottling: false
        }
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      win.webContents.on("will-attach-webview", (e) => e.preventDefault());
      partition.on("will-download", (e) => e.preventDefault());
      const interrupted = new Promise((_, reject) => {
        abort = () => reject(Error("PDF_CANCELLED"));
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => reject(Error("PDF_TIMEOUT")), timeoutMs);
        timer.unref?.();
        win.webContents.once("render-process-gone", () => reject(Error("PDF_RENDERER_STOPPED")));
      });
      const job = (async () => {
        await win.loadURL(ORIGIN + "/index.html");
        if (signal?.aborted) throw Error("PDF_CANCELLED");
        const args = { base64: bytes.toString("base64"), pageIndex, mode };
        return validateResult(
          await win.webContents.executeJavaScript(
            "window.kosmoraReadPdf(" + JSON.stringify(args) + ")"
          ),
          pageIndex
        );
      })();
      return await Promise.race([job, interrupted]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (win && !win.isDestroyed()) win.destroy();
      partition?.protocol.unhandle(SCHEME);
      await partition?.clearStorageData().catch(() => {});
      busy = false;
    }
  }
  return { read, available };
}
module.exports = { registerDocumentScheme, createPdfReaderHost, assetPath, validateResult };
