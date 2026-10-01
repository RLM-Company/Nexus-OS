import { describe, expect, it } from "vitest";
import { compileAuthorizedIntelligenceGraphFixture } from "../src/index.js";
import { cosmoraRepositoryStructureGraphFixture } from "./fixtures/cosmora-repository-structure-graph.js";

const compile = () =>
  compileAuthorizedIntelligenceGraphFixture(cosmoraRepositoryStructureGraphFixture());

const nodeAt = (nodes: ReturnType<typeof compile>["nodes"], location: string) =>
  nodes.find((node) => node.source_ref.location === location);

describe("deterministic repository structure graph", () => {
  it("compiles the repository structure snapshot with exact deterministic counts", () => {
    const compiled = compile();

    expect(compiled.nodes).toHaveLength(186);
    expect(compiled.edges).toHaveLength(578);

    const counts = new Map<string, number>();
    for (const edge of compiled.edges) {
      counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
    }

    expect(Object.fromEntries(counts)).toEqual({
      BELONGS_TO_MODULE: 176,
      IMPORTS_FILE: 252,
      IMPORTS_MODULE: 134,
      DEPENDS_ON_MODULE: 16
    });
  });

  it("connects every repository file to a workspace module", () => {
    const compiled = compile();
    const membershipByFile = new Map<string, number>();

    for (const edge of compiled.edges.filter(
      (candidate) => candidate.type === "BELONGS_TO_MODULE"
    )) {
      membershipByFile.set(edge.from.id, (membershipByFile.get(edge.from.id) ?? 0) + 1);
    }

    const fileNodes = compiled.nodes.filter(
      (node) => node.kind === "Document" && node.node_id !== compiled.nodes[0]?.node_id
    );
    expect(fileNodes).toHaveLength(176);
    expect(fileNodes.every((node) => membershipByFile.get(node.node_id) === 1)).toBe(true);
  });

  it("captures Manager work runtime dependencies on model gateway and tool runtime", () => {
    const compiled = compile();
    const manager = nodeAt(compiled.nodes, "apps/api/src/manager-work-coordinator.ts");
    const gateway = nodeAt(compiled.nodes, "packages/model-gateway/package.json");
    const tools = nodeAt(compiled.nodes, "packages/tool-runtime/package.json");

    expect(manager).toBeDefined();
    expect(gateway).toBeDefined();
    expect(tools).toBeDefined();

    expect(
      compiled.edges.some(
        (edge) =>
          edge.type === "IMPORTS_MODULE" &&
          edge.from.id === manager!.node_id &&
          edge.to.id === gateway!.node_id
      )
    ).toBe(true);
    expect(
      compiled.edges.some(
        (edge) =>
          edge.type === "IMPORTS_MODULE" &&
          edge.from.id === manager!.node_id &&
          edge.to.id === tools!.node_id
      )
    ).toBe(true);
  });

  it("captures API workspace dependencies from package manifests", () => {
    const compiled = compile();
    const api = nodeAt(compiled.nodes, "apps/api/package.json");
    const contracts = nodeAt(compiled.nodes, "packages/contracts/package.json");
    const database = nodeAt(compiled.nodes, "packages/db/package.json");
    const gateway = nodeAt(compiled.nodes, "packages/model-gateway/package.json");

    expect(api).toBeDefined();
    for (const target of [contracts, database, gateway]) {
      expect(target).toBeDefined();
      expect(
        compiled.edges.some(
          (edge) =>
            edge.type === "DEPENDS_ON_MODULE" &&
            edge.from.id === api!.node_id &&
            edge.to.id === target!.node_id
        )
      ).toBe(true);
    }
  });

  it("preserves test-to-source imports as evidence-bearing file relationships", () => {
    const compiled = compile();
    const authTest = nodeAt(compiled.nodes, "packages/contracts/test/auth.test.ts");
    const contractsIndex = nodeAt(compiled.nodes, "packages/contracts/src/index.ts");

    expect(authTest).toBeDefined();
    expect(contractsIndex).toBeDefined();
    expect(
      compiled.edges.some(
        (edge) =>
          edge.type === "IMPORTS_FILE" &&
          edge.from.id === authTest!.node_id &&
          edge.to.id === contractsIndex!.node_id &&
          edge.evidence_ref.location.startsWith("packages/contracts/test/auth.test.ts:")
      )
    ).toBe(true);
  });

  it("contains only structural relationship types derived from repository evidence", () => {
    const compiled = compile();
    const allowed = new Set([
      "BELONGS_TO_MODULE",
      "IMPORTS_FILE",
      "IMPORTS_MODULE",
      "DEPENDS_ON_MODULE"
    ]);

    expect(compiled.edges.every((edge) => allowed.has(edge.type))).toBe(true);
    expect(
      compiled.edges.every(
        (edge) =>
          !edge.evidence_ref.location.startsWith("fixture:") &&
          !edge.evidence_ref.location.startsWith("synthetic:")
      )
    ).toBe(true);
  });
});
