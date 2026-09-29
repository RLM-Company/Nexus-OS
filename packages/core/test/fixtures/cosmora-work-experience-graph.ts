import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";

const eventNode = (input: {
  id: string;
  sha: string;
  text: string;
  excerpt: string;
  createdAt: string;
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
  extractor_version: "git-work-experience-v1",
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
  evidence_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "git-work-experience-v1",
  supersedes: null,
  deleted_at: null
});

const newEvents = [
  eventNode({
    id: "event-stream-metadata-hardening",
    sha: "7acf996832b22b24d0b4ce2b072a07ab1c5d7d9c",
    text: "stream completion metadata canonicalization hardening",
    excerpt: "Contracts canonicalized stream completion metadata and added regression coverage.",
    createdAt: "2026-09-19T18:09:36.000Z"
  }),
  eventNode({
    id: "event-model-request-contract-bounds",
    sha: "1a710aa4a58853d60b03d885c29cc0528b293881",
    text: "model request contract bounds hardening",
    excerpt: "Shared model request limits were tightened and covered by contract tests.",
    createdAt: "2026-09-19T15:39:38.000Z"
  }),
  eventNode({
    id: "event-core-model-request-bounds",
    sha: "f413dd2acd417a78d79b25d73a4454a2c860f5e3",
    text: "core direct model request bounds hardening",
    excerpt: "Core direct request option construction was bounded with Manager and chat regression tests.",
    createdAt: "2026-09-19T15:39:35.000Z"
  })
] as const;

const changed = [
  ["event-manager-runtime","62bc5234b24e3b0c10262b043063fd31be9732bd","2026-09-26T11:00:05.000Z","apps/api/src/manager-work-coordinator.ts"],
  ["event-manager-runtime","62bc5234b24e3b0c10262b043063fd31be9732bd","2026-09-26T11:00:05.000Z","apps/api/src/manager-work-routes.ts"],
  ["event-manager-runtime","62bc5234b24e3b0c10262b043063fd31be9732bd","2026-09-26T11:00:05.000Z","apps/api/src/app.ts"],
  ["event-manager-runtime","62bc5234b24e3b0c10262b043063fd31be9732bd","2026-09-26T11:00:05.000Z","packages/contracts/src/manager-work.ts"],
  ["event-manager-runtime","62bc5234b24e3b0c10262b043063fd31be9732bd","2026-09-26T11:00:05.000Z","packages/db/src/manager-work-store.ts"],
  ["event-manager-runtime","62bc5234b24e3b0c10262b043063fd31be9732bd","2026-09-26T11:00:05.000Z","packages/db/src/usage-store.ts"],
  ["event-manager-runtime","62bc5234b24e3b0c10262b043063fd31be9732bd","2026-09-26T11:00:05.000Z","packages/model-gateway/src/gateway.ts"],
  ["event-manager-runtime","62bc5234b24e3b0c10262b043063fd31be9732bd","2026-09-26T11:00:05.000Z","packages/policy-engine/src/index.ts"],
  ["event-manager-runtime","62bc5234b24e3b0c10262b043063fd31be9732bd","2026-09-26T11:00:05.000Z","packages/tool-runtime/src/index.ts"],
  ["event-auth-contract","b2b5030abbfba72ae61ac018bbcec6dd64bff2cb","2026-09-19T18:26:36.000Z","packages/contracts/src/auth.ts"],
  ["event-auth-contract","b2b5030abbfba72ae61ac018bbcec6dd64bff2cb","2026-09-19T18:26:36.000Z","packages/contracts/src/index.ts"],
  ["event-auth-contract","b2b5030abbfba72ae61ac018bbcec6dd64bff2cb","2026-09-19T18:26:36.000Z","packages/contracts/test/contracts.test.ts"],
  ["event-companion-contract","479c01626e71e5e1f6cb69f9bdd4f95514f82d52","2026-09-19T18:18:11.000Z","packages/contracts/src/companion.ts"],
  ["event-companion-contract","479c01626e71e5e1f6cb69f9bdd4f95514f82d52","2026-09-19T18:18:11.000Z","packages/contracts/src/index.ts"],
  ["event-companion-contract","479c01626e71e5e1f6cb69f9bdd4f95514f82d52","2026-09-19T18:18:11.000Z","packages/contracts/test/contracts.test.ts"],
  ["event-stream-metadata-hardening","7acf996832b22b24d0b4ce2b072a07ab1c5d7d9c","2026-09-19T18:09:36.000Z","packages/contracts/src/events.ts"],
  ["event-stream-metadata-hardening","7acf996832b22b24d0b4ce2b072a07ab1c5d7d9c","2026-09-19T18:09:36.000Z","packages/contracts/test/contracts.test.ts"],
  ["event-model-request-contract-bounds","1a710aa4a58853d60b03d885c29cc0528b293881","2026-09-19T15:39:38.000Z","packages/contracts/src/model.ts"],
  ["event-model-request-contract-bounds","1a710aa4a58853d60b03d885c29cc0528b293881","2026-09-19T15:39:38.000Z","packages/contracts/test/contracts.test.ts"],
  ["event-core-model-request-bounds","f413dd2acd417a78d79b25d73a4454a2c860f5e3","2026-09-19T15:39:35.000Z","packages/core/src/model-service-options.ts"],
  ["event-core-model-request-bounds","f413dd2acd417a78d79b25d73a4454a2c860f5e3","2026-09-19T15:39:35.000Z","packages/core/test/chat.test.ts"],
  ["event-core-model-request-bounds","f413dd2acd417a78d79b25d73a4454a2c860f5e3","2026-09-19T15:39:35.000Z","packages/core/test/manager.test.ts"]
] as const;

const changedFileEdges = changed.map(([eventId, sha, createdAt, path], index) =>
  edge({
    id: `work-changed-file-${index + 1}`,
    type: "CHANGED_FILE",
    from: eventId,
    to: repositoryStructureFileId(path),
    location: `commit:${sha}:${path}`,
    createdAt
  })
);

const chronology = [
  ["event-core-model-request-bounds","event-model-request-contract-bounds","2026-09-19T15:39:38.000Z"],
  ["event-model-request-contract-bounds","event-stream-metadata-hardening","2026-09-19T18:09:36.000Z"],
  ["event-stream-metadata-hardening","event-companion-contract","2026-09-19T18:18:11.000Z"],
  ["event-companion-contract","event-auth-contract","2026-09-19T18:26:36.000Z"],
  ["event-auth-contract","event-manager-runtime","2026-09-26T11:00:05.000Z"]
] as const;

const chronologyEdges = chronology.map(([from, to, createdAt], index) =>
  edge({
    id: `work-precedes-${index + 1}`,
    type: "PRECEDES",
    from,
    to,
    location: `git-history:${from}->${to}`,
    createdAt
  })
);

export const cosmoraWorkExperienceGraph = (): {
  nodes: IntelligenceGraphNode[];
  edges: IntelligenceGraphEdge[];
} => ({
  nodes: [...newEvents],
  edges: [...changedFileEdges, ...chronologyEdges]
});

export const COSMORA_WORK_EXPERIENCE_NEW_NODE_COUNT = newEvents.length;
export const COSMORA_WORK_EXPERIENCE_EDGE_COUNT =
  changedFileEdges.length + chronologyEdges.length;
