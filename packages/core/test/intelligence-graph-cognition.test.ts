import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  IntelligenceGraphIndex,
  runIntelligenceGraphCognitiveCycle,
  type IntelligenceGraphSearchRecord
} from "../src/index.js";

const t = "2026-09-01T00:00:00.000Z";

const node = (
  id: string,
  status: IntelligenceGraphNode["verification_status"] = "verified"
): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: id,
  node_version: 1,
  kind: id === "source" ? "Source" : "Claim",
  owner_id: "owner-1",
  project_id: "project-1",
  scope: "project",
  created_at: t,
  observed_at: t,
  valid_from: t,
  valid_to: null,
  verification_status: status,
  sensitivity: "D1_PROJECT",
  source_ref: { source_id: "source", source_version: 1, location: "fixture:cognition" },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "cognitive-fixture-v1",
  supersedes: null,
  deleted_at: null
});

const edge = (
  id: string,
  from: IntelligenceGraphNode,
  to: IntelligenceGraphNode,
  status: IntelligenceGraphEdge["verification_status"]
): IntelligenceGraphEdge => ({
  contract_version: 1,
  edge_id: id,
  edge_version: 1,
  type: status === "verified" ? "SUPPORTED_BY" : "PROPOSES",
  from: { id: from.node_id, version: 1 },
  to: { id: to.node_id, version: 1 },
  owner_id: "owner-1",
  project_id: "project-1",
  scope: "project",
  created_at: t,
  observed_at: t,
  valid_from: t,
  valid_to: null,
  verification_status: status,
  sensitivity: "D1_PROJECT",
  evidence_ref: { source_id: "source", source_version: 1, location: "fixture:cognitive-edge" },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "cognitive-fixture-v1",
  supersedes: null,
  deleted_at: null
});

const makeIndex = () => {
  const claim = node("claim");
  const source = node("source");
  const candidate = node("candidate", "discovered");
  const records: IntelligenceGraphSearchRecord[] = [
    {
      node: { id: "claim", version: 1 },
      text: "checkpoint proof",
      excerpt: "Checkpoint is sourced.",
      estimated_tokens: 4
    },
    {
      node: { id: "source", version: 1 },
      text: "reference record",
      excerpt: "A source.",
      estimated_tokens: 3
    },
    {
      node: { id: "candidate", version: 1 },
      text: "future proposal",
      excerpt: "Proposal not merged.",
      estimated_tokens: 4
    }
  ];
  return new IntelligenceGraphIndex({
    ownerId: "owner-1",
    projectId: "project-1",
    nodes: [claim, source, candidate],
    edges: [
      edge("verified-link", claim, source, "verified"),
      edge("candidate-link", claim, candidate, "discovered")
    ],
    records
  });
};

const query = {
  owner_id: "owner-1",
  project_id: "project-1",
  text: "checkpoint proof",
  mode: "local" as const
};

describe("Intelligence Graph cognitive evidence gate", () => {
  it("defaults to verified-only evidence and exposes navigable provenance", () => {
    const report = runIntelligenceGraphCognitiveCycle(makeIndex(), query);
    expect(report.readiness).toBe("grounded_context");
    expect(report.concerns).toEqual([]);
    expect(report.verified_node_refs).toEqual([
      { id: "claim", version: 1 },
      { id: "source", version: 1 }
    ]);
    expect(report.verified_edge_refs).toEqual([{ id: "verified-link", version: 1 }]);
    expect(report.unverified_node_refs).toEqual([]);
    expect(report.unverified_edge_refs).toEqual([]);
    expect(report.source_ids).toEqual(["source"]);
    expect(report.invalid_path_targets).toEqual([]);
    expect(report.navigation_path_count).toBe(2);
  });

  it("never labels exploratory candidate relations as grounded context", () => {
    const report = runIntelligenceGraphCognitiveCycle(makeIndex(), {
      ...query,
      verified_only: false
    });
    expect(report.readiness).toBe("review_required");
    expect(report.concerns).toEqual(
      expect.arrayContaining(["UNVERIFIED_NODES", "UNVERIFIED_RELATIONSHIPS"])
    );
    expect(report.unverified_node_refs).toEqual([{ id: "candidate", version: 1 }]);
    expect(report.unverified_edge_refs).toEqual([{ id: "candidate-link", version: 1 }]);
  });

  it("abstains when provenance diversity threshold is not met", () => {
    const report = runIntelligenceGraphCognitiveCycle(makeIndex(), query, {
      min_distinct_sources: 2
    });
    expect(report.readiness).toBe("abstain");
    expect(report.concerns).toContain("INSUFFICIENT_DISTINCT_SOURCES");
    expect(() =>
      runIntelligenceGraphCognitiveCycle(makeIndex(), query, { min_distinct_sources: 0 })
    ).toThrow("min_distinct_sources");
  });

  it("abstains on unsupported candidates and requests review on truncated traversal", () => {
    const missing = runIntelligenceGraphCognitiveCycle(makeIndex(), {
      ...query,
      text: "future proposal"
    });
    expect(missing.readiness).toBe("abstain");
    expect(missing.concerns).toContain("NO_VERIFIED_NODES");

    const truncated = runIntelligenceGraphCognitiveCycle(makeIndex(), {
      ...query,
      budget: { max_nodes: 1 }
    });
    expect(truncated.readiness).toBe("review_required");
    expect(truncated.concerns).toContain("TRUNCATED_RETRIEVAL");
    expect(truncated.verified_node_refs).toEqual([{ id: "claim", version: 1 }]);
  });
});

describe("historical cognitive evidence", () => {
  it.each([undefined, "discovered", "verified"] as const)(
    "uses recorded prior status %s when assessing a replaced node",
    (prior) => {
      const old = {
        ...node("claim"),
        verification_status: "superseded" as const,
        valid_to: "2026-09-10T00:00:00.000Z",
        ...(prior === undefined ? {} : { previous_verification_status: prior })
      };
      const next = {
        ...node("claim"),
        node_version: 2,
        created_at: "2026-09-10T00:00:00.000Z",
        observed_at: "2026-09-10T00:00:00.000Z",
        valid_from: "2026-09-10T00:00:00.000Z",
        supersedes: { id: "claim", version: 1 }
      };
      const index = new IntelligenceGraphIndex({
        ownerId: "owner-1",
        projectId: "project-1",
        nodes: [old, next],
        edges: [],
        records: [old, next].map((n) => ({
          node: { id: n.node_id, version: n.node_version },
          text: n.node_version === 1 ? "history" : "current",
          excerpt: "Historic evidence",
          estimated_tokens: 4
        }))
      });
      const result = runIntelligenceGraphCognitiveCycle(index, {
        owner_id: "owner-1",
        project_id: "project-1",
        mode: "temporal",
        as_of: "2026-09-05T00:00:00.000Z",
        text: "history",
        verified_only: false
      });
      expect(result.readiness).toBe(prior === "verified" ? "grounded_context" : "abstain");
      expect(result.verified_node_refs).toHaveLength(prior === "verified" ? 1 : 0);
    }
  );
});
