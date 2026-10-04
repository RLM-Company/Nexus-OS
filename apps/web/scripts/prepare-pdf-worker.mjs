import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const directory = new URL("../public/generated/", import.meta.url);
await mkdir(directory, { recursive: true });
await copyFile(
  require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"),
  new URL("pdf.worker.mjs", directory)
);
