import { createHash, randomUUID } from "node:crypto";
import {
  validateIntelligenceGraphSnapshot,
  validateIntelligenceGraphWorkspaceConflicts,
  parseIntelligenceGraphPackage,
  INTELLIGENCE_GRAPH_PACKAGE_FORMAT,
  type IntelligenceGraphPortablePackage,
  type IntelligenceGraphLibraryQuery,
  type IntelligenceGraphEdge,
  type IntelligenceGraphNode,
  type IntelligenceGraphRevisionInfo,
  type IntelligenceGraphVersionRef,
  type IntelligenceGraphWorkspace,
  type IntelligenceGraphWorkspaceExplanation,
  type IntelligenceGraphWorkspaceReport,
  type IntelligenceGraphWorkspaceRepository
} from "@cosmora/contracts";
import { IntelligenceGraphIndex } from "./intelligence-graph-retrieval.js";
import { runIntelligenceGraphCognitiveCycle } from "./intelligence-graph-cognition.js";
import {
  graphSearchTokens,
  INTELLIGENCE_GRAPH_SEARCH_VERSION
} from "./intelligence-graph-search.js";

export type IntelligenceGraphLinkType =
  "SUPPORTS" | "CONTRADICTS" | "DEPENDS_ON" | "IMPLEMENTS" | "REFERENCES";

export type IntelligenceGraphEdit =
  | {
      kind: "open_conflict";
      subject: IntelligenceGraphVersionRef;
      positions: IntelligenceGraphVersionRef[];
    }
  | {
      kind: "revise_conflict";
      conflict_id: string;
      subject: IntelligenceGraphVersionRef;
      positions: IntelligenceGraphVersionRef[];
    }
  | { kind: "resolve_conflict"; conflict_id: string; resolution: IntelligenceGraphVersionRef }
  | { kind: "reopen_conflict"; conflict_id: string }
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
  | { kind: "remove_edge"; edge_id: string }
  | {
      kind: "cite_edge";
      edge_id: string;
      source: IntelligenceGraphVersionRef;
      location: string;
      excerpt: string;
    }
  | { kind: "clear_edge_evidence"; edge_id: string }
  | { kind: "revise_node"; node: IntelligenceGraphVersionRef; label: string; detail: string }
  | { kind: "remove_node"; node: IntelligenceGraphVersionRef }
  | { kind: "rename"; title: string };

