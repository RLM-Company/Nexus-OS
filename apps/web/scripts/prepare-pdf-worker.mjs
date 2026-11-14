import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { URL } from "node:url";

const require = createRequire(import.meta.url);
const directory = new URL("../public/generated/", import.meta.url);
await mkdir(directory, { recursive: true });
await copyFile(
  require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"),
  new URL("pdf.worker.mjs", directory)
);

const ocr = new URL("ocr/", directory);
await mkdir(new URL("lang/", ocr), { recursive: true });
await mkdir(new URL("licenses/", ocr), { recursive: true });
const assets = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["tesseract.js/LICENSE.md", "licenses/tesseract-js.txt"],
  ["tesseract.js-core/LICENSE", "licenses/tesseract-core.txt"]
];
for (const language of ["eng", "rus"]) {
  assets.push([
    "@tesseract.js-data/" + language + "/4.0.0_best_int/" + language + ".traineddata.gz",
    "lang/" + language + ".traineddata.gz"
  ]);
}
for (const variant of ["lstm", "simd-lstm", "relaxedsimd-lstm"]) {
  for (const extension of [".wasm.js", ".wasm"]) {
    const asset = "tesseract-core-" + variant + extension;
    assets.push(["tesseract.js-core/" + asset, asset]);
  }
}
await Promise.all([
  ...assets.map(([source, target]) => copyFile(require.resolve(source), new URL(target, ocr))),
  copyFile(
    new URL("../../../desktop/windows/document-reader/licenses/tessdata.txt", import.meta.url),
    new URL("licenses/tessdata.txt", ocr)
  )
]);
