import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-03T08:57:16.000Z";
const registryGeneratedAt = "2026-08-24T00:00:00.000Z";

const node = (input: {
  id: string;
  kind: IntelligenceGraphNode["kind"];
  location: string;
  validFrom?: string;
}): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: input.kind,
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: input.validFrom ?? registryGeneratedAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "document",
  confidence_method: "primary_source",
  extractor_version: "model-intelligence-v1",
  supersedes: null,
  deleted_at: null
});

const modelIntelligence = node({
  id: "entity-model-intelligence-graph",
  kind: "Entity",
  location: "docs/decisions/ADR-004-intelligence-graph-foundation.md:Model Intelligence Graph contract",
  validFrom: "2026-09-28T00:00:00.000Z"
});

const bootstrapModel = node({
  id: "model-version-mock-manager-b0-1",
  kind: "ModelVersion",
  location: "config/model-registry.v1.json:mock:manager-b0.1"
});

const registryDocument = node({
  id: "doc-model-registry-bootstrap-v1",
  kind: "Document",
  location: "config/model-registry.v1.json"
});

const recommendOnly = node({
  id: "claim-model-intelligence-recommend-only",
  kind: "Claim",
  location: "docs/decisions/ADR-004-intelligence-graph-foundation.md:Model Intelligence Graph contract",
  validFrom: "2026-09-28T00:00:00.000Z"
});

const evaluation = (id: string, location: string): IntelligenceGraphNode =>
  node({ id, kind: "Evaluation", location });

const evaluations = [
  evaluation(
    "evaluation-model-bootstrap-registry-evidence",
    "config/model-registry.v1.json:registry_version=b0.2-bootstrap-1"
  ),
  evaluation(
    "evaluation-model-bootstrap-streaming",
    "config/model-registry.v1.json:mock:manager-b0.1:capabilities.streaming"
  ),
  evaluation(
    "evaluation-model-bootstrap-confidential",
    "config/model-registry.v1.json:mock:manager-b0.1:privacy"
  ),
  evaluation(
    "evaluation-model-bootstrap-zero-cost",
    "config/model-registry.v1.json:mock:manager-b0.1:pricing"
  ),
  evaluation(
    "evaluation-model-router-hard-filter",
    "packages/model-gateway/src/router.ts:ModelRouter.resolve"
  ),
  evaluation(
    "evaluation-model-router-deterministic-score",
    "packages/model-gateway/src/router.ts:score"
  ),
  evaluation(
    "evaluation-model-runtime-registry-binding",
    "apps/api/src/model-runtime.ts:buildModelRuntime"
  )
] as const;

const edge = (input: {
  id: string;
  type: string;
  from: string;
  to: string;
  location: string;
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
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: registryGeneratedAt,
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
  extractor_version: "model-intelligence-v1",
  supersedes: null,
  deleted_at: null
});

const routerTest = repositoryStructureFileId("packages/model-gateway/test/router.test.ts");
const runtimeTest = repositoryStructureFileId("apps/api/test/model-runtime.test.ts");

