// Measurement-only OCR bench for frozen synthetic fixtures: pinned offline
// TrOCR (handwriting-like line images) and Table Transformer (table structure
// box detection), plus an optional local Tesseract.js baseline taken from the
// shipped desktop reader dependencies. No product code changes are required
// to run this. Results are one-machine measurements on synthetic data, not
// SLA, accuracy leaders or product claims; the fixtures are font renderings,
// not real handwriting and not scanned documents. Model weights are
// operator-installed and byte-verified against scripts/semantic-ocr-model-manifest.mjs
// before anything loads; after that check every network fetch is disabled.
//
// Usage: node scripts/bench-semantic-ocr.mjs <absolute model root> [<absolute report path>] [--no-tesseract]
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { TATR, TROCR } from "./semantic-ocr-model-manifest.mjs";

const args = process.argv.slice(2);
const root = args[0];
const output = args[1];
const noTesseract = args.includes("--no-tesseract");
if (!root || !isAbsolute(root)) throw Error("Pass an absolute installed-model root directory");
if (output && !isAbsolute(output)) throw Error("Report path must be absolute");

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturesRoot = resolve(repoRoot, "packages/db/test/fixtures");
const THREADS = 2;
const MAX_NEW_TOKENS = 32;
const TATR_THRESHOLD = 0.5;

const hashFile = async (path) => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path, { highWaterMark: 1024 * 1024 }), hash);
  return hash.digest("hex");
};

const verifyModel = async (model) => {
  for (const [file, expected] of Object.entries(model.files)) {
    const target = resolve(root, model.directory, file);
    let actual;
    try {
      actual = await hashFile(target);
    } catch {
      throw Error(`Missing pinned OCR model file: ${target}`);
    }
    if (actual !== expected.sha256)
      throw Error(`Pinned OCR model file mismatch: ${model.id}/${file}`);
  }
};

const normalize = (text) => text.replace(/\s+/g, " ").trim();

const editDistance = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    previous = current;
  }
  return previous[b.length];
};

const metrics = (truth, predictedRaw) => {
  const predicted = normalize(predictedRaw);
  const lowerTruth = truth.toLowerCase();
  const lowerPredicted = predicted.toLowerCase();
  const editsLower = editDistance(lowerTruth, lowerPredicted);
  const editsCased = editDistance(truth, predicted);
  return {
    predicted,
    edits_lower: editsLower,
    edits_cased: editsCased,
    cer_lower: editsLower / Math.max(1, truth.length),
    cer_cased: editsCased / Math.max(1, truth.length),
    em: truth === predicted,
    em_lower: lowerTruth === lowerPredicted
  };
};

const lineAggregate = (cases) => {
  const truthChars = cases.reduce((sum, c) => sum + c.truth.length, 0);
  return {
    char_error_rate: cases.reduce((sum, c) => sum + c.edits_lower, 0) / Math.max(1, truthChars),
    exact_match_count: cases.filter((c) => c.em).length,
    exact_match_lower_count: cases.filter((c) => c.em_lower).length,
    median_ms: median(cases.map((c) => c.ms)),
    mean_ms: cases.reduce((sum, c) => sum + c.ms, 0) / cases.length
  };
};

const tableAggregate = (cases) => {
  return {
    exact_grid_match_count: cases.filter((c) => c.grid_match).length,
    mean_abs_rows_error:
      cases.reduce((sum, c) => sum + Math.abs(c.rows - c.rows_expected), 0) / cases.length,
    mean_abs_cols_error:
      cases.reduce((sum, c) => sum + Math.abs(c.cols - c.cols_expected), 0) / cases.length,
    median_ms: median(cases.map((c) => c.ms)),
    mean_ms: cases.reduce((sum, c) => sum + c.ms, 0) / cases.length
  };
};

const median = (values) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
};

const fixtureManifest = async (name, expectedFormat) => {
  const raw = await readFile(resolve(fixturesRoot, name, "manifest.json"), "utf8");
  const manifest = JSON.parse(raw.replace(/^\uFEFF/, ""));
  if (manifest.format !== expectedFormat)
    throw Error(`Unexpected fixture manifest format: ${name}`);
  return manifest;
};

// Verify pinned weights before any library loads, then forbid all network IO
// (same guard as the shipped semantic encoder worker).
await verifyModel(TROCR);
await verifyModel(TATR);

