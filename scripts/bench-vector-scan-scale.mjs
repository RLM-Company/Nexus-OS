// Deterministic scale evaluation of the semantic-history vector scan and of
// approximate-neighbor candidates (int8 / product quantization / HNSW
// prototype). The scan semantics mirror the shipped implementation by its
// documented constants: 384-dimensional unit float32 rows served in 256-row
// keyset pages, per-row score = dot product (norm accumulation mirrors
// scoreSemanticVector), per-reference dedupe where pruning after a page drops
// a reference's score entirely, top 32 references, and the query budget
// checked only after a page (pointer: apps/api/src/semantic-memory/
// index-service.ts, packages/db/src/semantic-index-store.ts). No product
// code, storage or runtime dependency is touched: candidates are
// measurement-only prototypes. Results are relative measurements on one
// machine, not SLA or intelligence claims; semantic quality with the real
// encoder (absent-fact cases) is the separate queued evaluation that needs a
// verified model install.
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import os from "node:os";

const args = process.argv.slice(2);
const consumed = new Set();
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  consumed.add(i);
  if (i + 1 < args.length) consumed.add(i + 1);
  return Number(args[i + 1]);
};
const outputArg = args.find((a, i) => !a.startsWith("--") && !consumed.has(i));
const SMALL = args.includes("--small");
const ROWS = flag("--rows", SMALL ? 20000 : 100000);
const DIMS = flag("--dims", 384);
const CLUSTERS = flag("--clusters", 64);
const CHUNKS_PER_REF = 4;
const PAGE_ROWS = 256;
const TOP_REFS = 32;
const BUDGET_MS = 250;
const QUERY_COUNT = 48;
const SEED = 20261108;
const HNSW_MAX_ROWS = flag("--hnsw-rows", 25000);
if (!Number.isInteger(ROWS) || ROWS < 4000 || ROWS > 200000) throw Error("ROWS_OUT_OF_RANGE");
if (!Number.isInteger(DIMS) || DIMS % 32 !== 0 || DIMS < 64 || DIMS > 512)
  throw Error("DIMS_OUT_OF_RANGE");
if (!Number.isInteger(HNSW_MAX_ROWS) || HNSW_MAX_ROWS < 4000) throw Error("HNSW_ROWS_OUT_OF_RANGE");

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGaussian(rng) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let x = 0,
      y = 0,
      s = 0;
    do {
      x = rng() * 2 - 1;
      y = rng() * 2 - 1;
      s = x * x + y * y;
    } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    spare = y * f;
    return x * f;
  };
}

/** Clustered unit-sphere corpus: 85% of rows belong to one of CLUSTERS
 * centers with noise and 15% are unrelated noise, the same role irrelevant
 * history plays in retrieval. Rows are grouped into references of
 * CHUNKS_PER_REF chunks, like passages of one source. */
export function makeDataset(rows, dims, clusters, seed) {
  const rng = mulberry32(seed),
    gaussian = makeGaussian(rng),
    matrix = new Float32Array(rows * dims),
    centers = new Float32Array(clusters * dims),
    refs = new Uint32Array(rows);
  for (let c = 0; c < clusters; c++) {
    let norm = 0;
    for (let i = 0; i < dims; i++) {
      const v = gaussian();
      centers[c * dims + i] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dims; i++) centers[c * dims + i] /= norm;
  }
  for (let r = 0; r < rows; r++) {
    const cluster = rng() < 0.85 ? Math.floor(rng() * clusters) : -1,
      sigma = cluster >= 0 ? 0.35 : 1;
    let norm = 0;
    for (let i = 0; i < dims; i++) {
      const base = cluster >= 0 ? centers[cluster * dims + i] : 0;
      const v = base + gaussian() * sigma;
      matrix[r * dims + i] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dims; i++) matrix[r * dims + i] /= norm;
    refs[r] = Math.floor(r / CHUNKS_PER_REF);
  }
  return { matrix, refs, centers, refCount: Math.ceil(rows / CHUNKS_PER_REF), dims };
}

/** Exact float32 scan mirroring the shipped per-page loop: a whole page is
 * processed before the budget is checked, reference dedupe keeps only the
 * best chunk per reference and pruning after a page drops scores entirely,
 * and the returned list is the best TOP_REFS references. */
