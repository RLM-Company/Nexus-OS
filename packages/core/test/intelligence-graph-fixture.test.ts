import { describe, expect, it } from "vitest";
import {
  compileAuthorizedIntelligenceGraphFixture,
  IntelligenceGraphIndex,
  type AuthorizedIntelligenceGraphFixture
} from "../src/index.js";

const fixture = (): AuthorizedIntelligenceGraphFixture => ({
  owner_id: "owner-1",
  project_id: "project-1",
  source: {
    id: "source-architecture",
    version: 1,
    title: "Architecture decision log",
    excerpt: "Verified project decisions for the bounded local alpha.",
    location: "fixture:source",
    created_at: "2026-09-01T00:00:00.000Z",
    estimated_tokens: 20
  },
  entries: [
    {
      id: "claim-storage",
      version: 1,
      kind: "Claim",
      text: "storage architecture sqlite durable state",
      excerpt: "SQLite was selected for durable project state.",
      location: "fixture:claim-storage",
      created_at: "2026-09-01T00:01:00.000Z",
      verification_status: "verified",
      provenance_kind: "document",
      confidence_method: "primary_source",
      estimated_tokens: 18
    },
    {
      id: "decision-storage",
      kind: "Decision",
      text: "decision durable project storage",
      excerpt: "The architecture decision adopted durable project storage.",
      location: "fixture:decision-storage",
      created_at: "2026-09-01T00:02:00.000Z",
      verification_status: "verified",
      provenance_kind: "human_verification",
      confidence_method: "human_review",
      estimated_tokens: 18
    }
  ],
  relations: [
    {
      id: "edge-decision-storage",
      type: "BASED_ON",
      from: { id: "decision-storage", version: 1 },
      to: { id: "claim-storage", version: 1 },
      location: "fixture:edge-decision-storage",
      created_at: "2026-09-01T00:03:00.000Z",
      verification_status: "verified",
      provenance_kind: "deterministic_derivation",
      confidence_method: "deterministic_check"
    },
    {
      id: "edge-claim-source",
      type: "SUPPORTED_BY",
      from: { id: "claim-storage", version: 1 },
      to: { id: "source-architecture", version: 1 },
      location: "fixture:edge-claim-source",
      created_at: "2026-09-01T00:03:00.000Z",
      verification_status: "verified",
      provenance_kind: "deterministic_derivation",
      confidence_method: "deterministic_check"
    }
  ]
});

describe("authorized Intelligence Graph fixture compiler", () => {
  it("compiles an allowed fixture into a queryable graph", () => {
    const compiled = compileAuthorizedIntelligenceGraphFixture(fixture());

    expect(compiled.nodes.map((node) => node.node_id)).toEqual([
      "source-architecture",
      "claim-storage",
      "decision-storage"
    ]);
    expect(compiled.edges).toHaveLength(2);
    expect(compiled.records).toHaveLength(3);

    const index = new IntelligenceGraphIndex({
      ownerId: "owner-1",
      projectId: "project-1",
      ...compiled
    });
    const packet = index.query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "decision durable project storage",
      mode: "multi_hop",
      verified_only: true,
      budget: { max_depth: 2 }
    });

    expect(packet.sufficient_evidence).toBe(true);
    expect(packet.nodes.map(({ node }) => node.node_id)).toEqual(
      expect.arrayContaining(["decision-storage", "claim-storage", "source-architecture"])
    );
  });

  it("rejects secret-like source and entry material before graph construction", () => {
    const withSecretInSource = fixture();
    withSecretInSource.source.excerpt = "Authorization: Bearer abcdefghijklmnop";

    expect(() => compileAuthorizedIntelligenceGraphFixture(withSecretInSource)).toThrow(
      "Secret-like material rejected"
    );

    const withSecretInEntry = fixture();
    withSecretInEntry.entries = [
      ...withSecretInEntry.entries,
      {
        id: "bad",
        kind: "Claim",
        text: "password=super-secret-value",
        excerpt: "unsafe",
        location: "fixture:bad",
        created_at: "2026-09-01T00:04:00.000Z",
        verification_status: "hypothesis",
        provenance_kind: "model_inference",
        confidence_method: "model_only",
        estimated_tokens: 5
      }
    ];

    expect(() => compileAuthorizedIntelligenceGraphFixture(withSecretInEntry)).toThrow(
      "Secret-like material rejected"
    );
  });

  it("rejects confidential-chat material from persistent fixtures", () => {
    const confidential = fixture();
    confidential.entries = confidential.entries.map((entry, index) =>
      index === 0 ? { ...entry, sensitivity: "D4_PRIVATE_CHAT" as const } : entry
    );

    expect(() => compileAuthorizedIntelligenceGraphFixture(confidential)).toThrow(
      "Confidential-chat material cannot enter"
    );
  });

  it("rejects relations to unknown node versions", () => {
    const invalid = fixture();
    invalid.relations = [
      ...invalid.relations,
      {
        id: "edge-missing",
        type: "SUPPORTED_BY",
        from: { id: "decision-storage", version: 1 },
        to: { id: "claim-storage", version: 99 },
        location: "fixture:missing",
        created_at: "2026-09-01T00:04:00.000Z",
        verification_status: "verified",
        provenance_kind: "deterministic_derivation",
        confidence_method: "deterministic_check"
      }
    ];

    expect(() => compileAuthorizedIntelligenceGraphFixture(invalid)).toThrow(
      "unknown to node"
    );
  });

  it("rejects model-only inference when a fixture tries to mark it verified", () => {
    const candidate = fixture();
    candidate.entries = [
      ...candidate.entries,
      {
        id: "claim-invalid-verified",
        kind: "Claim",
        text: "unsupported verified model inference",
        excerpt: "A model-only inference must not be promoted to verified evidence.",
        location: "fixture:invalid-verified",
        created_at: "2026-09-01T00:04:00.000Z",
        verification_status: "verified",
        provenance_kind: "model_inference",
        confidence_method: "model_only",
        estimated_tokens: 12
      }
    ];

    expect(() => compileAuthorizedIntelligenceGraphFixture(candidate)).toThrow(
      "cannot be verified by model-only confidence"
    );
  });

  it("keeps model inference as hypothesis data instead of verified authority", () => {
    const candidate = fixture();
    candidate.entries = [
      ...candidate.entries,
      {
        id: "claim-risk",
        kind: "Claim",
        text: "indexing cost risk hypothesis",
        excerpt: "Unverified model-only indexing cost concern.",
        location: "fixture:risk",
        created_at: "2026-09-01T00:04:00.000Z",
        verification_status: "hypothesis",
        provenance_kind: "model_inference",
        confidence_method: "model_only",
        estimated_tokens: 12
      }
    ];

    const compiled = compileAuthorizedIntelligenceGraphFixture(candidate);
    const index = new IntelligenceGraphIndex({
      ownerId: "owner-1",
      projectId: "project-1",
      ...compiled
    });
    const packet = index.query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "indexing cost risk",
      mode: "baseline"
    });

    expect(packet.sufficient_evidence).toBe(false);
    expect(packet.unresolved_node_ids).toContain("claim-risk");
  });
});
