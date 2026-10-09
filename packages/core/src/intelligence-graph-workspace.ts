import { randomUUID } from "node:crypto";
import {
  validateIntelligenceGraphSnapshot,
  type IntelligenceGraphEdge,
  type IntelligenceGraphNode,
  type IntelligenceGraphVersionRef,
  type IntelligenceGraphWorkspace,
  type IntelligenceGraphWorkspaceRepository
} from "@cosmora/contracts";
import { IntelligenceGraphIndex } from "./intelligence-graph-retrieval.js";
import { runIntelligenceGraphCognitiveCycle } from "./intelligence-graph-cognition.js";

export type IntelligenceGraphLinkType =
  "SUPPORTS" | "CONTRADICTS" | "DEPENDS_ON" | "IMPLEMENTS" | "REFERENCES";

export type IntelligenceGraphEdit =
  | {
      kind: "add_node";
      node_kind: "Claim" | "Entity" | "Source" | "Document" | "Decision" | "Goal" | "Task";
      label: string;
      detail: string;
    }
  | {
      kind: "add_edge";
      relation: IntelligenceGraphLinkType;
      from: IntelligenceGraphVersionRef;
      to: IntelligenceGraphVersionRef;
    }
  | {
      kind: "revise_edge";
      edge_id: string;
      from: IntelligenceGraphVersionRef;
      to: IntelligenceGraphVersionRef;
    }
  | { kind: "remove_edge"; edge_id: string };

export class IntelligenceGraphWorkspaceError extends Error {
  constructor(
    readonly code: "BAD_INPUT" | "NOT_FOUND" | "REVISION_CONFLICT" | "GRAPH_LIMIT",
    message: string
  ) {
    super(message);
    this.name = "IntelligenceGraphWorkspaceError";
  }
}

const MAX_NODES = 150;
const MAX_EDGES = 300;
const MAX_RECORDS = 150;
const refKey = (ref: IntelligenceGraphVersionRef): string => `${ref.id}@${ref.version}`;
const current = (status: string): boolean => status !== "deleted" && status !== "superseded";
const invalid = (message: string): never => {
  throw new IntelligenceGraphWorkspaceError("BAD_INPUT", message);
};
const requireText = (value: string, max: number, field: string): string => {
  if (typeof value !== "string") return invalid(`${field} must be text`);
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))
    return invalid(`${field} must be 1-${max} safe characters`);
  return text;
};
const integer = (value: number, max: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    return invalid(`${field} must be 1-${max}`);
  }
  return value;
};
const ensureLimits = (graph: IntelligenceGraphWorkspace): void => {
  if (
    graph.nodes.length > MAX_NODES ||
    graph.edges.length > MAX_EDGES ||
    graph.records.length > MAX_RECORDS
  ) {
    throw new IntelligenceGraphWorkspaceError("GRAPH_LIMIT", "Graph size limit reached");
  }
  const issues = validateIntelligenceGraphSnapshot({
    ownerId: graph.owner_id,
    projectId: graph.project_id,
    nodes: graph.nodes,
    edges: graph.edges
  });
  if (issues.length > 0) return invalid(`Invalid graph: ${issues[0]}`);
  const ids = new Set(
    graph.nodes.map((node) => refKey({ id: node.node_id, version: node.node_version }))
  );
  const records = new Set<string>();
  for (const record of graph.records) {
    const key = refKey(record.node);
    if (!ids.has(key) || records.has(key))
      return invalid("Missing or duplicate graph search record");
    if (!record.text.trim() || !record.excerpt.trim()) return invalid("Empty graph search record");
    records.add(key);
  }
};
const activeNode = (
  graph: IntelligenceGraphWorkspace,
  ref: IntelligenceGraphVersionRef
): IntelligenceGraphNode => {
  const node = graph.nodes.find(
    (candidate) => candidate.node_id === ref.id && candidate.node_version === ref.version
  );
  if (!node || !current(node.verification_status)) return invalid("Referenced node is unavailable");
  return node;
};

export class IntelligenceGraphWorkspaceService {
  constructor(
    private readonly repository: IntelligenceGraphWorkspaceRepository,
    private readonly clock: () => string = () => new Date().toISOString()
  ) {}

  create(ownerId: string, projectId: string, title: string): IntelligenceGraphWorkspace {
    const now = this.clock();
    const graph: IntelligenceGraphWorkspace = {
      graph_id: randomUUID(),
      owner_id: requireText(ownerId, 128, "ownerId"),
      project_id: requireText(projectId, 128, "projectId"),
      title: requireText(title, 80, "title"),
      revision: 1,
      created_at: now,
      updated_at: now,
      restored_from_revision: null,
      nodes: [],
      edges: [],
      records: []
    };
    return this.repository.create(graph) ?? this.notFound();
  }

