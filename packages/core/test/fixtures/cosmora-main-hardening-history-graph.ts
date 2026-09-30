import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";

const rows = [
  {
    sha: "5d268cb7cab5a8355af108eb59fc28e0b79a152b",
    id: "event-main-5d268cb7",
    createdAt: "2026-09-19T14:33:33.000Z",
    message: "reject whitespace-only model credentials",
    files: [
      "packages/config/src/index.ts",
      "packages/config/src/secrets.ts",
      "packages/config/test/config.test.ts",
      "packages/config/test/secrets.test.ts"
    ]
  },
  {
    sha: "9d35d7d9a42ca7e8ae2810a4af6e19c494ef608e",
    id: "event-main-9d35d7d9",
    createdAt: "2026-09-19T14:33:40.000Z",
    message: "harden shared identifiers and stream metadata",
    files: [
      "packages/contracts/src/events.ts",
      "packages/contracts/src/primitives.ts",
      "packages/contracts/test/contracts.test.ts"
    ]
  },
  {
    sha: "e28ca53398d8e94db8bd9cf6d5e3c5fdcc55a0c2",
    id: "event-main-e28ca533",
    createdAt: "2026-09-19T14:33:48.000Z",
    message: "broaden repository secret scan",
    files: ["scripts/check-secrets.mjs"]
  },
  {
    sha: "08e7115501135e3f29c41f98cbb1c24189173025",
    id: "event-main-08e71155",
    createdAt: "2026-09-19T14:42:31.000Z",
    message: "harden direct request identities and control options",
    files: [
      "packages/core/src/model-service-options.ts",
      "packages/core/test/chat.test.ts",
      "packages/core/test/manager.test.ts"
    ]
  },
  {
    sha: "24fafa159a83dc37ddf75447c5a599590bf76453",
    id: "event-main-24fafa15",
    createdAt: "2026-09-19T14:42:35.000Z",
    message: "harden external provider identity and base URL",
    files: ["packages/config/src/index.ts", "packages/config/test/config.test.ts"]
  },
  {
    sha: "1447f169606532001cef5737fe23802b4a599e12",
    id: "event-main-1447f169",
    createdAt: "2026-09-19T15:30:51.000Z",
    message: "harden provider-neutral model envelopes",
    files: ["packages/contracts/src/model.ts", "packages/contracts/test/contracts.test.ts"]
  },
  {
    sha: "c425d19d7b32f8b792fbd836e75dced7f15d32c6",
    id: "event-main-c425d19d",
    createdAt: "2026-09-19T15:30:54.000Z",
    message: "safely parse local preflight origins",
    files: [
      "scripts/demo-preflight.mjs",
      "scripts/manager-live-preflight.mjs",
      "scripts/manager-live-smoke.mjs"
    ]
  },
  {
    sha: "9d8b8207eba1c41e631d4856113832915efd2ac3",
    id: "event-main-9d8b8207",
    createdAt: "2026-09-19T15:30:58.000Z",
    message: "scan committed dotenv variants",
    files: ["scripts/check-secrets.mjs"]
  },
  {
    sha: "bd66e37c80bf3741954a0dfc308940000d1efa2b",
    id: "event-main-bd66e37c",
    createdAt: "2026-09-19T15:31:01.000Z",
    message: "reject non-canonical external model values",
    files: ["packages/config/src/index.ts", "packages/config/test/config.test.ts"]
  },
  {
    sha: "6b064d172ce5063cf9b5de25c72f7c56a45d44b3",
    id: "event-main-6b064d17",
    createdAt: "2026-09-19T15:31:05.000Z",
    message: "align routing identifiers with model contracts",
    files: [
      "packages/core/src/model-service-options.ts",
      "packages/core/test/chat.test.ts",
      "packages/core/test/manager.test.ts"
    ]
  },
  {
    sha: "bd7508fca1fe9798223e6d80d258bbf27d111f9e",
    id: "event-main-bd7508fc",
    createdAt: "2026-09-19T15:39:31.000Z",
    message: "reject padded environment secrets",
    files: ["packages/config/src/secrets.ts", "packages/config/test/secrets.test.ts"]
  }
] as const;

const scriptFiles = [
  "scripts/check-secrets.mjs",
  "scripts/demo-preflight.mjs",
  "scripts/manager-live-preflight.mjs",
  "scripts/manager-live-smoke.mjs"
] as const;

const scriptFileId = (path: string): string =>
  `history-file-${path.replaceAll("/", "-").replaceAll(".", "-")}`;

const eventNode = (row: (typeof rows)[number]): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: row.id,
  node_version: 1,
  kind: "Event",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: row.createdAt,
  observed_at: row.createdAt,
  valid_from: row.createdAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: { source_id: sourceId, source_version: 1, location: `commit:${row.sha}` },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "git-main-hardening-v1",
  supersedes: null,
  deleted_at: null
});

