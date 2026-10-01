import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";

const event = (input: {
  id: string;
  sha: string;
  createdAt: string;
  text: string;
  excerpt: string;
}): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: "Event",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: input.createdAt,
  observed_at: input.createdAt,
  valid_from: input.createdAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: `commit:${input.sha}`
  },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "git-product-history-v1",
  supersedes: null,
  deleted_at: null
});

const entity = (input: {
  id: string;
  kind: "Entity" | "Document";
  text: string;
  excerpt: string;
  location: string;
  createdAt: string;
}): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: input.kind,
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: input.createdAt,
  observed_at: input.createdAt,
  valid_from: input.createdAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "git-product-history-v1",
  supersedes: null,
  deleted_at: null
});

const events = [
  event({
    id: "event-product-general-chat-background",
    sha: "f2e03211478530ff7d851638594bd6c8b94e9263",
    createdAt: "2026-09-17T17:23:51.000Z",
    text: "ordinary chat background execution runtime",
    excerpt:
      "Merged API change added background ordinary-chat coordination, routes and runtime storage."
  }),
  event({
    id: "event-product-model-status",
    sha: "59c7c2ba96e405a260ec05d360cad60026bca1ea",
    createdAt: "2026-09-17T17:47:10.000Z",
    text: "read only model connection status page",
    excerpt: "Merged web change added a read-only model connection status surface."
  }),
  event({
    id: "event-product-live-model-smoke",
    sha: "403ed7143f062bb005a21c2fe1dde53434394e2a",
    createdAt: "2026-09-17T19:55:17.000Z",
    text: "guarded live model smoke test",
    excerpt: "Merged change added a guarded live model smoke path."
  }),
  event({
    id: "event-product-non-api-alpha",
    sha: "e4f8b2b8da982f47b97dc8344e58285e87f4b182",
    createdAt: "2026-09-19T14:32:29.000Z",
    text: "integrated non API local alpha hardening",
    excerpt:
      "Merged web stack integrated safe project context, Agent Studio, model status, Skills, GitHub preview and owner surfaces."
  }),
  event({
    id: "event-product-loopback-proxy",
    sha: "53537bb8ebdf7d3275f67b4b154e3db953193152",
    createdAt: "2026-09-19T14:33:25.000Z",
    text: "restrict local API proxy to loopback origin",
    excerpt: "Merged web hardening restricted local API proxying to loopback origin."
  }),
  event({
    id: "event-product-core-request-validation",
    sha: "549eff68a319289519d8506818bf9d278d17d87a",
    createdAt: "2026-09-19T14:33:26.000Z",
    text: "validate direct model request construction",
    excerpt:
      "Merged core hardening validated Manager and chat request construction and normalized model options."
  }),
  event({
    id: "event-product-core-runtime-docs",
    sha: "488468904a4bfd974aa3ab59041b57b98853c2e5",
    createdAt: "2026-09-19T14:33:30.000Z",
    text: "document current core services and runtime boundary",
    excerpt: "Merged documentation described current core services and runtime boundary."
  }),
  event({
    id: "event-product-web-runtime-boundaries",
    sha: "5e0be783c3c81d33b42f50a4c619c6f9742e858f",
    createdAt: "2026-09-19T14:33:37.000Z",
    text: "enforce web runtime architecture boundaries",
    excerpt: "Merged contract tests enforce web runtime architecture boundaries."
  })
] as const;

const generalChat = entity({
  id: "entity-general-chat-runtime",
  kind: "Entity",
  text: "ordinary chat background runtime",
  excerpt: "Background execution coordinator, routes and runtime store for ordinary chat runs.",
  location: "apps/api/src/general-chat-background-run-coordinator.ts",
  createdAt: "2026-09-17T17:23:51.000Z"
});
const modelStatus = entity({
  id: "entity-model-status-surface",
  kind: "Entity",
  text: "read only model connection status surface",
  excerpt: "Owner-visible read-only model connection status page.",
  location: "apps/web/src/app/model-status/page.tsx",
  createdAt: "2026-09-17T17:47:10.000Z"
});
const coreRuntimeReadme = entity({
  id: "doc-core-runtime-boundary",
  kind: "Document",
  text: "core services runtime boundary documentation",
  excerpt: "Repository documentation for the current core services and runtime boundary.",
  location: "packages/core/README.md",
  createdAt: "2026-09-19T14:33:30.000Z"
});
const webProxyConfig = entity({
  id: "doc-web-next-config",
  kind: "Document",
  text: "web local API proxy configuration",
  excerpt: "Next.js configuration containing the local API proxy boundary.",
  location: "apps/web/next.config.ts",
  createdAt: "2026-09-19T14:33:25.000Z"
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
  evidence_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "git-product-history-v1",
  supersedes: null,
  deleted_at: null
});

