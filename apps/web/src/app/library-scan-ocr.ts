import { createWorker, type Worker } from "tesseract.js";
import type { PDFPageProxy } from "pdfjs-dist";

const MAX_PIXELS = 4_000_000;
const MAX_EDGE = 4_096;

export function createLibraryOcr(signal: AbortSignal) {
  let pending: Promise<Worker> | undefined;
  let worker: Worker | undefined;
  let disposed = false;
  const dispose = () => {
    disposed = true;
    signal.removeEventListener("abort", dispose);
    if (worker) void worker.terminate().catch(() => undefined);
    worker = undefined;
  };
  signal.addEventListener("abort", dispose, { once: true });

  return {
    dispose,
    async recognize(page: PDFPageProxy): Promise<string> {
      signal.throwIfAborted();
      if (disposed) throw new Error("OCR уже остановлен.");
      pending ??= createWorker(["rus", "eng"], 1, {
        workerPath: "/generated/ocr/worker.min.js",
        corePath: "/generated/ocr",
        langPath: "/generated/ocr/lang",
        workerBlobURL: false,
        cacheMethod: "none",
        gzip: true
      }).then(async (initialized) => {
        if (disposed) {
          await initialized.terminate();
          throw new Error("OCR остановлен.");
        }
        worker = initialized;
        return initialized;
      });

      const bounds = page.getViewport({ scale: 1 });
      const scale = Math.min(
        2.5,
        MAX_EDGE / Math.max(bounds.width, bounds.height),
        Math.sqrt(MAX_PIXELS / (bounds.width * bounds.height))
      );
      if (!Number.isFinite(scale) || scale <= 0) throw new Error("Некорректный размер страницы.");
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));

      try {
        const engine = await pending;
        signal.throwIfAborted();
        const render = page.render({ canvas, viewport, background: "#fff" });
        const cancelRender = () => render.cancel();
        signal.addEventListener("abort", cancelRender, { once: true });
        try {
          await render.promise;
        } finally {
          signal.removeEventListener("abort", cancelRender);
        }
        signal.throwIfAborted();
        const result = await engine.recognize(canvas);
        signal.throwIfAborted();
        return result.data.text.trim();
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
  };
}
