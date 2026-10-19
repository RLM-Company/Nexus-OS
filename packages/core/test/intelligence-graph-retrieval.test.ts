import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { IntelligenceGraphIndex, type IntelligenceGraphSearchRecord } from "../src/index.js";

const t0 = "2026-09-01T00:00:00.000Z";
const t1 = "2026-09-10T23:59:59.000Z";
const t2 = "2026-09-11T00:00:00.000Z";
const t3 = "2026-09-12T00:00:00.000Z";

const makeNode = (
  id: string,
  kind: IntelligenceGraphNode["kind"],
  overrides: Partial<IntelligenceGraphNode> = {}
): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: id,
  node_version: 1,
  kind,
  owner_id: "owner-1",
  project_id: "project-1",
  scope: "project",
  created_at: t0,
  observed_at: t0,
  valid_from: t0,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: "source-decision-log",
    source_version: 1,
    location: `fixture:${id}`
  },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "fixture-v1",
  supersedes: null,
  deleted_at: null,
  ...overrides
});

const makeEdge = (
  id: string,
  type: string,
  from: IntelligenceGraphNode,
  to: IntelligenceGraphNode,
  overrides: Partial<IntelligenceGraphEdge> = {}
): IntelligenceGraphEdge => ({
  contract_version: 1,
  edge_id: id,
  edge_version: 1,
  type,
  from: { id: from.node_id, version: from.node_version },
  to: { id: to.node_id, version: to.node_version },
  owner_id: "owner-1",
  project_id: "project-1",
  scope: "project",
  created_at: t0,
  observed_at: t0,
  valid_from: t0,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  evidence_ref: {
    source_id: "source-decision-log",
    source_version: 1,
    location: `fixture-edge:${id}`
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "fixture-v1",
  supersedes: null,
  deleted_at: null,
  ...overrides
});

const fixture = () => {
  const source = makeNode("source-decision-log", "Source");
  const document = makeNode("document-architecture-log", "Document");
  const goal = makeNode("goal-safe-alpha", "Goal");

  const oldStorage = makeNode("claim-storage", "Claim", {
    node_version: 1,
    verification_status: "superseded",
    previous_verification_status: "verified",
    valid_to: t1
  });
  const currentStorage = makeNode("claim-storage", "Claim", {
    node_version: 2,
    created_at: t2,
    observed_at: t2,
    valid_from: t2,
    supersedes: { id: "claim-storage", version: 1 }
  });

  const decision = makeNode("decision-storage", "Decision", {
    created_at: t2,
    observed_at: t2,
    valid_from: t2
  });
  const artifact = makeNode("artifact-manager-runtime", "Artifact", {
    created_at: t3,
    observed_at: t3,
    valid_from: t3
  });
  const unresolved = makeNode("claim-cost-risk", "Claim", {
    verification_status: "hypothesis",
    provenance_kind: "model_inference",
    confidence_method: "model_only",
    created_at: t3,
    observed_at: t3,
    valid_from: t3
  });

  const nodes = [
    source,
    document,
    goal,
    oldStorage,
    currentStorage,
    decision,
    artifact,
    unresolved
  ];

  const edges = [
    makeEdge("edge-source-document", "CONTAINS", source, document),
    makeEdge("edge-goal-decision", "GUIDED", goal, decision, {
      created_at: t2,
      observed_at: t2,
      valid_from: t2
    }),
    makeEdge("edge-old-storage-source", "SUPPORTED_BY", oldStorage, source, {
      valid_to: t1
    }),
    makeEdge("edge-current-storage-source", "SUPPORTED_BY", currentStorage, source, {
      created_at: t2,
      observed_at: t2,
      valid_from: t2
    }),
    makeEdge("edge-decision-storage", "BASED_ON", decision, currentStorage, {
      created_at: t2,
      observed_at: t2,
      valid_from: t2
    }),
    makeEdge("edge-artifact-decision", "IMPLEMENTS", artifact, decision, {
      created_at: t3,
      observed_at: t3,
      valid_from: t3
    }),
    makeEdge("edge-risk-decision", "QUESTIONS", unresolved, decision, {
      created_at: t3,
      observed_at: t3,
      valid_from: t3,
      verification_status: "hypothesis",
      provenance_kind: "model_inference",
      confidence_method: "model_only"
    }),
    makeEdge("edge-cycle-back", "RELATES_TO", source, artifact, {
      created_at: t3,
      observed_at: t3,
      valid_from: t3
    })
  ];

  const records: IntelligenceGraphSearchRecord[] = [
    {
      node: { id: source.node_id, version: source.node_version },
      text: "primary architecture decision log source",
      excerpt: "Decision log containing the evidence used by the architecture decision.",
      estimated_tokens: 24
    },
    {
      node: { id: document.node_id, version: document.node_version },
      text: "architecture log document",
      excerpt: "Versioned architecture log document.",
      estimated_tokens: 12
    },
    {
      node: { id: goal.node_id, version: goal.node_version },
      text: "safe local alpha goal",
      excerpt: "Keep the first alpha bounded and recoverable.",
      estimated_tokens: 16
    },
    {
      node: { id: oldStorage.node_id, version: oldStorage.node_version },
      text: "storage architecture choice in memory for early prototype",
      excerpt: "Earlier storage choice used an in-memory prototype.",
      estimated_tokens: 18
    },
    {
      node: { id: currentStorage.node_id, version: currentStorage.node_version },
      text: "storage architecture choice sqlite durable project state",
      excerpt: "The project moved to SQLite-backed durable state.",
      estimated_tokens: 18
    },
    {
      node: { id: decision.node_id, version: decision.node_version },
      text: "architecture decision selected durable storage",
      excerpt: "The storage decision selected durable project state.",
      estimated_tokens: 20
    },
    {
      node: { id: artifact.node_id, version: artifact.node_version },
      text: "manager runtime implementation artifact",
      excerpt: "The Manager runtime artifact implements the selected storage decision.",
      estimated_tokens: 22
    },
    {
      node: { id: unresolved.node_id, version: unresolved.node_version },
      text: "cost risk graph indexing hypothesis",
      excerpt: "A model-only hypothesis raises an unverified graph-indexing cost risk.",
      estimated_tokens: 22
    }
  ];

  return { nodes, edges, records };
};

const createIndex = () => {
  const data = fixture();
  return new IntelligenceGraphIndex({
    ownerId: "owner-1",
    projectId: "project-1",
    ...data
  });
};

describe("Intelligence Graph retrieval", () => {
  it("keeps baseline retrieval narrow and deterministic", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "manager runtime implementation artifact",
      mode: "baseline",
      verified_only: true
    });

    expect(packet.sufficient_evidence).toBe(true);
    expect(packet.nodes.map(({ node }) => node.node_id)).toEqual(["artifact-manager-runtime"]);
    expect(packet.edges).toEqual([]);
    expect(packet.paths).toHaveLength(1);
  });

  it("local retrieval adds only the first graph neighborhood", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "manager runtime implementation artifact",
      mode: "local",
      verified_only: true,
      budget: { max_depth: 4 }
    });

    expect(packet.nodes.map(({ node }) => node.node_id)).toEqual(
      expect.arrayContaining([
        "artifact-manager-runtime",
        "decision-storage",
        "source-decision-log"
      ])
    );
    expect(packet.nodes.some(({ node }) => node.node_id === "claim-storage")).toBe(false);
  });

  it("multi-hop retrieval reconstructs a bounded evidence path", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "manager runtime implementation artifact",
      mode: "multi_hop",
      verified_only: true,
      budget: { max_depth: 3, max_nodes: 8, max_edges: 8, max_fan_out: 4 }
    });

    expect(packet.nodes.map(({ node }) => `${node.node_id}@${node.node_version}`)).toEqual(
      expect.arrayContaining([
        "artifact-manager-runtime@1",
        "decision-storage@1",
        "claim-storage@2",
        "source-decision-log@1"
      ])
    );
    expect(
      packet.paths.some(
        (path) =>
          path.target.id === "claim-storage" &&
          path.edges.some((edgeRef) => edgeRef.id === "edge-decision-storage")
      )
    ).toBe(true);
    expect(packet.budget.visited_nodes).toBeLessThanOrEqual(8);
    expect(packet.budget.returned_edges).toBeLessThanOrEqual(8);
  });

  it("terminates on cycles and marks a fan-out-limited result as truncated", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "primary architecture decision log source",
      mode: "multi_hop",
      verified_only: true,
      budget: {
        max_depth: 6,
        max_nodes: 8,
        max_edges: 8,
        max_fan_out: 1,
        max_context_tokens: 1_000
      }
    });

    expect(packet.budget.visited_nodes).toBeLessThanOrEqual(8);
    expect(packet.budget.truncated).toBe(true);
  });

  it("retrieves the historically valid superseded version for an as-of query", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "storage architecture choice",
      mode: "temporal",
      as_of: "2026-09-05T00:00:00.000Z",
      verified_only: true,
      budget: { max_depth: 1 }
    });

    expect(packet.sufficient_evidence).toBe(true);
    expect(packet.nodes.map(({ node }) => `${node.node_id}@${node.node_version}`)).toContain(
      "claim-storage@1"
    );
    expect(packet.nodes.map(({ node }) => `${node.node_id}@${node.node_version}`)).not.toContain(
      "claim-storage@2"
    );
  });

  it("uses the current version for non-temporal retrieval", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "storage architecture choice",
      mode: "baseline",
      verified_only: true
    });

    expect(packet.nodes.map(({ node }) => `${node.node_id}@${node.node_version}`)).toContain(
      "claim-storage@2"
    );
    expect(packet.nodes.map(({ node }) => `${node.node_id}@${node.node_version}`)).not.toContain(
      "claim-storage@1"
    );
  });

  it("reports insufficient evidence for a model-only hypothesis", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "cost risk graph indexing",
      mode: "baseline"
    });

    expect(packet.sufficient_evidence).toBe(false);
    expect(packet.unresolved_node_ids).toEqual(["claim-cost-risk"]);
  });

  it("verified-only mode refuses to return a model-only hypothesis", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "cost risk graph indexing",
      mode: "baseline",
      verified_only: true
    });

    expect(packet.sufficient_evidence).toBe(false);
    expect(packet.nodes).toEqual([]);
  });

  it("fails closed when query scope does not match the index", () => {
    expect(() =>
      createIndex().query({
        owner_id: "owner-1",
        project_id: "project-2",
        text: "manager runtime implementation artifact",
        mode: "baseline"
      })
    ).toThrow("query scope does not match");
  });

  it("rejects graph construction with cross-project data", () => {
    const data = fixture();
    const foreign = {
      ...data.nodes[0]!,
      node_id: "foreign-source",
      project_id: "project-2"
    };

    expect(
      () =>
        new IntelligenceGraphIndex({
          ownerId: "owner-1",
          projectId: "project-1",
          nodes: [...data.nodes, foreign],
          edges: data.edges,
          records: data.records
        })
    ).toThrow("belongs to another project");
  });

  it("enforces hard traversal and token budgets", () => {
    const index = createIndex();

    expect(() =>
      index.query({
        owner_id: "owner-1",
        project_id: "project-1",
        text: "manager runtime implementation artifact",
        mode: "multi_hop",
        budget: { max_depth: 7 }
      })
    ).toThrow("max_depth");

    const packet = index.query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "manager runtime implementation artifact",
      mode: "multi_hop",
      budget: { max_context_tokens: 22, max_depth: 3 }
    });

    expect(packet.budget.estimated_context_tokens).toBeLessThanOrEqual(22);
    expect(packet.budget.truncated).toBe(true);
  });

  it("does not treat candidate or model-only edges between verified nodes as verified evidence", () => {
    const data = fixture();
    const artifact = data.nodes.find((node) => node.node_id === "artifact-manager-runtime")!;
    const goal = data.nodes.find((node) => node.node_id === "goal-safe-alpha")!;
    data.edges.push(
      makeEdge("aaa-candidate-bridge", "PROPOSES_CHANGE_TO", artifact, goal, {
        verification_status: "discovered"
      }),
      makeEdge("aab-model-bridge", "QUESTIONS", artifact, goal, {
        verification_status: "hypothesis",
        provenance_kind: "model_inference",
        confidence_method: "model_only"
      })
    );
    const index = new IntelligenceGraphIndex({
      ownerId: "owner-1",
      projectId: "project-1",
      ...data
    });
    const strict = index.query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "manager runtime implementation artifact",
      mode: "local",
      verified_only: true
    });
    expect(strict.edges.map((edge) => edge.edge_id)).not.toContain("aaa-candidate-bridge");
    expect(strict.edges.map((edge) => edge.edge_id)).not.toContain("aab-model-bridge");
    expect(strict.nodes.map(({ node }) => node.node_id)).not.toContain("goal-safe-alpha");

    const exploratory = index.query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "manager runtime implementation artifact",
      mode: "local",
      verified_only: false
    });
    expect(exploratory.edges.map((edge) => edge.edge_id)).toContain("aaa-candidate-bridge");
    expect(exploratory.edges.map((edge) => edge.edge_id)).toContain("aab-model-bridge");
  });

  it("filters unverified edges before applying fan-out budget", () => {
    const root = makeNode("trust-root", "Claim");
    const proposed = makeNode("trust-proposed", "Claim");
    const validated = makeNode("trust-validated", "Claim");
    const index = new IntelligenceGraphIndex({
      ownerId: "owner-1",
      projectId: "project-1",
      nodes: [root, proposed, validated],
      edges: [
        makeEdge("aaa-unverified", "PROPOSES", root, proposed, {
          verification_status: "discovered"
        }),
        makeEdge("zzz-verified", "SUPPORTED_BY", root, validated)
      ],
      records: [
        {
          node: { id: root.node_id, version: 1 },
          text: "unique root evidence",
          excerpt: "Root.",
          estimated_tokens: 2
        },
        {
          node: { id: proposed.node_id, version: 1 },
          text: "proposed item",
          excerpt: "Proposed.",
          estimated_tokens: 2
        },
        {
          node: { id: validated.node_id, version: 1 },
          text: "validated item",
          excerpt: "Validated.",
          estimated_tokens: 2
        }
      ]
    });
    const packet = index.query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "unique root evidence",
      mode: "local",
      verified_only: true,
      budget: { max_fan_out: 1 }
    });
    expect(packet.edges.map((edge) => edge.edge_id)).toEqual(["zzz-verified"]);
    expect(packet.nodes.map(({ node }) => node.node_id)).toEqual(["trust-root", "trust-validated"]);
    expect(packet.budget.truncated).toBe(false);
  });

  it("permits historically verified superseded edges only in temporal queries", () => {
    const data = fixture();
    const source = data.nodes.find((node) => node.node_id === "source-decision-log")!;
    const current = data.nodes.find(
      (node) => node.node_id === "claim-storage" && node.node_version === 2
    )!;
    const oldEdge = data.edges.find((edge) => edge.edge_id === "edge-old-storage-source")!;
    oldEdge.verification_status = "superseded";
    oldEdge.previous_verification_status = "verified";
    data.edges.push(
      makeEdge("edge-old-storage-source", "SUPPORTED_BY", current, source, {
        edge_version: 2,
        created_at: t2,
        observed_at: t2,
        valid_from: t2,
        supersedes: { id: oldEdge.edge_id, version: 1 }
      })
    );
    const index = new IntelligenceGraphIndex({
      ownerId: "owner-1",
      projectId: "project-1",
      ...data
    });
    const history = index.query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "storage architecture choice in memory for early prototype",
      mode: "temporal",
      as_of: "2026-09-05T00:00:00.000Z",
      verified_only: true
    });
    expect(history.edges.map((edge) => `${edge.edge_id}@${edge.edge_version}`)).toContain(
      "edge-old-storage-source@1"
    );
    const currentPacket = index.query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "storage architecture choice sqlite durable project state",
      mode: "local",
      verified_only: true
    });
    expect(currentPacket.edges.map((edge) => `${edge.edge_id}@${edge.edge_version}`)).toContain(
      "edge-old-storage-source@2"
    );
    expect(currentPacket.edges.map((edge) => `${edge.edge_id}@${edge.edge_version}`)).not.toContain(
      "edge-old-storage-source@1"
    );
  });
});