  get(ownerId: string, projectId: string, graphId: string): IntelligenceGraphWorkspace {
    return this.repository.get(ownerId, projectId, graphId) ?? this.notFound();
  }

  list(ownerId: string, projectId: string, limit = 20): IntelligenceGraphWorkspace[] {
    return this.repository.list(ownerId, projectId, integer(limit, 20, "limit"));
  }

  revisions(
    ownerId: string,
    projectId: string,
    graphId: string,
    limit = 20
  ): IntelligenceGraphRevisionInfo[] {
    this.get(ownerId, projectId, graphId);
    return this.repository.listRevisions(ownerId, projectId, graphId, integer(limit, 50, "limit"));
  }

  edit(
    ownerId: string,
    projectId: string,
    graphId: string,
    expectedRevision: number,
    operation: IntelligenceGraphEdit
  ): IntelligenceGraphWorkspace {
    const previous = this.get(ownerId, projectId, graphId);
    if (previous.revision !== expectedRevision) return this.conflict();
    const graph = structuredClone(previous);
    const at = this.clock();
    let summary: string;
    switch (operation.kind) {
      case "add_node": {
        const label = requireText(operation.label, 120, "label");
        const detail = requireText(operation.detail, 1000, "detail");
        const id = randomUUID();
        const node: IntelligenceGraphNode = {
          contract_version: 1,
          node_id: id,
          node_version: 1,
          kind: operation.node_kind,
          owner_id: ownerId,
          project_id: projectId,
          scope: "project",
          created_at: at,
          observed_at: at,
          valid_from: at,
          valid_to: null,
          verification_status: "discovered",
          sensitivity: "D1_PROJECT",
          source_ref: { source_id: id, source_version: 1, location: "owner_input" },
          provenance_kind: "owner_assertion",
          confidence_method: "owner_direct",
          extractor_version: "graph-workspace-v1",
          supersedes: null,
          deleted_at: null
        };
        graph.nodes.push(node);
        graph.records.push({
          node: { id, version: 1 },
          text: label,
          excerpt: detail,
          estimated_tokens: Math.max(1, Math.ceil((label.length + detail.length) / 4))
        });
        summary = "Created an owner-entered unverified node";
        break;
      }
      case "add_edge": {
        activeNode(graph, operation.from);
        activeNode(graph, operation.to);
        const id = randomUUID();
        graph.edges.push(
          this.link(graph, id, 1, operation.relation, operation.from, operation.to, at)
        );
        summary = "Created an owner-entered unverified relation";
        break;
      }
      case "revise_edge": {
        const old = graph.edges.find(
          (edge) => edge.edge_id === operation.edge_id && current(edge.verification_status)
        );
        if (!old) return invalid("Active relation not found");
        activeNode(graph, operation.from);
        activeNode(graph, operation.to);
        old.verification_status = "superseded";
        old.valid_to = at;
        const next = this.link(
          graph,
          old.edge_id,
          old.edge_version + 1,
          old.type as IntelligenceGraphLinkType,
          operation.from,
          operation.to,
          at
        );
        next.supersedes = { id: old.edge_id, version: old.edge_version };
        graph.edges.push(next);
        summary = "Replaced relation endpoints; old version remains in history";
        break;
      }
      case "remove_edge": {
        const old = graph.edges.find(
          (edge) => edge.edge_id === operation.edge_id && current(edge.verification_status)
        );
        if (!old) return invalid("Active relation not found");
        old.verification_status = "deleted";
        old.valid_to = at;
        old.deleted_at = at;
        summary = "Removed relation; previous workspace revision remains restorable";
        break;
      }
      default:
        return invalid("Unknown graph operation");
    }
    graph.revision += 1;
    graph.updated_at = at;
    graph.restored_from_revision = null;
    ensureLimits(graph);
    return this.repository.save(graph, expectedRevision, summary) ?? this.conflict();
  }

  restore(
    ownerId: string,
    projectId: string,
    graphId: string,
    expectedRevision: number,
    fromRevision: number
  ): IntelligenceGraphWorkspace {
    const previous = this.get(ownerId, projectId, graphId);
    if (previous.revision !== expectedRevision) return this.conflict();
    integer(fromRevision, previous.revision, "fromRevision");
    const historical = this.repository.getRevision(ownerId, projectId, graphId, fromRevision);
    if (!historical) return this.notFound();
    const restored: IntelligenceGraphWorkspace = {
      ...structuredClone(historical),
      graph_id: previous.graph_id,
      owner_id: previous.owner_id,
      project_id: previous.project_id,
      created_at: previous.created_at,
      revision: previous.revision + 1,
      updated_at: this.clock(),
      restored_from_revision: fromRevision
    };
    ensureLimits(restored);
    return (
      this.repository.save(
        restored,
        expectedRevision,
        `Restored workspace revision ${fromRevision}`
      ) ?? this.conflict()
    );
  }