export class IntelligenceGraphWorkspaceError extends Error {
  constructor(
    readonly code:
      | "BAD_INPUT"
      | "NOT_FOUND"
      | "REVISION_CONFLICT"
      | "GRAPH_LIMIT"
      | "IMPORT_KEY_CONFLICT"
      | "IMPORT_DELETED",
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
  if (
    !text ||
    text.length > max ||
    [...text].some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })
  )
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
    graph.records.length > MAX_RECORDS ||
    (graph.conflicts?.length ?? 0) > 50
  ) {
    throw new IntelligenceGraphWorkspaceError("GRAPH_LIMIT", "Graph size limit reached");
  }
  assertCitations(graph);
  const issues = [
    ...validateIntelligenceGraphSnapshot({
      ownerId: graph.owner_id,
      projectId: graph.project_id,
      nodes: graph.nodes,
      edges: graph.edges
    }),
    ...validateIntelligenceGraphWorkspaceConflicts(graph)
  ];
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
const assertCitations = (graph: IntelligenceGraphWorkspace): void => {
  const records = new Map(graph.records.map((r) => [refKey(r.node), r]));
  for (const edge of graph.edges)
    if (edge.evidence_excerpt !== undefined) {
      const source = records.get(
        refKey({ id: edge.evidence_ref.source_id, version: edge.evidence_ref.source_version })
      );
      if (!source || !source.excerpt.includes(edge.evidence_excerpt))
        return invalid("Citation no longer matches its exact source version");
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

  library(
    ownerId: string,
    projectId: string,
    options: { limit?: number; q?: string; after?: string } = {}
  ) {
    const limit = integer(options.limit ?? 20, 20, "limit");
    const raw = options.q ?? "";
    if (typeof raw !== "string") return invalid("q must be text");
    const query = !raw.trim()
      ? ""
      : requireText(raw, 120, "q").normalize("NFC").toLocaleLowerCase("ru-RU");
    const filterHash = createHash("sha256")
      .update(JSON.stringify([ownerId, projectId, query]))
      .digest("hex");
    let before: IntelligenceGraphLibraryQuery["before"];
    if (options.after !== undefined) {
      if (typeof options.after !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(options.after))
        return invalid("Invalid graph library cursor");
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(options.after, "base64url").toString("utf8"));
      } catch {
        return invalid("Invalid graph library cursor");
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.keys(parsed).length !== 3 ||
        !("filter_hash" in parsed) ||
        parsed.filter_hash !== filterHash ||
        !("updated_at" in parsed) ||
        typeof parsed.updated_at !== "string" ||
        parsed.updated_at.length > 40 ||
        !Number.isFinite(Date.parse(parsed.updated_at)) ||
        !("graph_id" in parsed) ||
        typeof parsed.graph_id !== "string" ||
        parsed.graph_id.length > 128 ||
        !parsed.graph_id.trim()
      )
        return invalid("Graph library cursor does not match this query/scope");
      before = { updated_at: parsed.updated_at, graph_id: parsed.graph_id };
    }
    const page = this.repository.listPage(ownerId, projectId, {
      limit,
      query,
      ...(before ? { before } : {})
    });
    const last = page.items.at(-1);
    return {
      items: page.items,
      next_cursor:
        page.has_more && last
          ? Buffer.from(
              JSON.stringify({
                filter_hash: filterHash,
                updated_at: last.updated_at,
                graph_id: last.graph_id
              }),
              "utf8"
            ).toString("base64url")
          : null
    };
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
    if (!Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(previous.updated_at)) {
      return invalid("Edit time precedes the current graph revision");
    }
    let summary: string;
    switch (operation.kind) {
      case "open_conflict":
      case "revise_conflict": {
        activeNode(graph, operation.subject);
        if (
          !Array.isArray(operation.positions) ||
          operation.positions.length < 2 ||
          operation.positions.length > 20 ||
          new Set(operation.positions.map((p) => p.id)).size !== operation.positions.length
        )
          return invalid("Conflict requires 2–20 distinct active Claims");
        for (const position of operation.positions)
          if (activeNode(graph, position).kind !== "Claim")
            return invalid("Conflict position must be a Claim");
        graph.conflicts ??= [];
        if (operation.kind === "revise_conflict") {
          const conflict = graph.conflicts.find((c) => c.conflict_id === operation.conflict_id);
          if (!conflict || conflict.status !== "open") return invalid("Open conflict not found");
          conflict.subject_ref = structuredClone(operation.subject);
          conflict.position_refs = structuredClone(operation.positions);
          summary = "Revised exact positions of an open conflict; prior review retained in history";
        } else {
          graph.conflicts.push({
            contract_version: 1,
            conflict_id: randomUUID(),
            owner_id: ownerId,
            project_id: projectId,
            scope: "project",
            subject_ref: structuredClone(operation.subject),
            position_refs: structuredClone(operation.positions),
            status: "open",
            resolution_ref: null,
            created_at: at,
            resolved_at: null
          });
          summary = "Opened a manual conflict without changing verification";
        }
        break;
      }
      case "resolve_conflict":
      case "reopen_conflict": {
        const conflict = graph.conflicts?.find((c) => c.conflict_id === operation.conflict_id);
        if (!conflict) return invalid("Conflict not found");
        if (operation.kind === "resolve_conflict") {
          if (conflict.status !== "open") return invalid("Conflict is already resolved");
          activeNode(graph, conflict.subject_ref);
          for (const position of conflict.position_refs) activeNode(graph, position);
          const resolution = activeNode(graph, operation.resolution);
          if (
            resolution.kind !== "Decision" ||
            Date.parse(resolution.created_at) < Date.parse(conflict.created_at)
          )
            return invalid("Resolution must be an active Decision created after the conflict");
          conflict.status = "resolved";
          conflict.resolution_ref = structuredClone(operation.resolution);
          conflict.resolved_at = at;
          summary =
            "Recorded an owner decision for exact conflict positions; no verification promotion";
        } else {
          if (conflict.status !== "resolved") return invalid("Conflict is already open");
          conflict.status = "open";
          conflict.resolution_ref = null;
          conflict.resolved_at = null;
          summary = "Reopened conflict; previous decision retained in revision history";
        }
        break;
      }
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
      case "rename": {
        graph.title = requireText(operation.title, 80, "title");
        summary = "Renamed graph";
        break;
      }
      case "revise_node":
      case "remove_node": {
        const old = activeNode(graph, operation.node);
        const removed = operation.kind === "remove_node";
        const label = removed ? null : requireText(operation.label, 120, "label");
        const detail = removed ? null : requireText(operation.detail, 1000, "detail");
        old.previous_verification_status = old.verification_status as
          "discovered" | "hypothesis" | "verified" | "disputed";
        old.verification_status = "superseded";
        old.valid_to = at;
        const next: IntelligenceGraphNode = {
          ...structuredClone(old),
          node_version: old.node_version + 1,
          created_at: at,
          observed_at: at,
          valid_from: at,
          valid_to: removed ? at : null,
          verification_status: removed ? "deleted" : "discovered",
          source_ref: {
            source_id: old.node_id,
            source_version: old.node_version + 1,
            location: "owner_input"
          },
          provenance_kind: "owner_assertion",
          confidence_method: "owner_direct",
          supersedes: { id: old.node_id, version: old.node_version },
          deleted_at: removed ? at : null
        };
        delete next.previous_verification_status;
        graph.nodes.push(next);
        if (!removed)
          graph.records.push({
            node: { id: next.node_id, version: next.node_version },
            text: label!,
            excerpt: detail!,
            estimated_tokens: Math.max(1, Math.ceil((label!.length + detail!.length) / 4))
          });
        // Rebind only live relations. Earlier endpoints and evidence stay in historical versions.
        for (const edge of [...graph.edges]) {
          if (!current(edge.verification_status)) continue;
          const touches = (ref: IntelligenceGraphVersionRef) =>
            refKey(ref) === refKey(operation.node);
          if (!touches(edge.from) && !touches(edge.to)) {
            if (
              removed &&
              edge.evidence_excerpt !== undefined &&
              edge.evidence_ref.source_id === old.node_id
            ) {
              edge.previous_verification_status = edge.verification_status as
                "discovered" | "hypothesis" | "verified" | "disputed";
              edge.verification_status = "superseded";
              edge.valid_to = at;
              const replacement = this.link(
                graph,
                edge.edge_id,
                edge.edge_version + 1,
                edge.type as IntelligenceGraphLinkType,
                edge.from,
                edge.to,
                at
              );
              replacement.supersedes = { id: edge.edge_id, version: edge.edge_version };
              graph.edges.push(replacement);
            }
            continue;
          }
          edge.valid_to = at;
          if (removed) {
            edge.verification_status = "deleted";
            edge.deleted_at = at;
          } else {
            edge.previous_verification_status = edge.verification_status as
              "discovered" | "hypothesis" | "verified" | "disputed";
            edge.verification_status = "superseded";
            const replace = (ref: IntelligenceGraphVersionRef) =>
              touches(ref) ? { id: next.node_id, version: next.node_version } : ref;
            const replacement = this.link(
              graph,
              edge.edge_id,
              edge.edge_version + 1,
              edge.type as IntelligenceGraphLinkType,
              replace(edge.from),
              replace(edge.to),
              at
            );
            replacement.supersedes = { id: edge.edge_id, version: edge.edge_version };
            graph.edges.push(replacement);
          }
        }
        summary = removed
          ? "Removed node and its live relations; history retained"
          : "Revised node and rebound live relations as unverified versions";
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
        old.previous_verification_status = old.verification_status as
          "discovered" | "hypothesis" | "verified" | "disputed";
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
      case "cite_edge":
      case "clear_edge_evidence": {
        const old = graph.edges.find(
          (e) => e.edge_id === operation.edge_id && current(e.verification_status)
        );
        if (!old) return invalid("Active relation not found");
        const next = this.link(
          graph,
          old.edge_id,
          old.edge_version + 1,
          old.type as IntelligenceGraphLinkType,
          old.from,
          old.to,
          at
        );
        if (operation.kind === "cite_edge") {
          const source = activeNode(graph, operation.source);
          const record = graph.records.find((r) => refKey(r.node) === refKey(operation.source));
          requireText(operation.excerpt, 1000, "excerpt");
          if (
            operation.excerpt.length > 1000 ||
            !["Source", "Document"].includes(source.kind) ||
            !record?.excerpt.includes(operation.excerpt)
          )
            return invalid("Citation must match exact text in an active Source/Document");
          next.evidence_ref = {
            source_id: source.node_id,
            source_version: source.node_version,
            location: requireText(operation.location, 256, "location")
          };
          next.evidence_excerpt = operation.excerpt;
        } else if (old.evidence_excerpt === undefined) return invalid("Relation has no citation");
        old.previous_verification_status = old.verification_status as
          "discovered" | "hypothesis" | "verified" | "disputed";
        old.verification_status = "superseded";
        old.valid_to = at;
        next.supersedes = { id: old.edge_id, version: old.edge_version };
        graph.edges.push(next);
        summary =
          operation.kind === "cite_edge"
            ? "Attached exact source quote as unverified evidence"
            : "Retracted current evidence quote; history retained";
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

  revision(
    ownerId: string,
    projectId: string,
    graphId: string,
    revision: number
  ): IntelligenceGraphWorkspace {
    const graph = this.get(ownerId, projectId, graphId);
    integer(revision, graph.revision, "revision");
    return this.repository.getRevision(ownerId, projectId, graphId, revision) ?? this.notFound();
  }

  previewImport(input: unknown) {
    try {
      const portable = parseIntelligenceGraphPackage(input);
      const sha256 = createHash("sha256").update(JSON.stringify(portable)).digest("hex");
      return { package: portable, sha256 };
    } catch (error) {
      return invalid(error instanceof Error ? error.message : "Invalid graph package");
    }
  }

  exportPackage(ownerId: string, projectId: string, graphId: string, revision?: number) {
    const graph =
      revision === undefined
        ? this.get(ownerId, projectId, graphId)
        : this.revision(ownerId, projectId, graphId, revision);
    ensureLimits(graph);
    const cited = new Set(
      graph.edges
        .filter((e) => current(e.verification_status) && e.evidence_excerpt !== undefined)
        .map((e) =>
          refKey({ id: e.evidence_ref.source_id, version: e.evidence_ref.source_version })
        )
    );
    const nodes = graph.nodes.filter(
      (n) =>
        current(n.verification_status) ||
        cited.has(refKey({ id: n.node_id, version: n.node_version })) ||
        (graph.conflicts ?? []).some((c) =>
          [c.subject_ref, ...c.position_refs, ...(c.resolution_ref ? [c.resolution_ref] : [])].some(
            (r) => r.id === n.node_id && r.version === n.node_version
          )
        )
    );
    const records = new Map(graph.records.map((r) => [refKey(r.node), r]));
    const keys = new Map(
      nodes.map((n, i) => [refKey({ id: n.node_id, version: n.node_version }), `n${i + 1}`])
    );
    const portable = {
      format: INTELLIGENCE_GRAPH_PACKAGE_FORMAT,
      title: graph.title,
      nodes: nodes.map((n) => {
        const record = records.get(refKey({ id: n.node_id, version: n.node_version }));
        if (!record) return invalid("Missing source text for export");
        return {
          key: keys.get(refKey(record.node)),
          kind: n.kind,
          label: record.text,
          detail: record.excerpt
        };
      }),
      edges: graph.edges
        .filter((e) => current(e.verification_status))
        .map((e) => ({
          relation: e.type,
          from: keys.get(refKey(e.from)),
          to: keys.get(refKey(e.to)),
          ...(e.evidence_excerpt === undefined
            ? {}
            : {
                evidence: {
                  source: keys.get(
                    refKey({ id: e.evidence_ref.source_id, version: e.evidence_ref.source_version })
                  ),
                  location: e.evidence_ref.location,
                  excerpt: e.evidence_excerpt
                }
              })
        })),
      ...((graph.conflicts?.length ?? 0) === 0
        ? {}
        : {
            conflicts: graph.conflicts!.map((c) => ({
              subject: keys.get(refKey(c.subject_ref)),
              positions: c.position_refs.map((r) => keys.get(refKey(r))),
              resolution: c.resolution_ref ? keys.get(refKey(c.resolution_ref)) : null
            }))
          })
    };
    return {
      ...this.previewImport(portable),
      source: { graph_id: graph.graph_id, revision: graph.revision }
    };
  }

  importPackage(
    ownerId: string,
    projectId: string,
    input: unknown,
    expectedSha256: string,
    creationKey?: string
  ): IntelligenceGraphWorkspace {
    const preview = this.previewImport(input);
    if (preview.sha256 !== expectedSha256)
      return invalid("Graph package hash differs from reviewed content");
    const portable: IntelligenceGraphPortablePackage = preview.package;
    const now = this.clock();
    const graph: IntelligenceGraphWorkspace = {
      graph_id: randomUUID(),
      owner_id: requireText(ownerId, 128, "ownerId"),
      project_id: requireText(projectId, 128, "projectId"),
      title: portable.title,
      revision: 1,
      created_at: now,
      updated_at: now,
      restored_from_revision: null,
      nodes: [],
      edges: [],
      records: []
    };
    const refs = new Map<string, IntelligenceGraphVersionRef>();
    for (const item of portable.nodes) {
      const id = randomUUID();
      refs.set(item.key, { id, version: 1 });
      graph.nodes.push({
        contract_version: 1,
        node_id: id,
        node_version: 1,
        kind: item.kind,
        owner_id: ownerId,
        project_id: projectId,
        scope: "project",
        created_at: now,
        observed_at: now,
        valid_from: now,
        valid_to: null,
        verification_status: "discovered",
        sensitivity: "D1_PROJECT",
        source_ref: {
          source_id: id,
          source_version: 1,
          location: `portable_import:sha256:${preview.sha256}`
        },
        provenance_kind: "owner_assertion",
        confidence_method: "owner_direct",
        extractor_version: "graph-workspace-v1",
        supersedes: null,
        deleted_at: null
      });
      graph.records.push({
        node: { id, version: 1 },
        text: item.label,
        excerpt: item.detail,
        estimated_tokens: Math.max(1, Math.ceil((item.label.length + item.detail.length) / 4))
      });
    }
    for (const item of portable.edges) {
      const edge = this.link(
        graph,
        randomUUID(),
        1,
        item.relation,
        refs.get(item.from)!,
        refs.get(item.to)!,
        now
      );
      edge.evidence_ref.location = `portable_import:sha256:${preview.sha256}`;
      if (item.evidence) {
        const source = refs.get(item.evidence.source)!;
        edge.evidence_ref = {
          source_id: source.id,
          source_version: source.version,
          location: item.evidence.location
        };
        edge.evidence_excerpt = item.evidence.excerpt;
      }
      graph.edges.push(edge);
    }
    if (portable.conflicts !== undefined)
      graph.conflicts = portable.conflicts.map((c) => ({
        contract_version: 1,
        conflict_id: randomUUID(),
        owner_id: ownerId,
        project_id: projectId,
        scope: "project",
        subject_ref: refs.get(c.subject)!,
        position_refs: c.positions.map((p) => refs.get(p)!),
        status: c.resolution === null ? "open" : "resolved",
        resolution_ref: c.resolution === null ? null : refs.get(c.resolution)!,
        created_at: now,
        resolved_at: c.resolution === null ? null : now
      }));
    ensureLimits(graph);
    if (creationKey === undefined) return this.repository.create(graph) ?? this.notFound();
    this.importKey(creationKey);
    const result = this.repository.createImported(graph, creationKey, preview.sha256);
    if (!result) return this.notFound();
    if (result.kind === "conflict")
      throw new IntelligenceGraphWorkspaceError(
        "IMPORT_KEY_CONFLICT",
        "Import key belongs to different reviewed content"
      );
    if (result.kind === "deleted")
      throw new IntelligenceGraphWorkspaceError(
        "IMPORT_DELETED",
        "Imported graph was deleted; retry cannot recreate it"
      );
    if (result.kind === "limit")
      throw new IntelligenceGraphWorkspaceError("GRAPH_LIMIT", "Import receipt limit reached");
    return result.graph;
  }

  private importKey(key: string): void {
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      return invalid("Invalid import creation key");
  }

  recoverImport(ownerId: string, projectId: string, creationKey: string) {
    this.importKey(creationKey);
    const receipt = this.repository.getImportReceipt(ownerId, projectId, creationKey);
    if (!receipt) return this.notFound();
    if (!receipt.graph_id)
      throw new IntelligenceGraphWorkspaceError(
        "IMPORT_DELETED",
        "Imported graph was deleted; retry cannot recreate it"
      );
    return {
      graph: this.get(ownerId, projectId, receipt.graph_id),
      sha256: receipt.package_sha256
    };
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

  explain(
    ownerId: string,
    projectId: string,
    graphId: string,
    query: string,
    revision?: number
  ): IntelligenceGraphWorkspaceExplanation {
    const graph =
      revision === undefined
        ? this.get(ownerId, projectId, graphId)
        : this.revision(ownerId, projectId, graphId, revision);
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
        quote: edge.evidence_excerpt ?? null,
        source_status:
          graph.nodes.find(
            (n) =>
              n.node_id === edge.evidence_ref.source_id &&
              n.node_version === edge.evidence_ref.source_version
          )?.verification_status ?? null,
        note:
          edge.verification_status === "verified"
            ? "Связь помечена проверенной; содержательно проверьте первичные источники."
            : "Ручная или предложенная связь; независимая проверка не выполнена."
      };
    });
    const matchedIds = new Set(result.evidence.nodes.map((n) => n.node.node_id));
    const queryTokens = graphSearchTokens(normalized);
    const relevant = (graph.conflicts ?? [])
      .filter((c) =>
        [c.subject_ref, ...c.position_refs, ...(c.resolution_ref ? [c.resolution_ref] : [])].some(
          (ref) => {
            if (matchedIds.has(ref.id)) return true;
            const r = records.get(refKey(ref));
            const tokens = new Set(graphSearchTokens(`${r?.text ?? ""} ${r?.excerpt ?? ""}`));
            return queryTokens.some((t) => tokens.has(t));
          }
        )
      )
      .sort((a, b) =>
        a.created_at < b.created_at
          ? -1
          : a.created_at > b.created_at
            ? 1
            : a.conflict_id < b.conflict_id
              ? -1
              : a.conflict_id > b.conflict_id
                ? 1
                : 0
      );
    const conflicts: IntelligenceGraphWorkspaceExplanation["conflicts"] = [];
    const conflictNodes = new Map<
      string,
      IntelligenceGraphWorkspaceExplanation["conflict_nodes"][number]
    >();
    const staleIds: string[] = [];
    for (const c of relevant) {
      const refs = [
        c.subject_ref,
        ...c.position_refs,
        ...(c.resolution_ref ? [c.resolution_ref] : [])
      ];
      const newKeys = new Set(refs.map(refKey).filter((k) => !conflictNodes.has(k)));
      // Each selected review is complete: never show only one side to fit the budget.
      if (conflicts.length >= 10 || conflictNodes.size + newKeys.size > 60) continue;
      conflicts.push({
        conflict_id: c.conflict_id,
        subject_ref: c.subject_ref,
        position_refs: c.position_refs,
        status: c.status,
        resolution_ref: c.resolution_ref,
        created_at: c.created_at,
        resolved_at: c.resolved_at
      });
      if (refs.some((r) => !current(vertices.get(refKey(r))!.verification_status)))
        staleIds.push(c.conflict_id);
      for (const ref of refs) {
        const node = vertices.get(refKey(ref))!;
        const record = records.get(refKey(ref));
        conflictNodes.set(refKey(ref), {
          ref,
          kind: node.kind,
          status: node.verification_status,
          label: record?.text ?? ref.id,
          detail: record?.excerpt ?? null
        });
      }
    }
    const concerns: string[] = [...result.concerns];
    if (relevant.some((c) => c.status === "open")) concerns.push("OPEN_CONFLICTS");
    if (
      relevant.some((c) =>
        [c.subject_ref, ...c.position_refs, ...(c.resolution_ref ? [c.resolution_ref] : [])].some(
          (r) => !current(vertices.get(refKey(r))!.verification_status)
        )
      )
    )
      concerns.push("STALE_CONFLICTS");
    const conflictTruncated = conflicts.length < relevant.length;
    if (conflictTruncated) concerns.push("TRUNCATED_CONFLICT_REVIEW");
    const readiness =
      result.readiness === "grounded_context" && concerns.length > 0
        ? "review_required"
        : result.readiness;
    return {
      graph_id: graph.graph_id,
      search_version: INTELLIGENCE_GRAPH_SEARCH_VERSION,
      graph_title: graph.title,
      revision: graph.revision,
      graph_updated_at: graph.updated_at,
      query: normalized,
      readiness,
      concerns,
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
      conflicts,
      conflict_nodes: [...conflictNodes.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, n]) => n),
      stale_conflict_ids: staleIds,
      conflict_review: {
        relevant: relevant.length,
        returned: conflicts.length,
        returned_nodes: conflictNodes.size,
        max_conflicts: 10,
        max_nodes: 60,
        truncated: conflictTruncated
      },
      paths: result.evidence.paths,
      budget: result.evidence.budget,
      truncated: result.evidence.budget.truncated || conflictTruncated,
      explanation:
        readiness === "abstain"
          ? "Недостаточно подтверждённых данных. Связи не считаются доказанными."
          : readiness === "review_required"
            ? "Найдены предварительные связи. Требуется проверка источников."
            : "Контекст прошёл формальную проверку; выводы ещё требуют содержательной проверки."
    };
  }

  report(ownerId: string, projectId: string, graphId: string, query: string, revision: number) {
    const report: IntelligenceGraphWorkspaceReport = {
      format: "kosmora.intelligence-graph-report.v1",
      reading: this.explain(ownerId, projectId, graphId, query, revision)
    };
    const sha256 = createHash("sha256").update(JSON.stringify(report)).digest("hex");
    return { report, sha256 };
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
