import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cosmoraUnifiedKnowledgeGraph } from "./fixtures/cosmora-unified-knowledge-graph.js";

interface ManifestLayer {
  id: string;
  nodes: number;
  edges: number;
  authority: string;
  default_query_policy?: string;
}

interface KnowledgeManifest {
  schema_version: number;
  graph_id: string;
  authoritative_main: {
    repository: string;
    sha: string;
    observed_at: string;
  };
  totals: {
    nodes: number;
    edges: number;
    records: number;
  };
  layers: ManifestLayer[];
  safety: {
    private_chat_persistence: boolean;
    secrets_allowed: boolean;
    model_only_claims_may_self_verify: boolean;
    unmerged_prs_are_authoritative: boolean;
  };
  notes: string[];
}

const manifestPath = fileURLToPath(
  new URL("../../../knowledge/cosmora/graph-manifest.v1.json", import.meta.url)
);

const readManifest = (): KnowledgeManifest =>
  JSON.parse(readFileSync(manifestPath, "utf8")) as KnowledgeManifest;

describe("Cosmora knowledge graph manifest", () => {
  it("matches the unified graph counts exactly", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const manifest = readManifest();

    expect(manifest.totals).toEqual({
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      records: graph.records.length
    });
  });

  it("keeps layer totals equal to the unified graph totals", () => {
    const manifest = readManifest();

    expect(manifest.layers.reduce((sum, layer) => sum + layer.nodes, 0)).toBe(
      manifest.totals.nodes
    );
    expect(manifest.layers.reduce((sum, layer) => sum + layer.edges, 0)).toBe(
      manifest.totals.edges
    );
  });

  it("marks every open-review layer as candidate-only", () => {
    const manifest = readManifest();
    const candidates = manifest.layers.filter((layer) =>
      layer.id.startsWith("open_")
    );

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(
      candidates.every(
        (layer) =>
          layer.authority === "candidate_only_unmerged" &&
          layer.default_query_policy === "exclude_when_verified_only"
      )
    ).toBe(true);
  });

  it("keeps synthetic scale data out of the knowledge graph contract", () => {
    const manifest = readManifest();

    expect(manifest.notes.some((note) => note.includes("2M synthetic scale"))).toBe(true);
    expect(manifest.graph_id).toBe("cosmora-nexus-os-knowledge");
  });

  it("preserves privacy and authority fail-closed flags", () => {
    const manifest = readManifest();

    expect(manifest.safety).toMatchObject({
      private_chat_persistence: false,
      secrets_allowed: false,
      model_only_claims_may_self_verify: false,
      unmerged_prs_are_authoritative: false
    });
  });

  it("pins the evidence snapshot to the current authoritative main SHA", () => {
    const manifest = readManifest();

    expect(manifest.authoritative_main).toMatchObject({
      repository: "RLM-Company/Nexus-OS",
      sha: "62bc5234b24e3b0c10262b043063fd31be9732bd"
    });
  });
});