const scriptNode = (path: (typeof scriptFiles)[number]): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: scriptFileId(path),
  node_version: 1,
  kind: "Document",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: "2026-09-19T14:33:48.000Z",
  observed_at: "2026-09-19T14:33:48.000Z",
  valid_from: "2026-09-19T14:33:48.000Z",
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: { source_id: sourceId, source_version: 1, location: path },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "git-main-hardening-v1",
  supersedes: null,
  deleted_at: null
});

const edge = (input: {
  id: string;
  type: string;
  from: string;
  to: string;
  location: string;
  createdAt: string;
}): IntelligenceGraphEdge => ({
  contract_version: 1,
  edge_id: input.id,
  edge_version: 1,
  type: input.type,
  from: { id: input.from, version: 1 },
  to: { id: input.to, version: 1 },
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: input.createdAt,
  observed_at: input.createdAt,
  valid_from: input.createdAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  evidence_ref: { source_id: sourceId, source_version: 1, location: input.location },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "git-main-hardening-v1",
  supersedes: null,
  deleted_at: null
});

const scriptSet = new Set<string>(scriptFiles);
const nodes = [...rows.map(eventNode), ...scriptFiles.map(scriptNode)];
const changed: IntelligenceGraphEdge[] = [];

for (const row of rows) {
  for (const [index, path] of row.files.entries()) {
    changed.push(
      edge({
        id: `hardening-file-${row.sha.slice(0, 8)}-${index + 1}`,
        type: "CHANGED_FILE",
        from: row.id,
        to: scriptSet.has(path) ? scriptFileId(path) : repositoryStructureFileId(path),
        location: `commit:${row.sha}:${path}`,
        createdAt: row.createdAt
      })
    );
  }
}

const chronology: IntelligenceGraphEdge[] = rows.slice(0, -1).map((row, index) =>
  edge({
    id: `hardening-precedes-${index + 1}`,
    type: "PRECEDES",
    from: row.id,
    to: rows[index + 1]!.id,
    location: `git-history:${row.sha}->${rows[index + 1]!.sha}`,
    createdAt: rows[index + 1]!.createdAt
  })
);
chronology.push(
  edge({
    id: "hardening-precedes-core-request-bounds",
    type: "PRECEDES",
    from: rows.at(-1)!.id,
    to: "event-core-model-request-bounds",
    location:
      "git-history:bd7508fca1fe9798223e6d80d258bbf27d111f9e->f413dd2acd417a78d79b25d73a4454a2c860f5e3",
    createdAt: "2026-09-19T15:39:35.000Z"
  })
);

const semantic: IntelligenceGraphEdge[] = [
  edge({
    id: "hardening-secrets-config",
    type: "HARDENS",
    from: "event-main-5d268cb7",
    to: "module:packages/config",
    location: "commit:5d268cb7cab5a8355af108eb59fc28e0b79a152b",
    createdAt: "2026-09-19T14:33:33.000Z"
  }),
  edge({
    id: "hardening-model-envelope-contract",
    type: "HARDENS",
    from: "event-main-1447f169",
    to: "module:packages/contracts",
    location: "commit:1447f169606532001cef5737fe23802b4a599e12",
    createdAt: "2026-09-19T15:30:51.000Z"
  }),
  edge({
    id: "hardening-routing-core",
    type: "HARDENS",
    from: "event-main-6b064d17",
    to: "module:packages/core",
    location: "commit:6b064d172ce5063cf9b5de25c72f7c56a45d44b3",
    createdAt: "2026-09-19T15:31:05.000Z"
  }),
  edge({
    id: "hardening-secret-scan-project",
    type: "HARDENS",
    from: "event-main-9d8b8207",
    to: "project-cosmora-os",
    location: "commit:9d8b8207eba1c41e631d4856113832915efd2ac3",
    createdAt: "2026-09-19T15:30:58.000Z"
  })
];

const records: IntelligenceGraphSearchRecord[] = [
  ...rows.map((row) => ({
    node: { id: row.id, version: 1 },
    text: `merged main hardening commit ${row.sha.slice(0, 8)} ${row.message}`,
    excerpt: row.message,
    estimated_tokens: 14
  })),
  ...scriptFiles.map((path) => ({
    node: { id: scriptFileId(path), version: 1 },
    text: `repository script ${path}`,
    excerpt: path,
    estimated_tokens: 8
  }))
];

export const cosmoraMainHardeningHistoryGraph = () => ({
  nodes,
  edges: [...changed, ...chronology, ...semantic],
  records
});

export const COSMORA_MAIN_HARDENING_NODE_COUNT = nodes.length;
export const COSMORA_MAIN_HARDENING_EDGE_COUNT =
  changed.length + chronology.length + semantic.length;
