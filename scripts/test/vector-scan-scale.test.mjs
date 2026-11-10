// Recall-invariant checks for the measurement bench in
// scripts/bench-vector-scan-scale.mjs. The corpus is fully seeded, so the
// thresholds below are stable across machines; per the bench's own notes
// these are synthetic-corpus measurements, not product behavior claims.
// No timing is asserted anywhere: only which references a candidate must and
// must not recover relative to the exact float32 scan, plus the scan loop's
// structural invariants that mirror the shipped page/dedupe semantics.
import assert from "node:assert/strict";
import test from "node:test";
import {
  PQ_SUBSPACES,
  PQ_CENTROIDS,
  makeDataset,
  queryVectors,
  truthFor,
  recallOf,
  scanTopRefs,
  quantizeInt8,
  scanTopRefsInt8,
  trainProductQuantization,
  encodeProductQuantization,
  scanTopRefsPQ,
  buildHNSW,
  hnswTopRefs
} from "../bench-vector-scan-scale.mjs";

// Small deterministic corpus (the module constants forbid fewer rows only in
// its CLI guard; exports accept what the checks need). 6 bits per dim,
// 16 clusters: recall floors measured once on this exact corpus with the
// same seeds and kept with margin: int8 min 0.969, pq min 0.781, hnsw min 1.
const ROWS = 2000,
  DIMS = 64,
  CLUSTERS = 16,
  QUERY_COUNT = 12,
  SEED_DATASET = 20261108,
  SEED_QUERIES = 99;
const dataset = makeDataset(ROWS, DIMS, CLUSTERS, SEED_DATASET),
  queries = queryVectors(dataset, CLUSTERS, QUERY_COUNT, SEED_QUERIES),
  truths = queries.map((query) => truthFor(dataset, query));

test("the seeded dataset is reproducible and chunked per reference", () => {
  const again = makeDataset(ROWS, DIMS, CLUSTERS, SEED_DATASET);
  assert.equal(again.matrix.length, dataset.matrix.length);
  for (let i = 0; i < dataset.matrix.length; i++) assert.equal(again.matrix[i], dataset.matrix[i]);
  for (let r = 0; r < ROWS; r++) assert.equal(again.refs[r], dataset.refs[r]);
  const evolving = makeDataset(ROWS, DIMS, CLUSTERS, SEED_DATASET + 1);
  let differs = false;
  for (let i = 0; i < 4096 && !differs; i += 1)
    if (evolving.matrix[i] !== dataset.matrix[i]) differs = true;
  assert.ok(differs, "a different seed must change the corpus");
  assert.equal(dataset.refs[7], 1, "chunk 7 belongs to reference 1");
});

test("the exact float32 scan recovers its own ground truth within page caps", () => {
  for (let q = 0; q < QUERY_COUNT; q++) {
    const scan = scanTopRefs(dataset.matrix, dataset.refs, DIMS, queries[q]);
    assert.ok(scan.best.length <= 32);
    const references = scan.best.map((entry) => entry.reference);
    assert.equal(new Set(references).size, references.length, "no dup refs");
    assert.equal(recallOf(references, truths[q]), 1);
    assert.equal(scan.limited, false, "no budget must never stop a page walk");
  }
});

test("reference dedupe keeps only the best chunk score of one reference", () => {
  const dims = 4,
    // Unit-ish two-chunk reference plus one noise reference; the query sits
    // along the row the product scan should rank above the sibling chunk.
    matrix = new Float32Array([
      0.6,
      0.8,
      0,
      0, // chunk A1 of ref 0, weak
      1,
      0,
      0,
      0, // chunk A2 of ref 0, strong
      0,
      1,
      0,
      0, // chunk B1 of ref 1
      0,
      0,
      1,
      0 // chunk B2 of ref 1
    ]),
    refs = new Uint32Array([0, 0, 1, 1]),
    query = [1, 0, 0, 0],
    best = scanTopRefs(matrix, refs, dims, query).best;
  assert.equal(best.length, 2, "one entry per reference");
  assert.deepEqual(
    best.map((entry) => entry.reference),
    [0, 1]
  );
  assert.ok(Math.abs(best[0].score - 1) < 1e-6, "best chunk score wins");
});

