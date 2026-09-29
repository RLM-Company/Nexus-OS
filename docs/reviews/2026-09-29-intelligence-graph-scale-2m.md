# Intelligence Graph Package E — 2,000,000-edge scale checkpoint

**Date:** 2026-09-29  
**Status:** 2M SYNTHETIC SCALE TARGET EXECUTED / NOT MERGED  
**Branch:** `codex/intelligence-graph-package-e-2m-20260929`  
**Harness:** `scripts/intelligence-graph-scale.mjs`

## Result

The committed dependency-free scale harness was executed with:

```bash
node scripts/intelligence-graph-scale.mjs \
  --edges=2000000 \
  --projects=20 \
  --nodes-per-project=10000 \
  --output=<temporary>/cosmora-intelligence-graph-2m.ndjson.gz
```

The exact executed script matched GitHub blob
`5c52a1fe5fbecc488ded239ea0a235136f639823`.

### Generated graph

- edges: **2,000,000**;
- isolated synthetic projects: **20**;
- logical nodes: **200,000** total;
- nodes per project: **10,000**;
- edges per project: **100,000**;
- relation types:
  - `SUPPORTED_BY`;
  - `BASED_ON`;
  - `IMPLEMENTS`;
  - `RELATES_TO`;
  - `CONSTRAINS`;
  - `DERIVED_FROM`.

All generated edges use one synthetic owner and endpoints inside the same synthetic project. The
generator checks endpoint ranges and rejects self-edges.

## Independent verification

After generation, the compressed output was read again from disk independently of the manifest.

Observed:

- decompressed NDJSON line count: **2,000,000**;
- manifest logical SHA-256:
  `60cf376686aa09f284a12d7fabab8d3a1d709291a0fa13907deff9bbb1c88b24`;
- independently recomputed logical SHA-256:
  `60cf376686aa09f284a12d7fabab8d3a1d709291a0fa13907deff9bbb1c88b24`;
- first edge: `synthetic:p0:e0`;
- last edge: `synthetic:p19:e99999`.

The matching line count and SHA-256 are the acceptance evidence that the completed artifact contains
the intended 2,000,000 logical edge records.

## Resource profile from this execution environment

These numbers are measurements from the execution environment used for this checkpoint. They are not
VPS or production SLO claims.

- logical NDJSON size: **694,000,410 bytes**;
- gzip size: **33,027,918 bytes**;
- compression ratio: **0.047591**;
- generation elapsed: **2,611.243 ms**;
- generation throughput: **765,918.74 edges/s**;
- peak process RSS observed by the harness: **96,841,728 bytes**.

The first unoptimized harness attempt exceeded the execution limit because it JSON-stringified and
compressed every edge individually. The committed harness was changed to deterministic batch
serialization and gzip level 1 before the successful 2M run.

## Bounded traversal sample

The harness builds an adjacency index only for one isolated project, matching the current project-bound
retrieval design rather than loading all tenants into one traversal space.

For one 100,000-edge / 10,000-node project:

- adjacency build: **5.028 ms**;
- measured RSS delta during adjacency build: **262,144 bytes**;
- bounded traversal runs: **100**;
- query budget: depth 3, max 64 nodes, max 128 edges, max fan-out 8;
- p50: **0.005448 ms**;
- p95: **0.016203 ms**;
- maximum nodes visited: **64**;
- maximum edges visited: **127**.

These are synthetic in-process measurements and do not represent a database, network, vector search,
LLM latency or production workload.

## Interpretation

The Stage-1 numerical target from ADR-004 is now met: Cosmora has a reproducible generator that creates
and validates a 2M-edge synthetic graph without committing a hundreds-of-megabytes generated dataset to
Git history.

This demonstrates generation/storage-stream mechanics and bounded project-local traversal. It does
**not** establish answer quality, production graph-database suitability, or permission to run the same
load on the current VPS.

Quality remains evaluated separately by Package C. Model observations remain recommend-only in Package
D.

## Next scale gate

The next numerical stage is **10,000,000 synthetic edges** using the same semantic generator.

Before treating 10M as an infrastructure choice, capture:

- generation throughput;
- compressed/logical size;
- peak RSS;
- one-project adjacency build cost;
- bounded traversal p50/p95;
- disk and backup implications.

The 50M stage remains separate infrastructure work and must not be run on the current 2 vCPU / 4 GB
demo VPS merely to satisfy a vanity edge count.