const edges: IntelligenceGraphEdge[] = [
  edge({
    id: "model-intelligence-observes-registry",
    type: "OBSERVES",
    from: modelIntelligence.node_id,
    to: "entity-model-registry",
    location: "docs/decisions/ADR-004-intelligence-graph-foundation.md:Model Registry remains authority"
  }),
  edge({
    id: "model-intelligence-observes-router",
    type: "OBSERVES",
    from: modelIntelligence.node_id,
    to: "entity-router",
    location: "docs/decisions/ADR-004-intelligence-graph-foundation.md:Router authority"
  }),
  edge({
    id: "model-intelligence-observes-bootstrap-model",
    type: "OBSERVES",
    from: modelIntelligence.node_id,
    to: bootstrapModel.node_id,
    location: "config/model-registry.v1.json:mock:manager-b0.1"
  }),
  edge({
    id: "model-intelligence-recommend-only-boundary",
    type: "CONSTRAINED_BY",
    from: modelIntelligence.node_id,
    to: recommendOnly.node_id,
    location: "docs/decisions/ADR-004-intelligence-graph-foundation.md:observe/recommend-only"
  }),
  edge({
    id: "model-intelligence-not-registry-authority",
    type: "NOT_AUTHORITY_FOR",
    from: recommendOnly.node_id,
    to: "entity-model-registry",
    location: "docs/decisions/ADR-004-intelligence-graph-foundation.md:Model Registry remains authority"
  }),
  edge({
    id: "model-intelligence-not-router-authority",
    type: "NOT_AUTHORITY_FOR",
    from: recommendOnly.node_id,
    to: "entity-router",
    location: "docs/decisions/ADR-004-intelligence-graph-foundation.md:Router must not treat evaluation as permission"
  }),
  edge({
    id: "model-bootstrap-registered-in",
    type: "REGISTERED_IN",
    from: bootstrapModel.node_id,
    to: "entity-model-registry",
    location: "config/model-registry.v1.json:entries[0]"
  }),
  edge({
    id: "model-bootstrap-defined-by-document",
    type: "DEFINED_BY",
    from: bootstrapModel.node_id,
    to: registryDocument.node_id,
    location: "config/model-registry.v1.json"
  }),
  edge({
    id: "registry-document-describes-bootstrap",
    type: "DESCRIBES",
    from: registryDocument.node_id,
    to: bootstrapModel.node_id,
    location: "config/model-registry.v1.json:entries[0]"
  }),
  edge({
    id: "model-evidence-evaluates-bootstrap",
    type: "EVALUATES",
    from: "evaluation-model-bootstrap-registry-evidence",
    to: bootstrapModel.node_id,
    location: "config/model-registry.v1.json:registry_version=b0.2-bootstrap-1"
  }),
  edge({
    id: "model-evidence-uses-registry-document",
    type: "USES_EVIDENCE_FROM",
    from: "evaluation-model-bootstrap-registry-evidence",
    to: registryDocument.node_id,
    location: "config/model-registry.v1.json"
  }),
  edge({
    id: "model-evidence-runtime-test",
    type: "VERIFIED_BY_TEST",
    from: "evaluation-model-bootstrap-registry-evidence",
    to: runtimeTest,
    location: "apps/api/test/model-runtime.test.ts:loads a repository-relative registry path"
  }),
  edge({
    id: "model-streaming-evaluates-bootstrap",
    type: "EVALUATES",
    from: "evaluation-model-bootstrap-streaming",
    to: bootstrapModel.node_id,
    location: "config/model-registry.v1.json:capabilities.streaming=true"
  }),
  edge({
    id: "model-streaming-confirms-capability",
    type: "CONFIRMS_CAPABILITY_FOR",
    from: "evaluation-model-bootstrap-streaming",
    to: bootstrapModel.node_id,
    location: "config/model-registry.v1.json:capabilities.streaming=true"
  }),
  edge({
    id: "model-streaming-router-test",
    type: "VERIFIED_BY_TEST",
    from: "evaluation-model-bootstrap-streaming",
    to: routerTest,
    location: "packages/model-gateway/test/router.test.ts:active route streaming contract"
  }),
  edge({
    id: "model-confidential-evaluates-bootstrap",
    type: "EVALUATES",
    from: "evaluation-model-bootstrap-confidential",
    to: bootstrapModel.node_id,
    location: "config/model-registry.v1.json:privacy"
  }),
  edge({
    id: "model-confidential-confirms-bootstrap",
    type: "CONFIRMS_CONFIDENTIAL_COMPATIBILITY_FOR",
    from: "evaluation-model-bootstrap-confidential",
    to: bootstrapModel.node_id,
    location: "config/model-registry.v1.json:confidential_compatible=true;training_usage=none;retention=zero"
  }),
  edge({
    id: "model-confidential-uses-registry-document",
    type: "USES_EVIDENCE_FROM",
    from: "evaluation-model-bootstrap-confidential",
    to: registryDocument.node_id,
    location: "config/model-registry.v1.json:privacy"
  }),
  edge({
    id: "model-cost-evaluates-bootstrap",
    type: "EVALUATES",
    from: "evaluation-model-bootstrap-zero-cost",
    to: bootstrapModel.node_id,
    location: "config/model-registry.v1.json:pricing"
  }),
  edge({
    id: "model-cost-confirms-bootstrap",
    type: "CONFIRMS_ZERO_COST_BOOTSTRAP_FOR",
    from: "evaluation-model-bootstrap-zero-cost",
    to: bootstrapModel.node_id,
    location: "config/model-registry.v1.json:input_per_million_tokens=0;output_per_million_tokens=0"
  }),
  edge({
    id: "model-cost-uses-registry-document",
    type: "USES_EVIDENCE_FROM",
    from: "evaluation-model-bootstrap-zero-cost",
    to: registryDocument.node_id,
    location: "config/model-registry.v1.json:pricing"
  }),
  edge({
    id: "model-hard-filter-evaluates-router",
    type: "EVALUATES",
    from: "evaluation-model-router-hard-filter",
    to: "entity-router",
    location: "packages/model-gateway/src/router.ts:ModelRouter.resolve"
  }),
  edge({
    id: "model-hard-filter-router-test",
    type: "VERIFIED_BY_TEST",
    from: "evaluation-model-router-hard-filter",
    to: routerTest,
    location: "packages/model-gateway/test/router.test.ts:capability/confidential/context/budget failures"
  }),
  edge({
    id: "model-score-evaluates-router",
    type: "EVALUATES",
    from: "evaluation-model-router-deterministic-score",
    to: "entity-router",
    location: "packages/model-gateway/src/router.ts:score"
  }),
  edge({
    id: "model-score-router-test",
    type: "VERIFIED_BY_TEST",
    from: "evaluation-model-router-deterministic-score",
    to: routerTest,
    location: "packages/model-gateway/test/router.test.ts:selects deterministically by quality latency and cost"
  }),
  edge({
    id: "model-runtime-binding-evaluates-gateway",
    type: "EVALUATES",
    from: "evaluation-model-runtime-registry-binding",
    to: "entity-model-gateway",
    location: "apps/api/src/model-runtime.ts:buildModelRuntime"
  }),
  edge({
    id: "model-runtime-binding-requires-registry",
    type: "REQUIRES",
    from: "evaluation-model-runtime-registry-binding",
    to: "entity-model-registry",
    location: "apps/api/src/model-runtime.ts:registered.status=active"
  }),
  edge({
    id: "model-runtime-binding-test",
    type: "VERIFIED_BY_TEST",
    from: "evaluation-model-runtime-registry-binding",
    to: runtimeTest,
    location: "apps/api/test/model-runtime.test.ts:binds external adapter only to an active registry route"
  }),
  edge({
    id: "model-bootstrap-serves-gateway",
    type: "SERVES_BOOTSTRAP_RUNTIME_FOR",
    from: bootstrapModel.node_id,
    to: "entity-model-gateway",
    location: "config/model-registry.v1.json:mock:manager-b0.1"
  })
];