const edges: IntelligenceGraphEdge[] = [
  edge({
    id: "product-chat-produces-runtime",
    type: "PRODUCES",
    from: "event-product-general-chat-background",
    to: generalChat.node_id,
    location: "commit:f2e03211478530ff7d851638594bd6c8b94e9263",
    createdAt: "2026-09-17T17:23:51.000Z"
  }),
  edge({
    id: "product-chat-coordinator-file",
    type: "IMPLEMENTED_IN_FILE",
    from: generalChat.node_id,
    to: repositoryStructureFileId("apps/api/src/general-chat-background-run-coordinator.ts"),
    location: "apps/api/src/general-chat-background-run-coordinator.ts",
    createdAt: "2026-09-17T17:23:51.000Z"
  }),
  edge({
    id: "product-chat-routes-file",
    type: "EXPOSED_BY_FILE",
    from: generalChat.node_id,
    to: repositoryStructureFileId("apps/api/src/general-chat-routes.ts"),
    location: "apps/api/src/general-chat-routes.ts",
    createdAt: "2026-09-17T17:23:51.000Z"
  }),
  edge({
    id: "product-chat-store-file",
    type: "PERSISTED_BY",
    from: generalChat.node_id,
    to: repositoryStructureFileId("apps/api/src/general-chat-runtime-store.ts"),
    location: "apps/api/src/general-chat-runtime-store.ts",
    createdAt: "2026-09-17T17:23:51.000Z"
  }),
  edge({
    id: "product-chat-regression",
    type: "VERIFIED_BY_TEST",
    from: generalChat.node_id,
    to: repositoryStructureFileId(
      "apps/api/test/general-chat-background-run-coordinator.test.ts"
    ),
    location: "apps/api/test/general-chat-background-run-coordinator.test.ts",
    createdAt: "2026-09-17T17:23:51.000Z"
  }),
  edge({
    id: "product-model-status-produces",
    type: "PRODUCES",
    from: "event-product-model-status",
    to: modelStatus.node_id,
    location: "commit:59c7c2ba96e405a260ec05d360cad60026bca1ea",
    createdAt: "2026-09-17T17:47:10.000Z"
  }),
  edge({
    id: "product-model-status-file",
    type: "IMPLEMENTED_IN_FILE",
    from: modelStatus.node_id,
    to: repositoryStructureFileId("apps/web/src/app/model-status/page.tsx"),
    location: "apps/web/src/app/model-status/page.tsx",
    createdAt: "2026-09-17T17:47:10.000Z"
  }),
  edge({
    id: "product-model-status-observes-registry",
    type: "OBSERVES",
    from: modelStatus.node_id,
    to: "entity-model-registry",
    location: "commit:59c7c2ba96e405a260ec05d360cad60026bca1ea",
    createdAt: "2026-09-17T17:47:10.000Z"
  }),
  edge({
    id: "product-live-smoke-tests-gateway",
    type: "SMOKE_TESTS",
    from: "event-product-live-model-smoke",
    to: "entity-model-gateway",
    location: "commit:403ed7143f062bb005a21c2fe1dde53434394e2a",
    createdAt: "2026-09-17T19:55:17.000Z"
  }),
  edge({
    id: "product-live-smoke-script",
    type: "IMPLEMENTED_IN_FILE",
    from: "event-product-live-model-smoke",
    to: "history-file-scripts-manager-live-smoke-mjs",
    location: "scripts/manager-live-smoke.mjs",
    createdAt: "2026-09-17T19:55:17.000Z"
  }),
  edge({
    id: "product-alpha-context",
    type: "INTEGRATES",
    from: "event-product-non-api-alpha",
    to: "entity-project-context-panel",
    location: "apps/web/src/app/project-context-panel.tsx",
    createdAt: "2026-09-19T14:32:29.000Z"
  }),
  edge({
    id: "product-alpha-agent-studio",
    type: "INTEGRATES",
    from: "event-product-non-api-alpha",
    to: "entity-agent-instance",
    location: "apps/web/src/app/agent-studio/page.tsx",
    createdAt: "2026-09-19T14:32:29.000Z"
  }),
  edge({
    id: "product-alpha-model-status",
    type: "INTEGRATES",
    from: "event-product-non-api-alpha",
    to: modelStatus.node_id,
    location: "apps/web/src/app/model-status/page.tsx",
    createdAt: "2026-09-19T14:32:29.000Z"
  }),
  edge({
    id: "product-alpha-project-context-file",
    type: "CHANGED_FILE",
    from: "event-product-non-api-alpha",
    to: repositoryStructureFileId("apps/web/src/app/project-context-panel.tsx"),
    location:
      "commit:e4f8b2b8da982f47b97dc8344e58285e87f4b182:apps/web/src/app/project-context-panel.tsx",
    createdAt: "2026-09-19T14:32:29.000Z"
  }),
  edge({
    id: "product-loopback-produces-config",
    type: "PRODUCES",
    from: "event-product-loopback-proxy",
    to: webProxyConfig.node_id,
    location: "commit:53537bb8ebdf7d3275f67b4b154e3db953193152",
    createdAt: "2026-09-19T14:33:25.000Z"
  }),
  edge({
    id: "product-loopback-hardens-project",
    type: "HARDENS",
    from: "event-product-loopback-proxy",
    to: "project-cosmora-os",
    location: "apps/web/next.config.ts",
    createdAt: "2026-09-19T14:33:25.000Z"
  }),
  edge({
    id: "product-core-request-chat",
    type: "HARDENS",
    from: "event-product-core-request-validation",
    to: repositoryStructureFileId("packages/core/src/chat.ts"),
    location:
      "commit:549eff68a319289519d8506818bf9d278d17d87a:packages/core/src/chat.ts",
    createdAt: "2026-09-19T14:33:26.000Z"
  }),
  edge({
    id: "product-core-request-manager",
    type: "HARDENS",
    from: "event-product-core-request-validation",
    to: repositoryStructureFileId("packages/core/src/manager.ts"),
    location:
      "commit:549eff68a319289519d8506818bf9d278d17d87a:packages/core/src/manager.ts",
    createdAt: "2026-09-19T14:33:26.000Z"
  }),
  edge({
    id: "product-core-request-options",
    type: "HARDENS",
    from: "event-product-core-request-validation",
    to: repositoryStructureFileId("packages/core/src/model-service-options.ts"),
    location:
      "commit:549eff68a319289519d8506818bf9d278d17d87a:packages/core/src/model-service-options.ts",
    createdAt: "2026-09-19T14:33:26.000Z"
  }),
  edge({
    id: "product-core-request-chat-test",
    type: "VERIFIED_BY_TEST",
    from: "event-product-core-request-validation",
    to: repositoryStructureFileId("packages/core/test/chat.test.ts"),
    location: "packages/core/test/chat.test.ts",
    createdAt: "2026-09-19T14:33:26.000Z"
  }),
  edge({
    id: "product-core-request-manager-test",
    type: "VERIFIED_BY_TEST",
    from: "event-product-core-request-validation",
    to: repositoryStructureFileId("packages/core/test/manager.test.ts"),
    location: "packages/core/test/manager.test.ts",
    createdAt: "2026-09-19T14:33:26.000Z"
  }),
  edge({
    id: "product-core-docs-produces",
    type: "PRODUCES",
    from: "event-product-core-runtime-docs",
    to: coreRuntimeReadme.node_id,
    location: "commit:488468904a4bfd974aa3ab59041b57b98853c2e5",
    createdAt: "2026-09-19T14:33:30.000Z"
  }),
  edge({
    id: "product-web-boundary-test",
    type: "VERIFIES_ARCHITECTURE_BOUNDARY",
    from: "event-product-web-runtime-boundaries",
    to: repositoryStructureFileId("packages/contracts/test/architecture-boundaries.test.ts"),
    location: "packages/contracts/test/architecture-boundaries.test.ts",
    createdAt: "2026-09-19T14:33:37.000Z"
  }),
  edge({
    id: "product-web-boundary-project",
    type: "HARDENS",
    from: "event-product-web-runtime-boundaries",
    to: "project-cosmora-os",
    location: "commit:5e0be783c3c81d33b42f50a4c619c6f9742e858f",
    createdAt: "2026-09-19T14:33:37.000Z"
  }),
  edge({
    id: "product-general-chat-precedes-status",
    type: "PRECEDES",
    from: "event-product-general-chat-background",
    to: "event-product-model-status",
    location:
      "git-history:f2e03211478530ff7d851638594bd6c8b94e9263->59c7c2ba96e405a260ec05d360cad60026bca1ea",
    createdAt: "2026-09-17T17:47:10.000Z"
  }),
  edge({
    id: "product-status-precedes-smoke",
    type: "PRECEDES",
    from: "event-product-model-status",
    to: "event-product-live-model-smoke",
    location:
      "git-history:59c7c2ba96e405a260ec05d360cad60026bca1ea->403ed7143f062bb005a21c2fe1dde53434394e2a",
    createdAt: "2026-09-17T19:55:17.000Z"
  }),
  edge({
    id: "product-smoke-precedes-alpha",
    type: "PRECEDES",
    from: "event-product-live-model-smoke",
    to: "event-product-non-api-alpha",
    location:
      "git-history:403ed7143f062bb005a21c2fe1dde53434394e2a->e4f8b2b8da982f47b97dc8344e58285e87f4b182",
    createdAt: "2026-09-19T14:32:29.000Z"
  }),
  edge({
    id: "product-alpha-precedes-loopback",
    type: "PRECEDES",
    from: "event-product-non-api-alpha",
    to: "event-product-loopback-proxy",
    location:
      "git-history:e4f8b2b8da982f47b97dc8344e58285e87f4b182->53537bb8ebdf7d3275f67b4b154e3db953193152",
    createdAt: "2026-09-19T14:33:25.000Z"
  }),
  edge({
    id: "product-loopback-precedes-request-validation",
    type: "PRECEDES",
    from: "event-product-loopback-proxy",
    to: "event-product-core-request-validation",
    location:
      "git-history:53537bb8ebdf7d3275f67b4b154e3db953193152->549eff68a319289519d8506818bf9d278d17d87a",
    createdAt: "2026-09-19T14:33:26.000Z"
  }),
  edge({
    id: "product-request-precedes-runtime-docs",
    type: "PRECEDES",
    from: "event-product-core-request-validation",
    to: "event-product-core-runtime-docs",
    location:
      "git-history:549eff68a319289519d8506818bf9d278d17d87a->488468904a4bfd974aa3ab59041b57b98853c2e5",
    createdAt: "2026-09-19T14:33:30.000Z"
  }),
  edge({
    id: "product-runtime-docs-precedes-credentials",
    type: "PRECEDES",
    from: "event-product-core-runtime-docs",
    to: "event-main-5d268cb7",
    location:
      "git-history:488468904a4bfd974aa3ab59041b57b98853c2e5->5d268cb7cab5a8355af108eb59fc28e0b79a152b",
    createdAt: "2026-09-19T14:33:33.000Z"
  }),
  edge({
    id: "product-credentials-precedes-web-boundaries",
    type: "PRECEDES",
    from: "event-main-5d268cb7",
    to: "event-product-web-runtime-boundaries",
    location:
      "git-history:5d268cb7cab5a8355af108eb59fc28e0b79a152b->5e0be783c3c81d33b42f50a4c619c6f9742e858f",
    createdAt: "2026-09-19T14:33:37.000Z"
  }),
  edge({
    id: "product-web-boundaries-precedes-shared-identifiers",
    type: "PRECEDES",
    from: "event-product-web-runtime-boundaries",
    to: "event-main-9d35d7d9",
    location:
      "git-history:5e0be783c3c81d33b42f50a4c619c6f9742e858f->9d35d7d9a42ca7e8ae2810a4af6e19c494ef608e",
    createdAt: "2026-09-19T14:33:40.000Z"
  })
];

const nodes = [
  ...events,
  generalChat,
  modelStatus,
  coreRuntimeReadme,
  webProxyConfig
];

const records: IntelligenceGraphSearchRecord[] = nodes.map((node) => ({
  node: { id: node.node_id, version: 1 },
  text: node.node_id.replaceAll("-", " "),
  excerpt: node.source_ref.location,
  estimated_tokens: 12
}));

export const cosmoraProductHistoryGraph = () => ({ nodes, edges, records });

export const COSMORA_PRODUCT_HISTORY_NODE_COUNT = nodes.length;
export const COSMORA_PRODUCT_HISTORY_EDGE_COUNT = edges.length;