let transformers;
try {
  transformers = await import("@huggingface/transformers");
} catch {
  const requireForApi = createRequire(resolve(repoRoot, "apps/api/package.json"));
  transformers = await import(
    pathToFileURL(requireForApi.resolve("@huggingface/transformers")).href
  );
}
const tf = transformers.pipeline ? transformers : transformers.default;
const { env, pipeline: tfPipeline } = tf;
if (!tfPipeline) throw Error("transformers.js exports incomplete for the OCR bench");
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useFSCache = false;
env.useBrowserCache = false;
Object.defineProperty(globalThis, "fetch", {
  value: () => Promise.reject(new Error("SEMANTIC_OCR_NETWORK_DISABLED")),
  configurable: false,
  writable: false
});

const handWriting = await fixtureManifest(
  "semantic-ocr-handwriting",
  "kosmora-semantic-ocr-handwriting-v1"
);
const tables = await fixtureManifest("semantic-ocr-tables", "kosmora-semantic-ocr-tables-v1");
const handwritingDir = resolve(fixturesRoot, "semantic-ocr-handwriting");
const tablesDir = resolve(fixturesRoot, "semantic-ocr-tables");

// TrOCR: image-to-text on the handwriting-like line fixtures. One resident
// warm-up call excludes first-load jitter; every fixture is measured once.
const trocrLoadBegin = performance.now();
const trocr = await tfPipeline("image-to-text", resolve(root, TROCR.directory) + "/", {
  dtype: TROCR.dtype,
  device: "cpu",
  local_files_only: true,
  session_options: { intraOpNumThreads: THREADS, interOpNumThreads: 1 }
});
const trocrLoadMs = performance.now() - trocrLoadBegin;

await trocr(resolve(handwritingDir, handWriting.items[0].file), { max_new_tokens: MAX_NEW_TOKENS });
const trocrCases = [];
for (const item of handWriting.items) {
  const begin = performance.now();
  const [first] = await trocr(resolve(handwritingDir, item.file), {
    max_new_tokens: MAX_NEW_TOKENS
  });
  const ms = performance.now() - begin;
  trocrCases.push({
    file: item.file,
    truth: item.text,
    ...metrics(item.text, first?.generated_text ?? ""),
    ms
  });
}

// Table Transformer: the object-detection pipeline keeps the explicit
// threshold and returns pixel boxes with config labels. Row/column box counts
// are compared with the frozen grid; header and spanning-cell boxes are
// recorded for diagnostics only.
const tatrLoadBegin = performance.now();
const tatr = await tfPipeline("object-detection", resolve(root, TATR.directory) + "/", {
  dtype: TATR.dtype,
  device: "cpu",
  local_files_only: true,
  session_options: { intraOpNumThreads: THREADS, interOpNumThreads: 1 }
});
const tatrLoadMs = performance.now() - tatrLoadBegin;

const runTable = async (item) => {
  const path = resolve(tablesDir, item.file);
  const begin = performance.now();
  const detections = await tatr(path, { threshold: TATR_THRESHOLD });
  const ms = performance.now() - begin;
  if (!Array.isArray(detections)) throw Error("Unexpected TATR post-processing output");
  const counts = {};
  for (const detection of detections) {
    const label = String(detection.label);
    counts[label] = (counts[label] ?? 0) + 1;
  }
  const rows = counts["table row"] ?? 0,
    cols = counts["table column"] ?? 0;
  return {
    file: item.file,
    rows_expected: item.rows,
    cols_expected: item.cols,
    rows,
    cols,
    column_headers: counts["table column header"] ?? 0,
    projected_row_headers: counts["table projected row header"] ?? 0,
    spanning_cells: counts["table spanning cell"] ?? 0,
    table_boxes: counts["table"] ?? 0,
    grid_match: rows === item.rows && cols === item.cols,
    detections: detections.map((detection) => ({
      label: String(detection.label),
      score: Math.round(Number(detection.score) * 10000) / 10000,
      box: {
        xmin: Math.round(detection.box?.xmin ?? -1),
        ymin: Math.round(detection.box?.ymin ?? -1),
        xmax: Math.round(detection.box?.xmax ?? -1),
        ymax: Math.round(detection.box?.ymax ?? -1)
      }
    })),
    ms
  };
};
await runTable(tables.items[0]);
const tatrCases = [];
for (const item of tables.items) tatrCases.push(await runTable(item));