  explain(ownerId: string, projectId: string, graphId: string, query: string) {
    const graph = this.get(ownerId, projectId, graphId);
    const normalized = requireText(query, 500, "query");
    ensureLimits(graph);
    const records = new Map(graph.records.map((record) => [refKey(record.node), record]));
    const vertices = new Map(
      graph.nodes.map((node) => [refKey({ id: node.node_id, version: node.node_version }), node])
    );
    const index = new IntelligenceGraphIndex({
      ownerId,
      projectId,
      nodes: graph.nodes,
      edges: graph.edges,
      records: graph.records
    });
    const result = runIntelligenceGraphCognitiveCycle(index, {
      owner_id: ownerId,
      project_id: projectId,
      mode: "multi_hop",
      verified_only: false,
      text: normalized,
      budget: { max_nodes: 24, max_edges: 40, max_depth: 2, max_fan_out: 8 }
    });
    const explanations = result.evidence.edges.map((edge) => {
      const from = records.get(refKey(edge.from))?.text ?? edge.from.id;
      const to = records.get(refKey(edge.to))?.text ?? edge.to.id;
      const label: Record<string, string> = {
        SUPPORTS: "поддерживает",
        CONTRADICTS: "противоречит",
        DEPENDS_ON: "зависит от",
        IMPLEMENTS: "реализует",
        REFERENCES: "ссылается на"
      };
      return {
        edge_id: edge.edge_id,
        version: edge.edge_version,
        from,
        to,
        relation: edge.type,
        description: `${from} — ${label[edge.type] ?? edge.type} — ${to}`,
        verified: edge.verification_status === "verified",
        status: edge.verification_status,
        source: edge.evidence_ref,
        note:
          edge.verification_status === "verified"
            ? "Graph relation marked verified; check primary evidence independently"
            : "Owner-entered or proposed relationship, not independently verified"
      };
    });
    return {
      graph_id: graph.graph_id,
      revision: graph.revision,
      readiness: result.readiness,
      concerns: result.concerns,
      matched_nodes: result.evidence.nodes.map(({ node, excerpt }) => ({
        id: node.node_id,
        version: node.node_version,
        kind: node.kind,
        status: node.verification_status,
        label:
          records.get(refKey({ id: node.node_id, version: node.node_version }))?.text ??
          node.node_id,
        detail: excerpt,
        source: node.source_ref,
        known: vertices.has(refKey({ id: node.node_id, version: node.node_version }))
      })),
      relationships: explanations,
      truncated: result.evidence.budget.truncated,
      explanation:
        result.readiness === "abstain"
          ? "Недостаточно подтверждённых данных. Связи не считаются доказанными."
          : result.readiness === "review_required"
            ? "Найдены предварительные связи. Требуется проверка источников."
            : "Контекст прошёл формальную проверку; выводы ещё требуют содержательной проверки."
    };
  }

  private link(
    graph: IntelligenceGraphWorkspace,
    id: string,
    version: number,
    relation: IntelligenceGraphLinkType,
    from: IntelligenceGraphVersionRef,
    to: IntelligenceGraphVersionRef,
    at: string
  ): IntelligenceGraphEdge {
    const allowed = ["SUPPORTS", "CONTRADICTS", "DEPENDS_ON", "IMPLEMENTS", "REFERENCES"];
    if (!allowed.includes(relation)) return invalid("Unsupported relation type");
    if (refKey(from) === refKey(to)) return invalid("Self-link is not supported");
    return {
      contract_version: 1,
      edge_id: id,
      edge_version: version,
      type: relation,
      from: structuredClone(from),
      to: structuredClone(to),
      owner_id: graph.owner_id,
      project_id: graph.project_id,
      scope: "project",
      created_at: at,
      observed_at: at,
      valid_from: at,
      valid_to: null,
      verification_status: "discovered",
      sensitivity: "D1_PROJECT",
      evidence_ref: { source_id: id, source_version: version, location: "owner_input" },
      provenance_kind: "owner_assertion",
      confidence_method: "owner_direct",
      extractor_version: "graph-workspace-v1",
      supersedes: null,
      deleted_at: null
    };
  }

  private notFound(): never {
    throw new IntelligenceGraphWorkspaceError("NOT_FOUND", "Graph or project not found");
  }
  private conflict(): never {
    throw new IntelligenceGraphWorkspaceError(
      "REVISION_CONFLICT",
      "Graph revision changed; reload before saving"
    );
  }
}
