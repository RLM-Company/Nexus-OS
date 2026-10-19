/** Portable owner-reviewed content only: no scopes, verification, privileges or execution state. */
export const INTELLIGENCE_GRAPH_PACKAGE_FORMAT = "kosmora.intelligence-graph.v1" as const;
export const INTELLIGENCE_GRAPH_PACKAGE_MAX_BYTES = 800_000;
export const INTELLIGENCE_GRAPH_EDITABLE_KINDS = [
  "Claim",
  "Entity",
  "Source",
  "Document",
  "Decision",
  "Goal",
  "Task"
] as const;
export const INTELLIGENCE_GRAPH_EDITABLE_RELATIONS = [
  "SUPPORTS",
  "CONTRADICTS",
  "DEPENDS_ON",
  "IMPLEMENTS",
  "REFERENCES"
] as const;
export type IntelligenceGraphPortableKind = (typeof INTELLIGENCE_GRAPH_EDITABLE_KINDS)[number];
export type IntelligenceGraphPortableRelation =
  (typeof INTELLIGENCE_GRAPH_EDITABLE_RELATIONS)[number];
export interface IntelligenceGraphPortablePackage {
  format: typeof INTELLIGENCE_GRAPH_PACKAGE_FORMAT;
  title: string;
  nodes: { key: string; kind: IntelligenceGraphPortableKind; label: string; detail: string }[];
  edges: {
    relation: IntelligenceGraphPortableRelation;
    from: string;
    to: string;
    evidence?: { source: string; location: string; excerpt: string };
  }[];
  /** Organizational decisions are content relationships, never verification authority. */
  conflicts?: { subject: string; positions: string[]; resolution: string | null }[];
}
const fail = (message: string): never => {
  throw new Error(message);
};
const object = (
  value: unknown,
  keys: string[],
  optional: string[] = []
): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("Expected object");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !keys.includes(key) && !optional.includes(key)) ||
    !keys.every((key) => Object.hasOwn(record, key))
  )
    return fail("Unknown or missing package field");
  return record;
};
const text = (value: unknown, max: number): string => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    [...value].some((c) => c.charCodeAt(0) < 32 && !"\t\n\r".includes(c))
  )
    return fail("Invalid text field");
  return value;
};
/** Both browser and server validate independently. Returns a detached canonical key order. */
export function parseIntelligenceGraphPackage(input: unknown): IntelligenceGraphPortablePackage {
  const value =
    typeof input === "string"
      ? (() => {
          if (new TextEncoder().encode(input).length > INTELLIGENCE_GRAPH_PACKAGE_MAX_BYTES)
            return fail("Graph package too large");
          return JSON.parse(input) as unknown;
        })()
      : input;
  const root = object(value, ["format", "title", "nodes", "edges"], ["conflicts"]);
  if (root.format !== INTELLIGENCE_GRAPH_PACKAGE_FORMAT)
    return fail("Unsupported graph package format");
  const title = text(root.title, 80);
  if (
    !Array.isArray(root.nodes) ||
    root.nodes.length > 150 ||
    !Array.isArray(root.edges) ||
    root.edges.length > 300
  )
    return fail("Graph package exceeds node/edge limits");
  const keys = new Set<string>();
  const nodes = root.nodes.map((entry) => {
    const item = object(entry, ["key", "kind", "label", "detail"]);
    const key = text(item.key, 128);
    if (!/^[A-Za-z0-9_-]+$/.test(key) || keys.has(key))
      return fail("Duplicate or invalid node key");
    keys.add(key);
    if (!INTELLIGENCE_GRAPH_EDITABLE_KINDS.includes(item.kind as IntelligenceGraphPortableKind))
      return fail("Unsupported node kind");
    return {
      key,
      kind: item.kind as IntelligenceGraphPortableKind,
      label: text(item.label, 120),
      detail: text(item.detail, 1000)
    };
  });
  const edges = root.edges.map((entry) => {
    const item = object(entry, ["relation", "from", "to"], ["evidence"]);
    if (
      !INTELLIGENCE_GRAPH_EDITABLE_RELATIONS.includes(
        item.relation as IntelligenceGraphPortableRelation
      )
    )
      return fail("Unsupported relation type");
    const from = text(item.from, 128),
      to = text(item.to, 128);
    if (!keys.has(from) || !keys.has(to) || from === to)
      return fail("Missing endpoint or self-link");
    const edge: IntelligenceGraphPortablePackage["edges"][number] = {
      relation: item.relation as IntelligenceGraphPortableRelation,
      from,
      to
    };
    if (Object.hasOwn(item, "evidence")) {
      const citation = object(item.evidence, ["source", "location", "excerpt"]);
      const source = text(citation.source, 128),
        location = text(citation.location, 256),
        excerpt = text(citation.excerpt, 1000);
      const document = nodes.find((n) => n.key === source);
      if (
        !document ||
        !["Source", "Document"].includes(document.kind) ||
        !document.detail.includes(excerpt)
      )
        return fail("Citation must match exact text in a Source/Document node");
      edge.evidence = { source, location, excerpt };
    }
    return edge;
  });
  const result: IntelligenceGraphPortablePackage = {
    format: INTELLIGENCE_GRAPH_PACKAGE_FORMAT,
    title,
    nodes,
    edges
  };
  if (Object.hasOwn(root, "conflicts")) {
    if (!Array.isArray(root.conflicts) || root.conflicts.length > 50)
      return fail("Graph package exceeds conflict limit");
    result.conflicts = root.conflicts.map((entry) => {
      const item = object(entry, ["subject", "positions", "resolution"]);
      const subject = text(item.subject, 128);
      if (!keys.has(subject)) return fail("Missing conflict subject");
      if (!Array.isArray(item.positions) || item.positions.length < 2 || item.positions.length > 20)
        return fail("Conflict requires 2–20 positions");
      const positions = item.positions.map((p) => text(p, 128));
      if (
        new Set(positions).size !== positions.length ||
        positions.some((p) => nodes.find((n) => n.key === p)?.kind !== "Claim")
      )
        return fail("Conflict positions must be distinct Claim nodes");
      const resolution = item.resolution === null ? null : text(item.resolution, 128);
      if (resolution !== null && nodes.find((n) => n.key === resolution)?.kind !== "Decision")
        return fail("Conflict resolution must be a Decision node");
      return { subject, positions, resolution };
    });
  }
  if (
    new TextEncoder().encode(JSON.stringify(result)).length > INTELLIGENCE_GRAPH_PACKAGE_MAX_BYTES
  )
    return fail("Graph package too large");
  return result;
}
