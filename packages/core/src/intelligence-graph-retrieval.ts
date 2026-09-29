import {
  validateIntelligenceGraphSnapshot,
  type IntelligenceGraphEdge,
  type IntelligenceGraphNode,
  type IntelligenceGraphVersionRef
} from "@cosmora/contracts";

export type IntelligenceGraphQueryMode = "baseline" | "local" | "multi_hop" | "temporal";

export interface IntelligenceGraphSearchRecord {
  node: IntelligenceGraphVersionRef;
  text: string;
  excerpt: string;
  estimated_tokens: number;
}

export interface IntelligenceGraphQueryBudget {
  max_depth: number;
  max_nodes: number;
  max_edges: number;
  max_fan_out: number;
  max_context_tokens: number;
}

export interface IntelligenceGraphQuery {
  owner_id: string;
  project_id: string;
  text: string;
  mode: IntelligenceGraphQueryMode;
  as_of?: string | null;
  verified_only?: boolean;
  budget?: Partial<IntelligenceGraphQueryBudget>;
}

export interface IntelligenceGraphEvidenceNode {
  node: IntelligenceGraphNode;
  excerpt: string | null;
  lexical_score: number;
}

export interface IntelligenceGraphEvidencePath {
  seed: IntelligenceGraphVersionRef;
  target: IntelligenceGraphVersionRef;
  edges: IntelligenceGraphVersionRef[];
}

export interface IntelligenceGraphEvidencePacket {
  owner_id: string;
  project_id: string;
  query_mode: IntelligenceGraphQueryMode;
  query_text: string;
  as_of: string | null;
  sufficient_evidence: boolean;
  nodes: IntelligenceGraphEvidenceNode[];
  edges: IntelligenceGraphEdge[];
  paths: IntelligenceGraphEvidencePath[];
  unresolved_node_ids: string[];
  budget: IntelligenceGraphQueryBudget & {
    visited_nodes: number;
    returned_edges: number;
    estimated_context_tokens: number;
    truncated: boolean;
  };
}

const DEFAULT_BUDGET: IntelligenceGraphQueryBudget = {
  max_depth: 2,
  max_nodes: 24,
  max_edges: 48,
  max_fan_out: 8,
  max_context_tokens: 2_400
};

const HARD_LIMITS: IntelligenceGraphQueryBudget = {
  max_depth: 6,
  max_nodes: 200,
  max_edges: 400,
  max_fan_out: 40,
  max_context_tokens: 24_000
};

const versionKey = (ref: IntelligenceGraphVersionRef): string => `${ref.id}@${ref.version}`;
const nodeRef = (node: IntelligenceGraphNode): IntelligenceGraphVersionRef => ({
  id: node.node_id,
  version: node.node_version
});
const edgeRef = (edge: IntelligenceGraphEdge): IntelligenceGraphVersionRef => ({
  id: edge.edge_id,
  version: edge.edge_version
});

const tokenize = (value: string): string[] =>
  [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])];

const lexicalScore = (query: string, record: IntelligenceGraphSearchRecord): number => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalizedText = record.text.trim().toLocaleLowerCase();
  if (!normalizedQuery || !normalizedText) return 0;

  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.length === 0) return 0;
  const textTokens = new Set(tokenize(normalizedText));
  const overlap = queryTokens.filter((token) => textTokens.has(token)).length;
  const exactBonus = normalizedText.includes(normalizedQuery) ? queryTokens.length * 2 : 0;
  return overlap + exactBonus;
};

const safeInteger = (
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string
): number => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > maximum) {
    throw new Error(`Invalid Intelligence Graph query budget: ${label}`);
  }
  return resolved;
};

const resolveBudget = (
  budget: Partial<IntelligenceGraphQueryBudget> | undefined
): IntelligenceGraphQueryBudget => ({
  max_depth: safeInteger(budget?.max_depth, DEFAULT_BUDGET.max_depth, HARD_LIMITS.max_depth, "max_depth"),
  max_nodes: safeInteger(budget?.max_nodes, DEFAULT_BUDGET.max_nodes, HARD_LIMITS.max_nodes, "max_nodes"),
  max_edges: safeInteger(budget?.max_edges, DEFAULT_BUDGET.max_edges, HARD_LIMITS.max_edges, "max_edges"),
  max_fan_out: safeInteger(
    budget?.max_fan_out,
    DEFAULT_BUDGET.max_fan_out,
    HARD_LIMITS.max_fan_out,
    "max_fan_out"
  ),
  max_context_tokens: safeInteger(
    budget?.max_context_tokens,
    DEFAULT_BUDGET.max_context_tokens,
    HARD_LIMITS.max_context_tokens,
    "max_context_tokens"
  )
});