// Optional baseline: the shipped desktop reader OCR (Tesseract.js) on the same
// line fixtures, loads language data only from the pinned local package. If
// anything in the local chain is unstable the baseline reports unavailable
// with the reason instead of silently dropping cases.
let tesseractBaseline;
if (noTesseract) {
  tesseractBaseline = { available: false, reason: "disabled (--no-tesseract)" };
} else {
  try {
    const requireReader = createRequire(
      resolve(repoRoot, "desktop/windows/document-reader/deps/package.json")
    );
    const tesseractPath = requireReader.resolve("tesseract.js");
    const tesseractVersion = requireReader("tesseract.js/package.json").version;
    const tesseractModule = await import(pathToFileURL(tesseractPath).href);
    const tesseract = tesseractModule.createWorker ? tesseractModule : tesseractModule.default;
    const langPath = resolve(
      repoRoot,
      "desktop/windows/document-reader/deps/node_modules/@tesseract.js-data/eng/4.0.0_best_int"
    );
    const traineddata = resolve(langPath, "eng.traineddata.gz");
    if (!existsSync(traineddata))
      throw Error("Pinned tesseract language data missing: " + traineddata);
    const cachePath = resolve(os.tmpdir(), "kosmora-ocr-bench-tessdata");
    await mkdir(cachePath, { recursive: true });
    const worker = await tesseract.createWorker("eng", 1, {
      langPath,
      cachePath,
      logger: () => {},
      errorHandler: () => {}
    });
    const cases = [];
    for (const item of handWriting.items) {
      const path = resolve(handwritingDir, item.file);
      const begin = performance.now();
      const { data } = await worker.recognize(path);
      const ms = performance.now() - begin;
      cases.push({
        file: item.file,
        truth: item.text,
        ...metrics(item.text, data?.text ?? ""),
        ms
      });
    }
    await worker.terminate();
    tesseractBaseline = {
      available: true,
      version: tesseractVersion,
      language: "eng",
      oem: 1,
      aggregate: lineAggregate(cases),
      cases
    };
  } catch (error) {
    tesseractBaseline = { available: false, reason: String(error?.message ?? error) };
  }
}

const fixtureSummaryFor = async (directory, manifest) => {
  const files = {};
  for (const item of manifest.items)
    files[item.file] = await hashFile(resolve(directory, item.file));
  return {
    manifest_format: manifest.format,
    count: manifest.items.length,
    font: manifest.font,
    files_sha256: files
  };
};

const report = {
  measured_at: new Date().toISOString(),
  synthetic_fixtures: true,
  single_machine_measurement: true,
  network: "disabled after pinned-file verification (globalThis.fetch rejected)",
  machine: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu_count: os.cpus().length
  },
  runtime: {
    node: process.version,
    device: "cpu",
    dtype: "q8",
    intra_op_num_threads: THREADS
  },
  models: {
    trocr: {
      id: TROCR.id,
      revision: TROCR.revision,
      upstream_id: TROCR.upstream_id,
      license: TROCR.license,
      total_bytes: TROCR.total_bytes,
      load_ms: trocrLoadMs,
      config: { max_new_tokens: MAX_NEW_TOKENS, warmup: "first fixture, excluded" }
    },
    tatr: {
      id: TATR.id,
      revision: TATR.revision,
      upstream_id: TATR.upstream_id,
      license: TATR.license,
      total_bytes: TATR.total_bytes,
      load_ms: tatrLoadMs,
      config: { threshold: TATR_THRESHOLD, warmup: "first fixture, excluded" }
    }
  },
  fixtures: {
    handwriting: await fixtureSummaryFor(handwritingDir, handWriting),
    tables: await fixtureSummaryFor(tablesDir, tables)
  },
  trocr: { aggregate: lineAggregate(trocrCases), cases: trocrCases },
  tatr: { aggregate: tableAggregate(tatrCases), cases: tatrCases },
  tesseract_baseline: tesseractBaseline,
  limits: [
    "Fixtures are synthetic font renderings (Kalam, OFL): no claim about real handwriting, scans or receipts.",
    "Single Windows machine, CPU inference with q8 weights; timings differ between machines and runs.",
    "TATR metric is row/column box counting at a fixed 0.5 threshold, not cell-level grid reconstruction or table equivalence (no TEDS).",
    "TrOCR metrics are on its training-domain-free synthetic text; case-insensitive CER is primary because fixtures are not capitalisation exercises.",
    "Measurement only: no product integration, no default-document-index claims."
  ],
  rss_snapshot_mib: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10
};

if (output) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
console.log(
  JSON.stringify(
    {
      models: report.models,
      trocr: report.trocr.aggregate,
      tatr: report.tatr.aggregate,
      tesseract_baseline: tesseractBaseline.available
        ? { version: tesseractBaseline.version, aggregate: tesseractBaseline.aggregate }
        : { available: false, reason: tesseractBaseline.reason }
    },
    null,
    2
  )
);