describe("historical verification cannot be invented by supersession", () => {
  it.each([undefined, "discovered", "hypothesis", "disputed"] as const)(
    "excludes a formerly %s node from verified-only history",
    (prior) => {
      const data = fixture();
      const old = data.nodes.find((n) => n.node_id === "claim-storage" && n.node_version === 1)!;
      if (prior === undefined) delete old.previous_verification_status;
      else old.previous_verification_status = prior;
      const index = new IntelligenceGraphIndex({
        ownerId: "owner-1",
        projectId: "project-1",
        ...data
      });
      const packet = index.query({
        owner_id: "owner-1",
        project_id: "project-1",
        text: "storage architecture choice in memory for early prototype",
        mode: "temporal",
        as_of: "2026-09-05T00:00:00.000Z",
        verified_only: true
      });
      expect(
        packet.nodes.some(({ node }) => node.node_id === old.node_id && node.node_version === 1)
      ).toBe(false);
    }
  );
  it("does not include a version at the exclusive end of its validity", () => {
    const data = fixture();
    const index = new IntelligenceGraphIndex({
      ownerId: "owner-1",
      projectId: "project-1",
      ...data
    });
    const packet = index.query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "storage architecture choice in memory for early prototype",
      mode: "temporal",
      as_of: t1,
      verified_only: true
    });
    expect(
      packet.nodes.some(({ node }) => node.node_id === "claim-storage" && node.node_version === 1)
    ).toBe(false);
  });
});

