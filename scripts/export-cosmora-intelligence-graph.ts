import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cosmoraUnifiedKnowledgeGraph } from "../packages/core/test/fixtures/cosmora-unified-knowledge-graph.js";

const outputDirArgument = process.argv.find((arg) => arg.startsWith("--output-dir="));
const outputDir = resolve(
  process.cwd(),
  outputDirArgument?.slice("--output-dir=".length) ?? "knowledge/cosmora/generated"
);

const graph = cosmoraUnifiedKnowledgeGraph();

const versionKey = (id: string, version: number): string => `${id}@${version}`;
const nodes = [...graph.nodes].sort((left, right) =>
  versionKey(left.node_id, left.node_version).localeCompare(
    versionKey(right.node_id, right.node_version)
  )
);
const edges = [...graph.edges].sort((left, right) =>
  versionKey(left.edge_id, left.edge_version).localeCompare(
    versionKey(right.edge_id, right.edge_version)
  )
);
const records = [...graph.records].sort((left, right) =>
  versionKey(left.node.id, left.node.version).localeCompare(
    versionKey(right.node.id, right.node.version)
  )
);

const ndjson = (rows: readonly unknown[]): string =>
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

const files = {
  "nodes.ndjson": ndjson(nodes),
  "edges.ndjson": ndjson(edges),
  "records.ndjson": ndjson(records),
  "snapshot.json":
    JSON.stringify(
      {
        schema_version: 1,
        graph_id: "cosmora-nexus-os-knowledge",
        owner_id: "owner-cosmora",
        project_id: "project-nexus-os",
        nodes,
        edges,
        records
      },
      null,
      2
    ) + "\n"
};

mkdirSync(outputDir, { recursive: true });

const hashes: Record<string, string> = {};
for (const [name, value] of Object.entries(files)) {
  writeFileSync(resolve(outputDir, name), value, "utf8");
  hashes[name] = createHash("sha256").update(value).digest("hex");
}

const verificationCounts = {
  nodes: Object.fromEntries(
    [...new Set(nodes.map((node) => node.verification_status))]
      .sort()
      .map((status) => [status, nodes.filter((node) => node.verification_status === status).length])
  ),
  edges: Object.fromEntries(
    [...new Set(edges.map((edge) => edge.verification_status))]
      .sort()
      .map((status) => [status, edges.filter((edge) => edge.verification_status === status).length])
  )
};

const manifest = {
  schema_version: 1,
  graph_id: "cosmora-nexus-os-knowledge",
  generated_at: new Date().toISOString(),
  authoritative_main_sha: "62bc5234b24e3b0c10262b043063fd31be9732bd",
  counts: {
    nodes: nodes.length,
    edges: edges.length,
    records: records.length
  },
  verification_counts: verificationCounts,
  files: Object.fromEntries(
    Object.entries(files).map(([name, value]) => [
      name,
      {
        bytes: Buffer.byteLength(value),
        sha256: hashes[name]
      }
    ])
  ),
  policy: {
    verified_only_excludes_open_review_candidates: true,
    synthetic_2m_benchmark_included: false,
    private_chat_persistence_allowed: false,
    secrets_allowed: false
  }
};

writeFileSync(
  resolve(outputDir, "manifest.generated.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8"
);

process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