export function scanTopRefs(matrix, refs, dims, query, { budgetMs = null } = {}) {
  const rows = matrix.length / dims,
    scores = new Map(),
    start = performance.now();
  let rowsVisited = 0,
    limited = false;
  for (let page = 0; page < rows; page += PAGE_ROWS) {
    const until = Math.min(page + PAGE_ROWS, rows);
    for (let r = page; r < until; r++) {
      const base = r * dims;
      let score = 0,
        norm = 0;
      for (let i = 0; i < dims; i++) {
        const v = matrix[base + i];
        norm += v * v;
        score += v * query[i];
      }
      rowsVisited++;
      const ref = refs[r],
        previous = scores.get(ref);
      if (!previous || score > previous.score)
        scores.set(ref, { reference: ref, score: Math.max(-1, Math.min(1, score)) });
    }
    if (scores.size > TOP_REFS) {
      const top = [...scores.values()].sort((x, y) => y.score - x.score).slice(0, TOP_REFS);
      scores.clear();
      for (const entry of top) scores.set(entry.reference, entry);
    }
    rowsVisited = until;
    if (budgetMs !== null && performance.now() - start > budgetMs && until < rows) {
      limited = true;
      break;
    }
  }
  return {
    best: [...scores.values()].sort((x, y) => y.score - x.score).slice(0, TOP_REFS),
    rowsVisited,
    limited,
    elapsedMs: performance.now() - start
  };
}

export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function truthFor(dataset, query) {
  const { best } = scanTopRefs(dataset.matrix, dataset.refs, dataset.dims, query);
  return new Set(best.map((entry) => entry.reference));
}

export function recallOf(candidateRefs, truth) {
  let hits = 0;
  for (const ref of candidateRefs) if (truth.has(ref)) hits++;
  return hits / truth.size;
}

function summarizeTimings(ms, recalls, label) {
  return {
    label,
    query_ms_p50: percentile(ms, 50),
    query_ms_p95: percentile(ms, 95),
    recall_at_32_p50: percentile(recalls, 50),
    recall_at_32_p95: percentile(recalls, 95)
  };
}

/** Scalar int8 candidate: per-vector max-abs scale of the unit vector plus a
 * stored code norm, so the page scan derives a real cosine of the quantized
 * direction. 384 bytes + 8 bytes per row instead of 1536. */
export function quantizeInt8(matrix, dims) {
  const rows = matrix.length / dims,
    codes = new Int8Array(rows * dims),
    scales = new Float32Array(rows),
    norms = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    let max = 0,
      codeNorm = 0,
      base = r * dims;
    for (let i = 0; i < dims; i++) {
      const mag = Math.abs(matrix[base + i]);
      if (mag > max) max = mag;
    }
    const scale = max > 0 ? 127 / max : 1;
    scales[r] = scale;
    for (let i = 0; i < dims; i++) {
      const q = Math.max(-127, Math.min(127, Math.round(matrix[base + i] * scale)));
      codes[base + i] = q;
      codeNorm += q * q;
    }
    norms[r] = Math.sqrt(codeNorm);
  }
  return { codes, scales, norms };
}

export function scanTopRefsInt8(quantized, refs, dims, query, { budgetMs = null } = {}) {
  const rows = quantized.codes.length / dims,
    scores = new Map(),
    start = performance.now();
  let limited = false;
  for (let page = 0; page < rows; page += PAGE_ROWS) {
    const until = Math.min(page + PAGE_ROWS, rows);
    for (let r = page; r < until; r++) {
      const base = r * dims;
      let dot = 0;
      for (let i = 0; i < dims; i++) dot += quantized.codes[base + i] * query[i];
      const score = dot / quantized.norms[r];
      const ref = refs[r],
        previous = scores.get(ref);
      if (!previous || score > previous.score)
        scores.set(ref, { reference: ref, score: Math.max(-1, Math.min(1, score)) });
    }
    if (scores.size > TOP_REFS) {
      const top = [...scores.values()].sort((x, y) => y.score - x.score).slice(0, TOP_REFS);
      scores.clear();
      for (const entry of top) scores.set(entry.reference, entry);
    }
    if (budgetMs !== null && performance.now() - start > budgetMs && until < rows) {
      limited = true;
      break;
    }
  }
  return {
    best: [...scores.values()].sort((x, y) => y.score - x.score).slice(0, TOP_REFS),
    limited,
    elapsedMs: performance.now() - start
  };
}