const nodes = [
  modelIntelligence,
  bootstrapModel,
  registryDocument,
  recommendOnly,
  ...evaluations
];

const records: IntelligenceGraphSearchRecord[] = [
  {
    node: { id: modelIntelligence.node_id, version: 1 },
    text: "Model Intelligence Graph observe recommend only evaluation model version evidence",
    excerpt:
      "Stores model observations/evaluations but cannot activate routes or replace Model Registry/Router authority.",
    estimated_tokens: 20
  },
  {
    node: { id: bootstrapModel.node_id, version: 1 },
    text: "mock manager b0.1 bootstrap model streaming confidential zero cost registry",
    excerpt:
      "Checked-in active bootstrap route: mock:manager-b0.1, streaming, confidential-compatible, zero priced.",
    estimated_tokens: 20
  },
  {
    node: { id: registryDocument.node_id, version: 1 },
    text: "model registry bootstrap b0.2 bootstrap 1 config",
    excerpt: "Checked-in Model Registry document containing the active bootstrap mock route.",
    estimated_tokens: 16
  },
  {
    node: { id: recommendOnly.node_id, version: 1 },
    text: "model intelligence recommend only not routing authority",
    excerpt: "Intelligence Graph evaluations cannot grant routing permission or activate a route.",
    estimated_tokens: 16
  },
  ...evaluations.map((item) => ({
    node: { id: item.node_id, version: 1 },
    text: item.node_id.replaceAll("-", " "),
    excerpt: item.source_ref.location,
    estimated_tokens: 14
  }))
];

export const cosmoraModelIntelligenceGraph = () => ({ nodes, edges, records });

export const COSMORA_MODEL_INTELLIGENCE_NODE_COUNT = nodes.length;
export const COSMORA_MODEL_INTELLIGENCE_EDGE_COUNT = edges.length;