test("pruning after a page keeps at most the top references", () => {
  const dims = 4,
    rowTotal = 40,
    matrix = new Float32Array(rowTotal * dims),
    refs = new Uint32Array(rowTotal);
  for (let r = 0; r < rowTotal; r++) {
    matrix[r * dims] = 1 / (r + 1); // strictly descending cosine with e0
    refs[r] = r; // one reference per row: 40 > the 32 cap
  }
  const best = scanTopRefs(matrix, refs, dims, [1, 0, 0, 0]).best;
  assert.equal(best.length, 32, "page prune keeps the top 32");
  assert.equal(best[0].reference, 0, "the strongest reference survives first");
  const kept = new Set(best.map((entry) => entry.reference));
  assert.ok(!kept.has(rowTotal - 1), "the weakest reference is dropped");
  for (let r = 0; r < 32; r++) assert.ok(kept.has(r), `ref ${r} within cap`);
});

test("the int8 candidate keeps near-exact recall on the corpus", () => {
  assert.ok(ROWS % 4 === 0);
  const quantized = quantizeInt8(dataset.matrix, DIMS);
  assert.equal(quantized.codes.length, ROWS * DIMS);
  let minRecall = 1;
  for (let q = 0; q < QUERY_COUNT; q++) {
    const scan = scanTopRefsInt8(quantized, dataset.refs, DIMS, queries[q]);
    minRecall = Math.min(
      minRecall,
      recallOf(
        scan.best.map((entry) => entry.reference),
        truths[q]
      )
    );
  }
  assert.ok(minRecall >= 0.9, `int8 recall floor ${minRecall}`);
});

test("the pq candidate keeps its measured envelope on the corpus", () => {
  // 32 fixed subspaces, 256 Lloyd centroids each: at 64 dims each subspace
  // is 2 dims wide, which is why the small-corpus envelope here sits far
  // above the 384-dim full benchmark numbers (12-dim subspaces).
  const trained = trainProductQuantization(dataset.matrix, DIMS),
    codes = encodeProductQuantization(dataset.matrix, DIMS, trained);
  assert.equal(PQ_SUBSPACES, 32);
  assert.equal(PQ_CENTROIDS, 256);
  assert.equal(codes.length, ROWS * PQ_SUBSPACES);
  assert.equal(trained.centroids.length, PQ_SUBSPACES * PQ_CENTROIDS * (DIMS / PQ_SUBSPACES));
  let minRecall = 1;
  for (let q = 0; q < QUERY_COUNT; q++) {
    const scan = scanTopRefsPQ(codes, trained, dataset.refs, queries[q]);
    minRecall = Math.min(
      minRecall,
      recallOf(
        scan.best.map((entry) => entry.reference),
        truths[q]
      )
    );
  }
  assert.ok(minRecall >= 0.7, `pq recall floor ${minRecall}`);
});

test("the hnsw prototype keeps high recall on the corpus", () => {
  const built = buildHNSW(dataset.matrix, DIMS);
  assert.ok(built.entry >= 0 && built.entry < ROWS);
  let minRecall = 1;
  for (let q = 0; q < QUERY_COUNT; q++) {
    const row = Math.floor(((q + 0.5) / QUERY_COUNT) * ROWS) % ROWS,
      plantedTruth = truthFor(dataset, dataset.matrix.slice(row * DIMS, (row + 1) * DIMS)),
      found = hnswTopRefs(built, dataset.matrix, dataset.refs, DIMS, row, { ef: 128 });
    assert.ok(found.length <= 32);
    assert.equal(new Set(found).size, found.length, "no duplicate refs");
    minRecall = Math.min(minRecall, recallOf(found, plantedTruth));
  }
  assert.ok(minRecall >= 0.95, `hnsw recall floor ${minRecall}`);
});