const parseTime = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Intelligence Graph time: ${label}`);
  return parsed;
};

const nodeVisibleAt = (node: IntelligenceGraphNode, asOf: string | null): boolean => {
  if (asOf === null) {
    return node.verification_status !== "deleted" && node.verification_status !== "superseded";
  }

  const instant = parseTime(asOf, "as_of");
  if (parseTime(node.created_at, `node ${node.node_id} created_at`) > instant) return false;
  if (node.valid_from !== null && parseTime(node.valid_from, "valid_from") > instant) return false;
  if (node.valid_to !== null && parseTime(node.valid_to, "valid_to") < instant) return false;
  if (node.deleted_at !== null && parseTime(node.deleted_at, "deleted_at") <= instant) return false;
  return node.verification_status !== "deleted";
};

const edgeVisibleAt = (edge: IntelligenceGraphEdge, asOf: string | null): boolean => {
  if (asOf === null) {
    return edge.verification_status !== "deleted" && edge.verification_status !== "superseded";
  }

  const instant = parseTime(asOf, "as_of");
  if (parseTime(edge.created_at, `edge ${edge.edge_id} created_at`) > instant) return false;
  if (edge.valid_from !== null && parseTime(edge.valid_from, "valid_from") > instant) return false;
  if (edge.valid_to !== null && parseTime(edge.valid_to, "valid_to") < instant) return false;
  if (edge.deleted_at !== null && parseTime(edge.deleted_at, "deleted_at") <= instant) return false;
  return edge.verification_status !== "deleted";
};

const verifiedEnough = (node: IntelligenceGraphNode): boolean =>
  node.verification_status === "verified";

export class IntelligenceGraphIndex {
  readonly #ownerId: string;
  readonly #projectId: string;
  readonly #nodes: Map<string, IntelligenceGraphNode>;
  readonly #edges: readonly IntelligenceGraphEdge[];
  readonly #records: Map<string, IntelligenceGraphSearchRecord>;
  readonly #adjacency: Map<string, IntelligenceGraphEdge[]>;

  constructor(input: {
    ownerId: string;
    projectId: string;
    nodes: readonly IntelligenceGraphNode[];
    edges: readonly IntelligenceGraphEdge[];
    records: readonly IntelligenceGraphSearchRecord[];
  }) {
    const issues = validateIntelligenceGraphSnapshot({
      ownerId: input.ownerId,
      projectId: input.projectId,
      nodes: input.nodes,
      edges: input.edges
    });
    if (issues.length > 0) {
      throw new Error(`Invalid Intelligence Graph snapshot: ${issues.join("; ")}`);
    }

    this.#ownerId = input.ownerId;
    this.#projectId = input.projectId;
    this.#nodes = new Map(input.nodes.map((node) => [versionKey(nodeRef(node)), structuredClone(node)]));
    this.#edges = input.edges.map((edge) => structuredClone(edge));
    this.#records = new Map();
    this.#adjacency = new Map();

    for (const record of input.records) {
      const key = versionKey(record.node);
      if (!this.#nodes.has(key)) {
        throw new Error(`Intelligence Graph search record references unknown node: ${key}`);
      }
      if (!record.text.trim() || !record.excerpt.trim()) {
        throw new Error(`Intelligence Graph search record is empty: ${key}`);
      }
      if (
        !Number.isInteger(record.estimated_tokens) ||
        record.estimated_tokens < 1 ||
        record.estimated_tokens > HARD_LIMITS.max_context_tokens
      ) {
        throw new Error(`Invalid Intelligence Graph search token estimate: ${key}`);
      }
      if (this.#records.has(key)) {
        throw new Error(`Duplicate Intelligence Graph search record: ${key}`);
      }
      this.#records.set(key, structuredClone(record));
    }

    for (const edge of this.#edges) {
      const fromKey = versionKey(edge.from);
      const toKey = versionKey(edge.to);
      const fromEdges = this.#adjacency.get(fromKey) ?? [];
      fromEdges.push(edge);
      this.#adjacency.set(fromKey, fromEdges);
      const toEdges = this.#adjacency.get(toKey) ?? [];
      toEdges.push(edge);
      this.#adjacency.set(toKey, toEdges);
    }
  }

  query(query: IntelligenceGraphQuery): IntelligenceGraphEvidencePacket {
    if (query.owner_id !== this.#ownerId || query.project_id !== this.#projectId) {
      throw new Error("Intelligence Graph query scope does not match the index");
    }
    if (!query.text.trim()) throw new Error("Intelligence Graph query text is required");

    const asOf = query.mode === "temporal" ? (query.as_of ?? null) : null;
    if (query.mode === "temporal" && asOf === null) {
      throw new Error("Temporal Intelligence Graph query requires as_of");
    }
    if (asOf !== null) parseTime(asOf, "as_of");

    const budget = resolveBudget(query.budget);
    const candidates = [...this.#records.values()]
      .map((record) => {
        const node = this.#nodes.get(versionKey(record.node));
        if (!node || !nodeVisibleAt(node, asOf)) return null;
        if (query.verified_only && !verifiedEnough(node)) return null;
        return { record, node, score: lexicalScore(query.text, record) };
      })
      .filter(
        (
          candidate
        ): candidate is {
          record: IntelligenceGraphSearchRecord;
          node: IntelligenceGraphNode;
          score: number;
        } => candidate !== null && candidate.score > 0
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          versionKey(left.record.node).localeCompare(versionKey(right.record.node))
      );

    const seedLimit = query.mode === "baseline" ? budget.max_nodes : Math.min(3, budget.max_nodes);
    const seeds = candidates.slice(0, seedLimit);

    const selectedNodes = new Map<string, IntelligenceGraphEvidenceNode>();
    const selectedEdges = new Map<string, IntelligenceGraphEdge>();
    const paths = new Map<string, IntelligenceGraphEvidencePath>();
    const queue: Array<{
      key: string;
      depth: number;
      seed: IntelligenceGraphVersionRef;
      path: IntelligenceGraphVersionRef[];
    }> = [];
    let estimatedContextTokens = 0;
    let truncated = candidates.length > seeds.length && query.mode === "baseline";

    const addNode = (
      node: IntelligenceGraphNode,
      score: number,
      seed: IntelligenceGraphVersionRef,
      path: IntelligenceGraphVersionRef[]
    ): boolean => {
      const key = versionKey(nodeRef(node));
      if (selectedNodes.has(key)) return true;
      if (selectedNodes.size >= budget.max_nodes) {
        truncated = true;
        return false;
      }
      const record = this.#records.get(key);
      const tokens = record?.estimated_tokens ?? 1;
      if (estimatedContextTokens + tokens > budget.max_context_tokens) {
        truncated = true;
        return false;
      }
      selectedNodes.set(key, {
        node: structuredClone(node),
        excerpt: record?.excerpt ?? null,
        lexical_score: score
      });
      estimatedContextTokens += tokens;
      paths.set(key, {
        seed: structuredClone(seed),
        target: nodeRef(node),
        edges: path.map((ref) => structuredClone(ref))
      });
      return true;
    };

    for (const seedCandidate of seeds) {
      const seed = seedCandidate.record.node;
      if (addNode(seedCandidate.node, seedCandidate.score, seed, [])) {
        queue.push({ key: versionKey(seed), depth: 0, seed, path: [] });
      }
    }

    if (query.mode !== "baseline") {
      const seen = new Set(queue.map((item) => item.key));
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) break;
        if (current.depth >= budget.max_depth) continue;

        const adjacent = (this.#adjacency.get(current.key) ?? [])
          .filter((edge) => edgeVisibleAt(edge, asOf))
          .sort((left, right) => left.edge_id.localeCompare(right.edge_id));

        if (adjacent.length > budget.max_fan_out) truncated = true;

        for (const edge of adjacent.slice(0, budget.max_fan_out)) {
          if (selectedEdges.size >= budget.max_edges) {
            truncated = true;
            break;
          }

          const fromKey = versionKey(edge.from);
          const nextRef = fromKey === current.key ? edge.to : edge.from;
          const nextKey = versionKey(nextRef);
          const nextNode = this.#nodes.get(nextKey);
          if (!nextNode || !nodeVisibleAt(nextNode, asOf)) continue;
          if (query.verified_only && !verifiedEnough(nextNode)) continue;

          const nextPath = [...current.path, edgeRef(edge)];
          const record = this.#records.get(nextKey);
          const score = record ? lexicalScore(query.text, record) : 0;
          if (!addNode(nextNode, score, current.seed, nextPath)) continue;

          if (!selectedEdges.has(versionKey(edgeRef(edge)))) {
            selectedEdges.set(versionKey(edgeRef(edge)), structuredClone(edge));
          }

          if (!seen.has(nextKey) && query.mode === "multi_hop") {
            seen.add(nextKey);
            queue.push({
              key: nextKey,
              depth: current.depth + 1,
              seed: current.seed,
              path: nextPath
            });
          } else if (!seen.has(nextKey) && query.mode === "local" && current.depth === 0) {
            seen.add(nextKey);
          } else if (!seen.has(nextKey) && query.mode === "temporal") {
            seen.add(nextKey);
            queue.push({
              key: nextKey,
              depth: current.depth + 1,
              seed: current.seed,
              path: nextPath
            });
          }
        }
      }
    }

    const nodes = [...selectedNodes.values()];
    const unresolvedNodeIds = nodes
      .filter(({ node }) => node.verification_status === "disputed" || node.verification_status === "hypothesis")
      .map(({ node }) => node.node_id)
      .sort();

    const sufficientEvidence =
      nodes.some(({ node }) => verifiedEnough(node)) &&
      (!query.verified_only || nodes.every(({ node }) => verifiedEnough(node)));

    return {
      owner_id: this.#ownerId,
      project_id: this.#projectId,
      query_mode: query.mode,
      query_text: query.text,
      as_of: asOf,
      sufficient_evidence: sufficientEvidence,
      nodes,
      edges: [...selectedEdges.values()],
      paths: [...paths.values()],
      unresolved_node_ids: unresolvedNodeIds,
      budget: {
        ...budget,
        visited_nodes: nodes.length,
        returned_edges: selectedEdges.size,
        estimated_context_tokens: estimatedContextTokens,
        truncated
      }
    };
  }
}
