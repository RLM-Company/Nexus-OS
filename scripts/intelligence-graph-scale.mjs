import { createHash } from "node:crypto";
import { createWriteStream, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { createGzip } from "node:zlib";

const DEFAULTS = Object.freeze({
  edges: 2_000_000,
  projects: 20,
  nodesPerProject: 10_000,
  output: "data/intelligence-graph-scale-2m.ndjson.gz"
});

const EDGE_TYPES = Object.freeze([
  "SUPPORTED_BY",
  "BASED_ON",
  "IMPLEMENTS",
  "RELATES_TO",
  "CONSTRAINS",
  "DERIVED_FROM"
]);

const integerArg = (name, fallback) => {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid --${name}; expected a positive safe integer`);
  }
  return value;
};

const stringArg = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};

const percentile = (sorted, p) => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
};

const edgeCoordinates = (globalIndex, projects, nodesPerProject) => {
  const projectIndex = globalIndex % projects;
  const localEdgeIndex = Math.floor(globalIndex / projects);
  const fromIndex = localEdgeIndex % nodesPerProject;
  let toIndex =
    (fromIndex * 17 + localEdgeIndex * 13 + projectIndex * 7 + 1) % nodesPerProject;
  if (toIndex === fromIndex) toIndex = (toIndex + 1) % nodesPerProject;
  return { projectIndex, localEdgeIndex, fromIndex, toIndex };
};

const validateCoordinates = (coordinates, nodesPerProject) => {
  const { localEdgeIndex, fromIndex, toIndex } = coordinates;
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= nodesPerProject ||
    toIndex >= nodesPerProject
  ) {
    throw new Error(`Endpoint out of range at local index ${localEdgeIndex}`);
  }
  if (fromIndex === toIndex) {
    throw new Error(`Self edge at local index ${localEdgeIndex}`);
  }
};

const edgeLine = (coordinates) => {
  const { projectIndex, localEdgeIndex, fromIndex, toIndex } = coordinates;
  const type = EDGE_TYPES[localEdgeIndex % EDGE_TYPES.length];
  return (
    `{"edge_id":"synthetic:p${projectIndex}:e${localEdgeIndex}",` +
    `"edge_version":1,"type":"${type}","owner_id":"synthetic-owner",` +
    `"project_id":"synthetic-project-${projectIndex}",` +
    `"from":{"id":"synthetic:p${projectIndex}:n${fromIndex}","version":1},` +
    `"to":{"id":"synthetic:p${projectIndex}:n${toIndex}","version":1},` +
    `"verification_status":"verified","provenance_kind":"deterministic_derivation",` +
    `"created_at":"2026-09-29T00:00:00.000Z"}\n`
  );
};

const buildProjectAdjacency = (projectIndex, edgeCount, projects, nodesPerProject) => {
  const adjacency = Array.from({ length: nodesPerProject }, () => []);
  for (let globalIndex = projectIndex; globalIndex < edgeCount; globalIndex += projects) {
    const coordinates = edgeCoordinates(globalIndex, projects, nodesPerProject);
    validateCoordinates(coordinates, nodesPerProject);
    adjacency[coordinates.fromIndex].push(coordinates.toIndex);
    adjacency[coordinates.toIndex].push(coordinates.fromIndex);
  }
  return adjacency;
};

const boundedTraversal = (adjacency, seed, limits) => {
  const visited = new Set([seed]);
  const queue = [{ node: seed, depth: 0 }];
  let head = 0;
  let edgesVisited = 0;

  while (
    head < queue.length &&
    visited.size < limits.maxNodes &&
    edgesVisited < limits.maxEdges
  ) {
    const current = queue[head];
    head += 1;
    if (!current || current.depth >= limits.maxDepth) continue;
    const neighbors = adjacency[current.node] ?? [];
    const fanout = Math.min(neighbors.length, limits.maxFanout);
    for (let i = 0; i < fanout; i += 1) {
      if (edgesVisited >= limits.maxEdges || visited.size >= limits.maxNodes) break;
      const next = neighbors[i];
      if (next === undefined) continue;
      edgesVisited += 1;
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push({ node: next, depth: current.depth + 1 });
    }
  }

  return { nodesVisited: visited.size, edgesVisited };
};

const benchmarkProject = (edgeCount, projects, nodesPerProject) => {
  const before = process.memoryUsage().rss;
  const buildStarted = performance.now();
  const adjacency = buildProjectAdjacency(0, edgeCount, projects, nodesPerProject);
  const buildMs = performance.now() - buildStarted;
  const after = process.memoryUsage().rss;

  const timings = [];
  let maxNodesVisited = 0;
  let maxEdgesVisited = 0;
  for (let i = 0; i < 100; i += 1) {
    const seed = (i * 97) % nodesPerProject;
    const started = performance.now();
    const result = boundedTraversal(adjacency, seed, {
      maxDepth: 3,
      maxNodes: 64,
      maxEdges: 128,
      maxFanout: 8
    });
    timings.push(performance.now() - started);
    maxNodesVisited = Math.max(maxNodesVisited, result.nodesVisited);
    maxEdgesVisited = Math.max(maxEdgesVisited, result.edgesVisited);
  }
  timings.sort((left, right) => left - right);

  return {
    project_index: 0,
    project_edges: Math.ceil(edgeCount / projects),
    nodes_per_project: nodesPerProject,
    adjacency_build_ms: Number(buildMs.toFixed(3)),
    adjacency_rss_delta_bytes: Math.max(0, after - before),
    bounded_query_runs: timings.length,
    bounded_query_p50_ms: Number(percentile(timings, 0.5).toFixed(6)),
    bounded_query_p95_ms: Number(percentile(timings, 0.95).toFixed(6)),
    bounded_query_max_nodes_visited: maxNodesVisited,
    bounded_query_max_edges_visited: maxEdgesVisited
  };
};

const main = async () => {
  const edgeCount = integerArg("edges", DEFAULTS.edges);
  const projects = integerArg("projects", DEFAULTS.projects);
  const nodesPerProject = integerArg("nodes-per-project", DEFAULTS.nodesPerProject);
  const output = stringArg("output", DEFAULTS.output);
  if (projects > edgeCount) throw new Error("--projects cannot exceed --edges");
  if (nodesPerProject < 2) throw new Error("--nodes-per-project must be at least 2");

  const started = performance.now();
  const hash = createHash("sha256");
  const gzip = createGzip({ level: 1 });
  const destination = createWriteStream(output, { flags: "w" });
  gzip.pipe(destination);

  let logicalBytes = 0;
  let peakRssBytes = process.memoryUsage().rss;
  const projectCounts = Array.from({ length: projects }, () => 0);
  let batch = "";
  const flushBatch = async () => {
    if (!batch) return;
    logicalBytes += Buffer.byteLength(batch);
    hash.update(batch);
    const chunk = batch;
    batch = "";
    if (!gzip.write(chunk)) await once(gzip, "drain");
  };

  for (let globalIndex = 0; globalIndex < edgeCount; globalIndex += 1) {
    const coordinates = edgeCoordinates(globalIndex, projects, nodesPerProject);
    validateCoordinates(coordinates, nodesPerProject);
    projectCounts[coordinates.projectIndex] += 1;
    batch += edgeLine(coordinates);

    if ((globalIndex + 1) % 5_000 === 0) await flushBatch();
    if (globalIndex % 100_000 === 0) {
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }
  }
  await flushBatch();

  gzip.end();
  await once(destination, "close");
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);

  const expectedMin = Math.floor(edgeCount / projects);
  const expectedMax = Math.ceil(edgeCount / projects);
  if (projectCounts.some((count) => count < expectedMin || count > expectedMax)) {
    throw new Error("Synthetic project distribution invariant failed");
  }

  const traversal = benchmarkProject(edgeCount, projects, nodesPerProject);
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  const elapsedMs = performance.now() - started;
  const compressedBytes = statSync(output).size;

  const manifest = {
    format: "cosmora-intelligence-graph-scale-v1",
    generated_at: new Date().toISOString(),
    synthetic_only: true,
    edge_count: edgeCount,
    project_count: projects,
    nodes_per_project: nodesPerProject,
    total_logical_nodes: projects * nodesPerProject,
    edge_types: EDGE_TYPES,
    invariants: {
      same_owner: true,
      same_project_endpoints: true,
      no_self_edges: true,
      deterministic_ids: true,
      deterministic_content: true
    },
    output,
    logical_ndjson_bytes: logicalBytes,
    compressed_bytes: compressedBytes,
    compression_ratio: Number((compressedBytes / logicalBytes).toFixed(6)),
    logical_sha256: hash.digest("hex"),
    generation_elapsed_ms: Number(elapsedMs.toFixed(3)),
    generation_edges_per_second: Number((edgeCount / (elapsedMs / 1000)).toFixed(2)),
    peak_rss_bytes: peakRssBytes,
    traversal
  };

  const manifestPath = `${output}.manifest.json`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...manifest, manifest: manifestPath }, null, 2)}\n`);
};

await main();