export const PQ_SUBSPACES = 32;
export const PQ_CENTROIDS = 256;

/** Product quantization candidate: PQ_SUBSPACES fixed subspaces, k Lloyd
 * centroids each, trained on an evenly strided seeded sample. Ranking is
 * approximate squared L2 (monotone to cosine for unit directions). */
export function trainProductQuantization(
  matrix,
  dims,
  { iterations = 3, sample = 4000, seed = 7 } = {}
) {
  const rows = matrix.length / dims;
  if (dims % PQ_SUBSPACES !== 0) throw Error("PQ_DIMS_INVALID");
  const subspaceDims = dims / PQ_SUBSPACES,
    rng = mulberry32(seed),
    centroids = new Float32Array(PQ_SUBSPACES * PQ_CENTROIDS * subspaceDims),
    sampleRows = Array.from({ length: Math.min(sample, rows) }, (_, i) =>
      Math.floor((i * rows) / Math.min(sample, rows))
    );
  for (let s = 0; s < PQ_SUBSPACES; s++) {
    const offset = s * PQ_CENTROIDS * subspaceDims;
    for (let c = 0; c < PQ_CENTROIDS; c++) {
      const from = sampleRows[Math.floor(rng() * sampleRows.length)] * dims;
      for (let i = 0; i < subspaceDims; i++)
        centroids[offset + c * subspaceDims + i] = matrix[from + s * subspaceDims + i];
    }
    for (let iter = 0; iter < iterations; iter++) {
      const sums = new Float64Array(PQ_CENTROIDS * subspaceDims),
        counts = new Uint32Array(PQ_CENTROIDS);
      for (const r of sampleRows) {
        const base = r * dims + s * subspaceDims;
        let best = 0,
          bestDist = Infinity;
        for (let c = 0; c < PQ_CENTROIDS; c++) {
          let dist = 0;
          const cb = offset + c * subspaceDims;
          for (let i = 0; i < subspaceDims; i++) {
            const diff = matrix[base + i] - centroids[cb + i];
            dist += diff * diff;
          }
          if (dist < bestDist) {
            bestDist = dist;
            best = c;
          }
        }
        counts[best]++;
        for (let i = 0; i < subspaceDims; i++) sums[best * subspaceDims + i] += matrix[base + i];
      }
      for (let c = 0; c < PQ_CENTROIDS; c++) {
        if (!counts[c]) continue;
        for (let i = 0; i < subspaceDims; i++)
          centroids[offset + c * subspaceDims + i] = sums[c * subspaceDims + i] / counts[c];
      }
    }
  }
  return { centroids, subspaceDims };
}

