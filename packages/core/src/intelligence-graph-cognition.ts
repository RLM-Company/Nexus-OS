import type {
  IntelligenceGraphEdge,
  IntelligenceGraphVersionRef,
  IntelligenceGraphNode
} from "@cosmora/contracts";
import type {
  IntelligenceGraphEvidencePacket,
  IntelligenceGraphQuery,
  IntelligenceGraphIndex
} from "./intelligence-graph-retrieval.js";

/**
 * A deterministic evidence gate, not a model's private reasoning or a truth oracle.
 * "grounded_context" means the retrieved context passed provenance checks;
 * it does not imply that every answer inferred from that context is true.
 */
export type IntelligenceGraphContextReadiness = "grounded_context" | "review_required" | "abstain";

export type IntelligenceGraphEvidenceConcern =
  | "NO_VERIFIED_NODES"
  | "INSUFFICIENT_DISTINCT_SOURCES"
  | "INVALID_EVIDENCE_PATHS"
  | "UNVERIFIED_NODES"
  | "UNVERIFIED_RELATIONSHIPS"
  | "TRUNCATED_RETRIEVAL";

export interface IntelligenceGraphCognitiveReport {
  readiness: IntelligenceGraphContextReadiness;
  concerns: IntelligenceGraphEvidenceConcern[];
  source_ids: string[];
  verified_node_refs: IntelligenceGraphVersionRef[];
  verified_edge_refs: IntelligenceGraphVersionRef[];
  unverified_node_refs: IntelligenceGraphVersionRef[];
  unverified_edge_refs: IntelligenceGraphVersionRef[];
  invalid_path_targets: IntelligenceGraphVersionRef[];
  navigation_path_count: number;
  /** Traversal paths show relevance, not causal inference or logical entailment. */
  evidence: IntelligenceGraphEvidencePacket;
}

const key = (ref: IntelligenceGraphVersionRef): string => `${ref.id}@${ref.version}`;
const nodeRef = (node: IntelligenceGraphEvidencePacket["nodes"][number]["node"]) => ({
  id: node.node_id,
  version: node.node_version
});
const edgeRef = (edge: IntelligenceGraphEdge) => ({
  id: edge.edge_id,
  version: edge.edge_version
});

const verifiedAt = (
  record: Pick<IntelligenceGraphNode, "verification_status" | "previous_verification_status">,
  asOf: string | null
): boolean =>
  record.verification_status === "verified" ||
  (asOf !== null &&
    record.verification_status === "superseded" &&
    record.previous_verification_status === "verified");

const sortedRefs = (refs: IntelligenceGraphVersionRef[]): IntelligenceGraphVersionRef[] =>
  refs.sort((left, right) => key(left).localeCompare(key(right)));

/** Reject broken or fabricated paths even when the caller passes a hand-built packet. */
const invalidPathTargets = (
  packet: IntelligenceGraphEvidencePacket
): IntelligenceGraphVersionRef[] => {
  const nodeKeys = new Set(packet.nodes.map(({ node }) => key(nodeRef(node))));
  const edges = new Map(packet.edges.map((edge) => [key(edgeRef(edge)), edge]));
  const invalid: IntelligenceGraphVersionRef[] = [];

  for (const path of packet.paths) {
    let cursor = key(path.seed);
    let valid = nodeKeys.has(cursor) && nodeKeys.has(key(path.target));
    for (const ref of path.edges) {
      const edge = edges.get(key(ref));
      if (!valid || !edge) {
        valid = false;
        break;
      }
      if (key(edge.from) === cursor) cursor = key(edge.to);
      else if (key(edge.to) === cursor) cursor = key(edge.from);
      else {
        valid = false;
        break;
      }
      if (!nodeKeys.has(cursor)) {
        valid = false;
        break;
      }
    }
    if (!valid || cursor !== key(path.target)) invalid.push(path.target);
  }

  return sortedRefs(invalid);
};

/**
 * A small, auditable cognitive cycle: retrieve -> check evidence states ->
 * count distinct provenance references -> decide whether to use or abstain.
 *
 * Strict verified-only retrieval is the default. Explicit exploratory queries
 * may include candidates, but can never receive a grounded_context verdict.
 * No model calls, network, writes, autonomous approvals or graph mutation.
 */
export const runIntelligenceGraphCognitiveCycle = (
  index: IntelligenceGraphIndex,
  query: IntelligenceGraphQuery,
  options: { min_distinct_sources?: number } = {}
): IntelligenceGraphCognitiveReport => {
  const minimum = options.min_distinct_sources ?? 1;
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > 8) {
    throw new Error("Intelligence Graph min_distinct_sources must be an integer from 1 to 8");
  }

  const evidence = index.query({ ...query, verified_only: query.verified_only ?? true });
  const verifiedNodes = evidence.nodes
    .filter(({ node }) => verifiedAt(node, evidence.as_of))
    .map(({ node }) => node);
  const unverifiedNodes = evidence.nodes
    .filter(({ node }) => !verifiedAt(node, evidence.as_of))
    .map(({ node }) => node);
  const verifiedEdges = evidence.edges.filter((edge) => verifiedAt(edge, evidence.as_of));
  const unverifiedEdges = evidence.edges.filter((edge) => !verifiedAt(edge, evidence.as_of));
  // Distinct source references, not claims of independent corroboration.
  const sourceIds = [...new Set(verifiedNodes.map((node) => node.source_ref.source_id))].sort();
  const invalidTargets = invalidPathTargets(evidence);
  const concerns: IntelligenceGraphEvidenceConcern[] = [];

  if (!evidence.sufficient_evidence || verifiedNodes.length === 0) {
    concerns.push("NO_VERIFIED_NODES");
  }
  if (sourceIds.length < minimum) concerns.push("INSUFFICIENT_DISTINCT_SOURCES");
  if (invalidTargets.length > 0) concerns.push("INVALID_EVIDENCE_PATHS");
  if (unverifiedNodes.length > 0) concerns.push("UNVERIFIED_NODES");
  if (unverifiedEdges.length > 0) concerns.push("UNVERIFIED_RELATIONSHIPS");
  if (evidence.budget.truncated) concerns.push("TRUNCATED_RETRIEVAL");

  const mustAbstain =
    concerns.includes("NO_VERIFIED_NODES") ||
    concerns.includes("INSUFFICIENT_DISTINCT_SOURCES") ||
    concerns.includes("INVALID_EVIDENCE_PATHS");
  const readiness: IntelligenceGraphContextReadiness = mustAbstain
    ? "abstain"
    : concerns.length > 0
      ? "review_required"
      : "grounded_context";

  return {
    readiness,
    concerns,
    source_ids: sourceIds,
    verified_node_refs: sortedRefs(verifiedNodes.map(nodeRef)),
    verified_edge_refs: sortedRefs(verifiedEdges.map(edgeRef)),
    unverified_node_refs: sortedRefs(unverifiedNodes.map(nodeRef)),
    unverified_edge_refs: sortedRefs(unverifiedEdges.map(edgeRef)),
    invalid_path_targets: invalidTargets,
    navigation_path_count: evidence.paths.length,
    evidence
  };
};
