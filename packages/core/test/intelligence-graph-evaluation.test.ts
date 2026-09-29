import { describe, expect, it } from "vitest";
import {
  compileAuthorizedIntelligenceGraphFixture,
  evaluateIntelligenceGraphRetrieval,
  IntelligenceGraphIndex,
  type AuthorizedIntelligenceGraphFixture
} from "../src/index.js";

const graphFixture = (): AuthorizedIntelligenceGraphFixture => ({
  owner_id: "owner-1",
  project_id: "project-1",
  source: {
    id: "source-log",
    version: 1,
    title: "Architecture log",
    excerpt: "Verified architecture evidence.",
    location: "fixture:source",
    created_at: "2026-09-01T00:00:00.000Z",
    estimated_tokens: 12
  },
  entries: [
    {
      id: "claim-storage",
      kind: "Claim",
      text: "sqlite durable project storage evidence",
      excerpt: "SQLite provides durable project state.",
      location: "fixture:claim",
      created_at: "2026-09-01T00:01:00.000Z",
      verification_status: "verified",
      provenance_kind: "document",
      confidence_method: "primary_source",
      estimated_tokens: 12
    },
    {
      id: "decision-storage",
      kind: "Decision",
      text: "selected durable storage architecture",
      excerpt: "The project selected durable storage.",
      location: "fixture:decision",
      created_at: "2026-09-01T00:02:00.000Z",
      verification_status: "verified",
      provenance_kind: "human_verification",
      confidence_method: "human_review",
      estimated_tokens: 12
    },
    {
      id: "artifact-manager",
      kind: "Artifact",
      text: "durable manager runtime implementation artifact",
      excerpt: "The Manager artifact implements the storage decision.",
      location: "fixture:artifact",
      created_at: "2026-09-01T00:03:00.000Z",
      verification_status: "verified",
      provenance_kind: "runtime_record",
      confidence_method: "deterministic_check",
      estimated_tokens: 12
    }
  ],
  relations: [
    {
      id: "edge-artifact-decision",
      type: "IMPLEMENTS",
      from: { id: "artifact-manager", version: 1 },
      to: { id: "decision-storage", version: 1 },
      location: "fixture:edge-1",
      created_at: "2026-09-01T00:04:00.000Z",
      verification_status: "verified",
      provenance_kind: "deterministic_derivation",
      confidence_method: "deterministic_check"
    },
    {
      id: "edge-decision-claim",
      type: "BASED_ON",
      from: { id: "decision-storage", version: 1 },
      to: { id: "claim-storage", version: 1 },
      location: "fixture:edge-2",
      created_at: "2026-09-01T00:04:00.000Z",
      verification_status: "verified",
      provenance_kind: "deterministic_derivation",
      confidence_method: "deterministic_check"
    },
    {
      id: "edge-claim-source",
      type: "SUPPORTED_BY",
      from: { id: "claim-storage", version: 1 },
      to: { id: "source-log", version: 1 },
      location: "fixture:edge-3",
      created_at: "2026-09-01T00:04:00.000Z",
      verification_status: "verified",
      provenance_kind: "deterministic_derivation",
      confidence_method: "deterministic_check"
    }
  ]
});

describe("Intelligence Graph retrieval evaluation", () => {
  it("shows multi-hop recall improvement over baseline on a known evidence chain", () => {
    const compiled = compileAuthorizedIntelligenceGraphFixture(graphFixture());
    const index = new IntelligenceGraphIndex({
      ownerId: "owner-1",
      projectId: "project-1",
      ...compiled
    });

    const report = evaluateIntelligenceGraphRetrieval({
      index,
      ownerId: "owner-1",
      projectId: "project-1",
      cases: [
        {
          case_id: "manager-storage-chain",
          query: "durable manager runtime implementation",
          expected_nodes: [
            { id: "artifact-manager", version: 1 },
            { id: "decision-storage", version: 1 },
            { id: "claim-storage", version: 1 }
          ],
          verified_only: true,
          budget: { max_depth: 2, max_nodes: 6, max_edges: 6 }
        }
      ]
    });

    const baseline = report.summaries.find((summary) => summary.mode === "baseline");
    const multiHop = report.summaries.find((summary) => summary.mode === "multi_hop");

    expect(baseline).toBeDefined();
    expect(multiHop).toBeDefined();
    expect(multiHop!.mean_recall).toBeGreaterThan(baseline!.mean_recall);
    expect(multiHop!.mean_recall).toBe(1);
  });

  it("rejects an evaluation case without a labeled expected evidence set", () => {
    const compiled = compileAuthorizedIntelligenceGraphFixture(graphFixture());
    const index = new IntelligenceGraphIndex({
      ownerId: "owner-1",
      projectId: "project-1",
      ...compiled
    });

    expect(() =>
      evaluateIntelligenceGraphRetrieval({
        index,
        ownerId: "owner-1",
        projectId: "project-1",
        cases: [{ case_id: "empty", query: "test", expected_nodes: [] }]
      })
    ).toThrow("requires expected nodes");
  });
});