describe("field-aware saved-text search", () => {
  const indexFor = (
    nodes: IntelligenceGraphNode[],
    records: IntelligenceGraphSearchRecord[],
    edges: IntelligenceGraphEdge[] = []
  ) =>
    new IntelligenceGraphIndex({
      ownerId: "owner-1",
      projectId: "project-1",
      nodes,
      records,
      edges
    });
  const record = (
    node: IntelligenceGraphNode,
    text: string,
    excerpt: string
  ): IntelligenceGraphSearchRecord => ({
    node: { id: node.node_id, version: node.node_version },
    text,
    excerpt,
    estimated_tokens: 10
  });
  const query = (text: string) => ({
    owner_id: "owner-1",
    project_id: "project-1",
    mode: "baseline" as const,
    text,
    verified_only: true
  });
  it("finds a literal term stored only in source text without changing the saved Unicode/CRLF bytes", () => {
    const node = makeNode("source-body", "Source"),
      body = "Первая строка\r\nКвантовый протокол <b> $&";
    const r = record(node, "Приложение 7", body),
      index = indexFor([node], [r]);
    const packet = index.query(query("квантовый"));
    expect(packet.nodes.map((n) => n.node.node_id)).toEqual(["source-body"]);
    expect(packet.nodes[0]!.excerpt).toBe(body);
    expect(r.excerpt).toBe(body);
    expect(packet.budget).toMatchObject({
      matched_candidates: 1,
      unreturned_candidates: 0,
      truncated: false
    });
  });
  it("ranks title matches above body-only matches and prevents term-frequency stuffing", () => {
    const title = makeNode("z-title", "Claim"),
      body = makeNode("a-body", "Source"),
      repeat = makeNode("b-repeat", "Document");
    const index = indexFor(
      [title, body, repeat],
      [
        record(title, "Уникальный протокол", "Описание"),
        record(body, "Заметка", "Уникальный протокол"),
        record(repeat, "Заметка", "Уникальный протокол ".repeat(100))
      ]
    );
    const packet = index.query(query("Уникальный протокол"));
    expect(packet.nodes[0]!.node.node_id).toBe("z-title");
    expect(packet.nodes[1]!.lexical_score).toBe(packet.nodes[2]!.lexical_score);
    expect(packet.nodes[0]!.lexical_score).toBeGreaterThan(packet.nodes[1]!.lexical_score);
  });
  it("normalizes composed/decomposed Cyrillic and Latin only for matching", () => {
    const a = makeNode("a", "Source"),
      b = makeNode("b", "Document");
    const nfd = "И\u0306од cafe\u0301";
    const index = indexFor(
      [a, b],
      [record(a, "Архив", nfd), record(b, "ЙОД CAFÉ", "Другой текст")]
    );
    const packet = index.query(query("йод café"));
    expect(packet.nodes).toHaveLength(2);
    expect(packet.nodes[0]!.node.node_id).toBe("b");
    expect(packet.nodes[1]!.excerpt).toBe(nfd);
    expect(index.query(query(".*")).nodes).toEqual([]);
  });
  it("filters verification, scope and exact temporal versions before counting body candidates", () => {
    const old = makeNode("versioned", "Source", {
      verification_status: "superseded",
      previous_verification_status: "verified",
      valid_to: t2
    });
    const next = makeNode("versioned", "Source", {
      node_version: 2,
      created_at: t2,
      observed_at: t2,
      valid_from: t2,
      supersedes: { id: "versioned", version: 1 }
    });
    const candidate = makeNode("candidate", "Claim", {
      verification_status: "discovered",
      confidence_method: "owner_direct",
      provenance_kind: "owner_assertion"
    });
    const index = indexFor(
      [old, next, candidate],
      [
        record(old, "Log", "Исторический термин"),
        record(next, "Log", "Современный текст"),
        record(candidate, "Draft", "Исторический термин")
      ]
    );
    expect(index.query(query("Исторический")).budget.matched_candidates).toBe(0);
    const temporal = index.query({ ...query("Исторический"), mode: "temporal", as_of: t1 });
    expect(temporal.nodes.map((n) => [n.node.node_id, n.node.node_version])).toEqual([
      ["versioned", 1]
    ]);
    expect(temporal.budget.matched_candidates).toBe(1);
    const exploratory = index.query({ ...query("Исторический"), verified_only: false });
    expect(exploratory.nodes[0]!.node.node_id).toBe("candidate");
    expect(exploratory.budget.matched_candidates).toBe(1);
    expect(() => index.query({ ...query("Исторический"), owner_id: "foreign" })).toThrow("scope");
  });
  it("reports disconnected lexical matches omitted by the multi-hop seed limit", () => {
    const nodes = Array.from({ length: 4 }, (_, i) => makeNode("n" + i, "Claim"));
    const records = nodes.map((n) => record(n, "Запись", "Совпадение"));
    const packet = indexFor(nodes, records).query({ ...query("Совпадение"), mode: "multi_hop" });
    expect(packet.nodes).toHaveLength(3);
    expect(packet.budget).toMatchObject({
      matched_candidates: 4,
      unreturned_candidates: 1,
      truncated: true
    });
    const connected = indexFor(nodes, records, [
      makeEdge("bridge", "SUPPORTS", nodes[2]!, nodes[3]!)
    ]).query({ ...query("Совпадение"), mode: "multi_hop" });
    expect(connected.nodes).toHaveLength(4);
    expect(connected.budget).toMatchObject({
      matched_candidates: 4,
      unreturned_candidates: 0,
      truncated: false
    });
  });
  it("respects node and context budgets when every match occurs only in record body", () => {
    const nodes = Array.from({ length: 5 }, (_, i) => makeNode("n" + i, "Claim"));
    const index = indexFor(
      nodes,
      nodes.map((n) => record(n, "Record", "Найди меня"))
    );
    const byNodes = index.query({ ...query("Найди"), budget: { max_nodes: 1 } });
    expect(byNodes.nodes).toHaveLength(1);
    expect(byNodes.budget).toMatchObject({
      matched_candidates: 5,
      unreturned_candidates: 4,
      truncated: true
    });
    const byTokens = index.query({ ...query("Найди"), budget: { max_context_tokens: 9 } });
    expect(byTokens.nodes).toHaveLength(0);
    expect(byTokens.budget).toMatchObject({
      matched_candidates: 5,
      unreturned_candidates: 5,
      estimated_context_tokens: 0,
      truncated: true
    });
  });
});