export function encodeProductQuantization(matrix, dims, trained) {
  const rows = matrix.length / dims,
    subDims = trained.subspaceDims,
    codes = new Uint8Array(rows * PQ_SUBSPACES);
  for (let r = 0; r < rows; r++) {
    const base = r * dims;
    for (let s = 0; s < PQ_SUBSPACES; s++) {
      const rowBase = base + s * subDims,
        centroidBase = s * PQ_CENTROIDS * subDims;
      let best = 0,
        bestDist = Infinity;
      for (let c = 0; c < PQ_CENTROIDS; c++) {
        let dist = 0;
        const cb = centroidBase + c * subDims;
        for (let i = 0; i < subDims; i++) {
          const diff = matrix[rowBase + i] - trained.centroids[cb + i];
          dist += diff * diff;
        }
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      codes[r * PQ_SUBSPACES + s] = best;
    }
  }
  return codes;
}

export function scanTopRefsPQ(codes, trained, refs, query, { budgetMs = null } = {}) {
  const rows = codes.length / PQ_SUBSPACES,
    subDims = trained.subspaceDims,
    tables = new Float32Array(PQ_SUBSPACES * PQ_CENTROIDS);
  for (let s = 0; s < PQ_SUBSPACES; s++) {
    const centroidBase = s * PQ_CENTROIDS * subDims,
      tableBase = s * PQ_CENTROIDS;
    for (let c = 0; c < PQ_CENTROIDS; c++) {
      let dist = 0;
      for (let i = 0; i < subDims; i++) {
        const diff = query[s * subDims + i] - trained.centroids[centroidBase + c * subDims + i];
        dist += diff * diff;
      }
      tables[tableBase + c] = dist;
    }
  }
  const scores = new Map(),
    start = performance.now();
  let limited = false;
  for (let page = 0; page < rows; page += PAGE_ROWS) {
    const until = Math.min(page + PAGE_ROWS, rows);
    for (let r = page; r < until; r++) {
      let dist = 0;
      const base = r * PQ_SUBSPACES;
      for (let s = 0; s < PQ_SUBSPACES; s++) dist += tables[s * PQ_CENTROIDS + codes[base + s]];
      const score = -dist,
        ref = refs[r],
        previous = scores.get(ref);
      if (!previous || score > previous.score) scores.set(ref, { reference: ref, score });
    }
    if (scores.size > TOP_REFS) {
      const top = [...scores.values()].sort((x, y) => y.score - x.score).slice(0, TOP_REFS);
      scores.clear();
      for (const entry of top) scores.set(entry.reference, entry);
    }
    if (budgetMs !== null && performance.now() - start > budgetMs && until < rows) {
      limited = true;
      break;
    }
  }
  return {
    best: [...scores.values()].sort((x, y) => y.score - x.score).slice(0, TOP_REFS),
    limited,
    elapsedMs: performance.now() - start
  };
}

/** HNSW prototype, measurement-only: standard Malkov construction with the
 * neighbor-selection heuristic, L2 = 1 - dot on unit vectors (identical
 * ordering to cosine), seeded levels for reproducible runs. Links store both
 * directions in a flat Int32Array; region [level] spans 2 * M0 slots. */
export function buildHNSW(matrix, dims, { M = 16, efConstruction = 100, seed = 11 } = {}) {
  const rows = matrix.length / dims,
    rng = mulberry32(seed),
    m0 = 2 * M,
    mL = 1 / Math.log(M);
  const levels = new Int32Array(rows);
  for (let r = 0; r < rows; r++) {
    let level = Math.floor(-Math.log(Math.max(rng(), Number.EPSILON)) * mL);
    if (!Number.isFinite(level) || level < 0) level = 0;
    levels[r] = level;
  }
  const offsets = new Int32Array(rows + 1);
  let totalSlots = 0;
  for (let r = 0; r < rows; r++) {
    offsets[r] = totalSlots;
    totalSlots += (levels[r] + 1) * 2 * m0;
  }
  offsets[rows] = totalSlots;
  const graph = new Int32Array(totalSlots).fill(-1);
  // Dots index the flat matrix directly: per-call subarray views made the
  // measured build cost independent of dim, so allocation churn was the
  // bottleneck, not arithmetic.
  const rowDot = (a, b) => {
    const aBase = a * dims,
      bBase = b * dims;
    let dot = 0;
    for (let i = 0; i < dims; i++) dot += matrix[aBase + i] * matrix[bBase + i];
    return 1 - dot;
  };
  const copyRow = (index, out) => {
    const base = index * dims;
    for (let i = 0; i < dims; i++) out[i] = matrix[base + i];
    return out;
  };
  const stamp = new Uint32Array(rows),
    stampEpoch = { value: 0 };
  const beginVisit = () => {
    stampEpoch.value++;
    return stampEpoch.value;
  };
  const markVisited = (node, epoch) => {
    stamp[node] = epoch;
  };

  // Search on exactly one layer, both link directions, bounded by ef. The
  // worst result is tracked incrementally so the inner loop stays O(1).
  function searchLayer(entry, queryIndex, ef, level) {
    const epoch = beginVisit(),
      queryRow = copyRow(queryIndex, new Float32Array(dims)),
      score = (node) => {
        const base = node * dims;
        let dot = 0;
        for (let i = 0; i < dims; i++) dot += matrix[base + i] * queryRow[i];
        return 1 - dot;
      };
    const result = new Map(),
      candidates = [];
    result.set(entry, score(entry));
    markVisited(entry, epoch);
    let worst = result.get(entry);
    candidates.push([worst, entry]);
    while (candidates.length) {
      candidates.sort((a, b) => a[0] - b[0]);
      const [currentDist, current] = candidates.shift();
      if (currentDist > worst && result.size >= ef) break;
      const base = offsets[current] + level * 2 * m0;
      for (let side = 0; side < 2; side++)
        for (let i = 0; i < m0; i++) {
          const next = graph[base + side * m0 + i];
          if (next < 0 || stamp[next] === epoch) continue;
          stamp[next] = epoch;
          const nd = score(next);
          if (result.size < ef || nd < worst) {
            result.set(next, nd);
            candidates.push([nd, next]);
            if (result.size > ef) {
              let farNode = null;
              let farDist = -Infinity;
              for (const [node, d] of result)
                if (d > farDist) {
                  farDist = d;
                  farNode = node;
                }
              result.delete(farNode);
              worst = -Infinity;
              for (const d of result.values()) if (d > worst) worst = d;
            } else if (nd > worst) {
              worst = nd;
            }
          }
        }
    }
    return [...result.entries()].sort((a, b) => a[1] - b[1]).slice(0, ef);
  }

  const selectNeighbors = (candidates, limit) => {
    const chosen = [];
    for (const [node, nodeDist] of candidates) {
      if (chosen.length >= limit) break;
      let independent = true;
      for (const selected of chosen)
        if (rowDot(node, selected) < nodeDist) {
          independent = false;
          break;
        }
      if (independent) chosen.push(node);
    }
    for (const [node] of candidates) {
      if (chosen.length >= limit) break;
      if (!chosen.includes(node)) chosen.push(node);
    }
    return chosen;
  };

  let entry = 0;
  for (let r = 1; r < rows; r++) {
    let current = entry;
    const level = levels[r];
    for (let l = levels[entry]; l > level; l--) {
      let improved = true;
      while (improved) {
        improved = false;
        const base = offsets[current] + l * 2 * m0,
          currentDist = rowDot(current, r);
        for (let i = 0; i < 2 * m0; i++) {
          const next = graph[base + i];
          if (next >= 0 && rowDot(next, r) < currentDist) {
            current = next;
            improved = true;
          }
        }
      }
    }
    let entryPoint = current;
    for (let l = Math.min(level, levels[entry]); l >= 0; l--) {
      const found = searchLayer(entryPoint, r, efConstruction, l),
        selected = selectNeighbors(found, M).slice(0, M),
        outBase = offsets[r] + l * 2 * m0;
      for (let i = 0; i < selected.length; i++) {
        const neighbor = selected[i];
        graph[outBase + i] = neighbor;
        const backBase = offsets[neighbor] + l * 2 * m0;
        let free = -1;
        for (let j = 0; j < m0; j++)
          if (graph[backBase + j] < 0) {
            free = j;
            break;
          }
        if (free >= 0) graph[backBase + free] = r;
        else {
          const rebuilt = searchLayer(neighbor, neighbor, m0, l).filter(
            ([node]) => node !== neighbor
          );
          const kept = selectNeighbors(rebuilt, m0);
          for (let j = 0; j < m0; j++) graph[backBase + j] = j < kept.length ? kept[j] : -1;
        }
      }
      entryPoint = selected[0] ?? current;
    }
    if (level > levels[entry]) entry = r;
  }
  return { graph, offsets, levels, entry, m0, M };
}

/** Query the prototype for the nearest TOP_REFS references of one row. The
 * descent runs over upper layers, the ef search on layer 0; recall is ALWAYS
 * measured against the exact float32 ranking of the SAME row so the metric
 * isolates the ANN error from any proxy mismatch. */
export function hnswTopRefs(built, matrix, refs, dims, queryRow, { ef = 128 } = {}) {
  const rows = matrix.length / dims;
  if (queryRow < 0 || queryRow >= rows || !Number.isInteger(queryRow))
    throw Error("HNSW_QUERY_ROW");
  const dist = (node) => {
    const base = node * dims,
      qBase = queryRow * dims;
    let dot = 0;
    for (let i = 0; i < dims; i++) dot += matrix[base + i] * matrix[qBase + i];
    return 1 - dot;
  };
  let current = built.entry;
  for (let l = built.levels[built.entry]; l >= 1; l--) {
    let improved = true;
    while (improved) {
      improved = false;
      const base = built.offsets[current] + l * 2 * built.m0,
        currentDist = dist(current);
      for (let i = 0; i < 2 * built.m0; i++) {
        const next = built.graph[base + i];
        if (next >= 0 && dist(next) < currentDist) {
          current = next;
          improved = true;
        }
      }
    }
  }
  const visited = new Uint8Array(rows),
    scores = new Map(),
    frontier = [];
  scores.set(current, dist(current));
  visited[current] = 1;
  let worst = scores.get(current);
  frontier.push([worst, current]);
  while (frontier.length) {
    frontier.sort((a, b) => a[0] - b[0]);
    const [currentDist, currentNode] = frontier.shift();
    if (currentDist > worst && scores.size >= ef) break;
    const base = built.offsets[currentNode];
    for (let i = 0; i < 2 * built.m0; i++) {
      const next = built.graph[base + i];
      if (next < 0 || visited[next]) continue;
      visited[next] = 1;
      const nd = dist(next);
      if (scores.size < ef || nd < worst) {
        scores.set(next, nd);
        frontier.push([nd, next]);
        if (scores.size > ef) {
          let farNode = null;
          let farDist = -Infinity;
          for (const [node, d] of scores)
            if (d > farDist) {
              farDist = d;
              farNode = node;
            }
          scores.delete(farNode);
          worst = -Infinity;
          for (const d of scores.values()) if (d > worst) worst = d;
        } else if (nd > worst) {
          worst = nd;
        }
      }
    }
  }
  const perRef = new Map();
  for (const [node, d] of scores) {
    const ref = refs[node],
      score = -d;
    if (!perRef.has(ref) || perRef.get(ref) < score) perRef.set(ref, score);
  }
  return [...perRef.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_REFS)
    .map(([reference]) => reference);
}

/** Query vectors: even indexes sit on cluster centers, odd indexes average
 * two far clusters, so the hard half cannot be won by one trivial neighbor. */
export function queryVectors(dataset, clusters, count, seed) {
  const { dims, centers } = dataset,
    rng = mulberry32(seed),
    queries = [];
  for (let q = 0; q < count; q++) {
    const cluster = Math.floor(rng() * clusters),
      noise = q % 2 === 0 ? 0.35 : 1.1,
      vector = new Float32Array(dims);
    let norm = 0;
    for (let i = 0; i < dims; i++) {
      const base =
        q % 2 === 0
          ? centers[cluster * dims + i]
          : (centers[cluster * dims + i] + centers[((cluster + 7) % clusters) * dims + i]) / 2;
      const v = base + rng() * noise;
      vector[i] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dims; i++) vector[i] /= norm;
    queries.push(vector);
  }
  return queries;
}

function measured(label, run) {
  const warmups = 4;
  for (let w = 0; w < warmups; w++) run(w);
  const ms = [],
    recalls = [],
    limited = [];
  for (let i = 0; i < QUERY_COUNT; i++) {
    const t = performance.now(),
      out = run(i);
    ms.push(performance.now() - t);
    if (out.recall !== undefined) recalls.push(out.recall);
    if (out.limited !== undefined) limited.push(out.limited);
  }
  const summary = summarizeTimings(ms, recalls, label);
  if (limited.length) summary.budget_hit_rate = limited.filter(Boolean).length / limited.length;
  return summary;
}

function main() {
  const started = performance.now();
  const dataset = makeDataset(ROWS, DIMS, CLUSTERS, SEED),
    queries = queryVectors(dataset, CLUSTERS, QUERY_COUNT, 99),
    truths = queries.map((q) => truthFor(dataset, q));
  console.error(`dataset: ${ROWS} rows x ${DIMS} dims, ${dataset.refCount} refs, truth ready`);
  const configurations = {};

  configurations.exact_f32 = {
    vector_bytes: ROWS * DIMS * 4,
    budgeted: measured(`exact scan, budget ${BUDGET_MS}ms`, (i) => {
      const scan = scanTopRefs(dataset.matrix, dataset.refs, DIMS, queries[i], {
        budgetMs: BUDGET_MS
      });
      return {
        recall: recallOf(
          scan.best.map((b) => b.reference),
          truths[i]
        ),
        limited: scan.limited
      };
    }),
    unbounded: measured("exact scan, unbounded", (i) => {
      const scan = scanTopRefs(dataset.matrix, dataset.refs, DIMS, queries[i]);
      return {
        recall: recallOf(
          scan.best.map((b) => b.reference),
          truths[i]
        )
      };
    })
  };

  {
    const quantized = quantizeInt8(dataset.matrix, DIMS);
    configurations.int8 = {
      vector_bytes: ROWS * (DIMS + 8),
      ...measured(`int8 scan, budget ${BUDGET_MS}ms`, (i) => {
        const scan = scanTopRefsInt8(quantized, dataset.refs, DIMS, queries[i], {
          budgetMs: BUDGET_MS
        });
        return {
          recall: recallOf(
            scan.best.map((b) => b.reference),
            truths[i]
          ),
          limited: scan.limited
        };
      })
    };
  }

  {
    const trained = trainProductQuantization(dataset.matrix, DIMS),
      codes = encodeProductQuantization(dataset.matrix, DIMS, trained);
    configurations.pq = {
      vector_bytes: ROWS * PQ_SUBSPACES,
      ...measured(`pq scan, budget ${BUDGET_MS}ms`, (i) => {
        const scan = scanTopRefsPQ(codes, trained, dataset.refs, queries[i], {
          budgetMs: BUDGET_MS
        });
        return {
          recall: recallOf(
            scan.best.map((b) => b.reference),
            truths[i]
          )
        };
      })
    };
  }

  {
    // Building the graph over the full quota costs minutes on this machine,
    // so the HNSW candidate is measured on a contiguous subset of rows; the
    // report states the subset size in hnsw.measured_rows. Its ground truth
    // is the exact ranking within that same subset.
    const hnswRows = Math.min(ROWS, HNSW_MAX_ROWS),
      subsetMatrix = dataset.matrix.slice(0, hnswRows * DIMS),
      subsetRefs = dataset.refs.slice(0, hnswRows),
      buildStart = performance.now(),
      built = buildHNSW(subsetMatrix, DIMS, { efConstruction: 100 }),
      buildMs = performance.now() - buildStart;
    let graphEdges = 0;
    for (const v of built.graph) if (v >= 0) graphEdges++;
    const measuredRows = queries.map(
      (_, i) => Math.floor(((i + 0.5) / QUERY_COUNT) * hnswRows) % hnswRows
    );
    const rowTruths = measuredRows.map((r) => {
      const view = new Float32Array(DIMS);
      view.set(subsetMatrix.subarray(r * DIMS, (r + 1) * DIMS));
      return truthFor({ matrix: subsetMatrix, refs: subsetRefs, dims: DIMS }, view);
    });
    configurations.hnsw = {
      vector_bytes: ROWS * DIMS * 4,
      measured_rows: hnswRows,
      graph_bytes: built.graph.byteLength,
      graph_edges: graphEdges,
      build_ms: buildMs,
      ...measured("hnsw prototype subset, ef 128", (i) => {
        const refsFound = hnswTopRefs(built, subsetMatrix, subsetRefs, DIMS, measuredRows[i], {
          ef: 128
        });
        return { recall: recallOf(refsFound, rowTruths[i]) };
      })
    };
  }

  const report = {
    measured_with: {
      node: process.version,
      platform: process.platform,
      cpu: os.cpus()[0]?.model ?? "unknown",
      cores: os.cpus().length
    },
    dataset: {
      rows: ROWS,
      dims: DIMS,
      clusters: CLUSTERS,
      chunk_per_ref: CHUNKS_PER_REF,
      pages: Math.ceil(ROWS / PAGE_ROWS),
      seed: `${SEED}/99`,
      generated_by: "scripts/bench-vector-scan-scale.mjs"
    },
    scan_constants: {
      page_rows: PAGE_ROWS,
      top_refs: TOP_REFS,
      budget_ms: BUDGET_MS,
      budget_checked: "after each page",
      per_row_cost: "dot + norm accumulation, float32 blob contents"
    },
    configurations,
    notes: [
      "Ground truth is the unbounded float32 scan over the same synthetic corpus; recall@32 is per reference with the shipped dedupe semantics.",
      "No event-loop yields are simulated; all configurations are measured under one harness.",
      "HNSW recall is against the exact ranking of the same planted row within the measured subset, isolating ANN error.",
      "All candidates are measurement-only prototypes; nothing is wired into product storage or stores.",
      "Semantic quality with the real encoder and absent-fact cases stays in the separate queue that needs a verified model install."
    ],
    wall_ms: Math.round(performance.now() - started)
  };
  console.log(JSON.stringify(report, null, 2));
  if (typeof outputArg === "string" && outputArg.length) {
    writeFileSync(outputArg, JSON.stringify(report, null, 2) + "\n");
    console.error(`written: ${outputArg}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("bench-vector-scan-scale.mjs")) main();
