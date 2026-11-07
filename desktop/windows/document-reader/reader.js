import { getDocument, GlobalWorkerOptions } from "./vendor/pdf/pdf.mjs";
import { layoutFromWords, collectOcrWords } from "./ocr-layout.mjs";
GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf/pdf.worker.mjs", import.meta.url).href;
const base = new URL("./vendor/", import.meta.url).href;
const MAX_TEXT = 180000,
  MAX_PIXELS = 4000000;
window.kosmoraReadPdf = async function ({ base64, pageIndex, mode }) {
  if (
    typeof base64 !== "string" ||
    base64.length > 34952540 ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex > 1999 ||
    !["auto", "text", "ocr"].includes(mode)
  )
    throw Error("PDF_ARGUMENT_INVALID");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const loading = getDocument({
    data: bytes,
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: true,
    cMapUrl: base + "pdf/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: base + "pdf/standard_fonts/",
    wasmUrl: base + "pdf/wasm/",
    maxImageSize: 16000000,
    canvasMaxAreaInBytes: MAX_PIXELS * 4,
    stopAtErrors: true
  });
  let doc, worker;
  try {
    doc = await loading.promise;
    if (doc.numPages > 2000 || pageIndex >= doc.numPages) throw Error("PDF_PAGE_RANGE_INVALID");
    const page = await doc.getPage(pageIndex + 1),
      content = await page.getTextContent();
    let text = "",
      textClipped = false,
      layout = null;
    for (const item of content.items) {
      if (!Object.hasOwn(item, "str")) continue;
      const chunk = item.str + (item.hasEOL ? "\n" : " ");
      if (text.length + chunk.length > MAX_TEXT) {
        textClipped = true;
        break;
      }
      text += chunk;
    }
    text = text.trim();
    let method = "pdf_text",
      confidence = null,
      needsOcr = !text;
    if (mode === "ocr" || (mode === "auto" && needsOcr)) {
      const initial = page.getViewport({ scale: 1 }),
        scale = Math.min(2.5, Math.sqrt(MAX_PIXELS / (initial.width * initial.height)));
      if (!Number.isFinite(scale) || scale <= 0) throw Error("PDF_PAGE_INVALID");
      const viewport = page.getViewport({ scale }),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      if (
        canvas.width > 10000 ||
        canvas.height > 10000 ||
        canvas.width * canvas.height > MAX_PIXELS
      )
        throw Error("PDF_PAGE_INVALID");
      await page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
        background: "rgb(255,255,255)"
      }).promise;
      worker = await window.Tesseract.createWorker(["rus", "eng"], 1, {
        workerPath: base + "ocr/worker.min.js",
        corePath: base + "ocr",
        langPath: base + "lang",
        cacheMethod: "none",
        gzip: true,
        workerBlobURL: true
      });
      const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
      textClipped = result.data.text.length > MAX_TEXT;
      text = result.data.text.slice(0, MAX_TEXT).trim();
      method = "ocr";
      confidence = Number.isFinite(result.data.confidence) ? result.data.confidence : null;
      needsOcr = false;
      canvas.width = canvas.height = 1;
      // Positional table recovery: rows/columns from word coordinates only.
      // Words are never dropped or rewritten; geometry that does not verify a
      // grid keeps the engine's plain text. It is still not semantic reading,
      // not handwriting or diagram understanding and not a guaranteed table.
      const detected = layoutFromWords(collectOcrWords(result.data.blocks), {
        maxText: MAX_TEXT
      });
      if (detected) {
        layout = detected;
        textClipped = layout.text.length > MAX_TEXT;
        text = layout.text.slice(0, MAX_TEXT).trimEnd();
      }
    }
    return {
      text,
      page_index: pageIndex,
      page_count: doc.numPages,
      method,
      confidence,
      needs_ocr: needsOcr,
      text_clipped: textClipped,
      complete_document: false,
      limitations: [
        "One page only; no guarantee of complete layout, table structure, handwriting or image understanding.",
        ...(method === "ocr"
          ? [
              "OCR can misread characters and numbers; confidence is the engine's score, not factual accuracy.",
              ...(layout
                ? [
                    "Table rows below were rebuilt from word coordinates; misreads can merge or split cells, and this is not a verified table structure."
                  ]
                : [])
            ]
          : [])
      ]
    };
  } finally {
    if (worker) await worker.terminate();
    await loading.destroy();
  }
};
