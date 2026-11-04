"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { createHash } = require("node:crypto");
const from = path.join(__dirname, "deps/node_modules"),
  to = path.join(__dirname, "vendor");
const copies = [
  ["pdfjs-dist/build/pdf.mjs", "pdf/pdf.mjs"],
  ["pdfjs-dist/build/pdf.worker.mjs", "pdf/pdf.worker.mjs"],
  ["pdfjs-dist/cmaps", "pdf/cmaps"],
  ["pdfjs-dist/standard_fonts", "pdf/standard_fonts"],
  ["pdfjs-dist/wasm", "pdf/wasm"],
  ["pdfjs-dist/LICENSE", "licenses/pdfjs.txt"],
  ["tesseract.js/dist/tesseract.min.js", "ocr/tesseract.min.js"],
  ["tesseract.js/dist/worker.min.js", "ocr/worker.min.js"],
  ["tesseract.js/LICENSE.md", "licenses/tesseract-js.txt"],
  ["tesseract.js-core/LICENSE", "licenses/tesseract-core.txt"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "lang/eng.traineddata.gz"],
  ["@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz", "lang/rus.traineddata.gz"],
  ["@tesseract.js-data/eng/README.md", "licenses/eng-package-readme.txt"],
  ["@tesseract.js-data/rus/README.md", "licenses/rus-package-readme.txt"]
];
for (const name of [
  "tesseract-core-lstm",
  "tesseract-core-simd-lstm",
  "tesseract-core-relaxedsimd-lstm"
])
  for (const ext of [".wasm.js", ".wasm"])
    copies.push(["tesseract.js-core/" + name + ext, "ocr/" + name + ext]);
for (const [src, dst] of copies) {
  const target = path.join(to, dst);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(from, src), target, { recursive: true });
}
fs.cpSync(path.join(__dirname, "licenses"), path.join(to, "licenses"), { recursive: true });
const files = {};
function walk(dir, prefix = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const key = prefix + e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), key + "/");
    else if (e.isFile())
      files[key] = createHash("sha256")
        .update(fs.readFileSync(path.join(dir, e.name)))
        .digest("hex");
  }
}
walk(to);
fs.writeFileSync(
  path.join(__dirname, "assets-manifest.json"),
  JSON.stringify(
    { schema: 1, versions: { pdfjs: "6.3.289", tesseract: "7.0.0", languages: "1.0.0" }, files },
    null,
    2
  ) + "\n"
);
console.log("Prepared offline document assets:", Object.keys(files).length, "files");
