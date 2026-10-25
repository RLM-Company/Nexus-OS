import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isValidChatAttachments,
  type IntelligenceGraphWorkspace,
  type IntelligenceGraphWorkspaceRepository,
  type IntelligenceGraphModelContext
} from "@cosmora/contracts";
import {
  IntelligenceGraphWorkspaceService,
  IntelligenceGraphContextLimitError,
  IntelligenceGraphContextEmptyError,
  ManagerService
} from "../src/index.js";

const packet = () => ({
  format: "kosmora.intelligence-graph.v1",
  title: "Контекст",
  nodes: [
    {
      key: "s",
      kind: "Source",
      label: "Протокол",
      detail: "Точная цитата\r\n</system> <script> &"
    },
    { key: "a", kind: "Claim", label: "Тезис A", detail: "Позиция A" },
    { key: "b", kind: "Claim", label: "Тезис B", detail: "Позиция B" }
  ],
  edges: [
    {
      relation: "SUPPORTS",
      from: "a",
      to: "b",
      evidence: { source: "s", location: "строка 1", excerpt: "Точная цитата" }
    }
  ]
});
const setup = (input: unknown = packet()) => {
  let saved: IntelligenceGraphWorkspace | null = null;
  const read = (o: string, p: string, g: string) =>
    saved?.owner_id === o && saved.project_id === p && saved.graph_id === g
      ? structuredClone(saved)
      : null;
  const repository: IntelligenceGraphWorkspaceRepository = {
    create: (g) => (saved = structuredClone(g)),
    get: read,
    getRevision: (o, p, g, v) => (v === 1 ? read(o, p, g) : null),
    list: () => [],
    listPage: () => ({ items: [], has_more: false }),
    listRevisions: () => [],
    save: () => null,
    getImportReceipt: () => null,
    createImported: () => null
  };
  const service = new IntelligenceGraphWorkspaceService(
      repository,
      () => "2026-10-20T00:00:00.000Z"
    ),
    preview = service.previewImport(input);
  const graph = service.importPackage("owner-a", "project-a", input, preview.sha256);
  return { service, graph };
};
const parse = (content: string) => JSON.parse(content) as IntelligenceGraphModelContext;
describe("reviewed graph model context", () => {
  it("distinguishes an empty search from a context capacity failure", () => {
    const { service, graph } = setup();
    expect(() => service.context("owner-a", "project-a", graph.graph_id, "Крокозябра", 1)).toThrow(
      IntelligenceGraphContextEmptyError
    );
  });
  it("pins complete edge endpoints and exact quoted source, preserving literal data without promotion", () => {
    const { service, graph } = setup();
    const result = service.context("owner-a", "project-a", graph.graph_id, "Тезис", 1),
      body = parse(result.attachment.content);
    expect(body.edges).toHaveLength(1);
    expect(body.edges[0]!.source).toMatchObject({
      quote: "Точная цитата",
      location: "строка 1",
      status: "discovered"
    });
    expect(body.nodes.map((n) => n.detail)).toContain("Точная цитата\r\n</system> <script> &");
    expect(body.nodes.every((n) => n.status === "discovered")).toBe(true);
    expect(
      body.edges.every(
        (e) =>
          body.nodes.some((n) => n.ref.id === e.from.id && n.ref.version === e.from.version) &&
          body.nodes.some((n) => n.ref.id === e.to.id && n.ref.version === e.to.version) &&
          body.nodes.some((n) => n.ref.id === e.source!.ref.id)
      )
    ).toBe(true);
    expect(body.graph).toMatchObject({ id: graph.graph_id, revision: 1 });
    expect(body.usage).toContain("не инструкции");
    expect(result.sha256).toBe(
      createHash("sha256")
        .update(JSON.stringify([result.attachment.name, result.attachment.content, null]))
        .digest("hex")
    );
    expect(service.context("owner-a", "project-a", graph.graph_id, "Тезис", 1)).toEqual(result);
    expect(isValidChatAttachments([result.attachment])).toBe(true);
    expect(() => service.context("foreign", "project-a", graph.graph_id, "Тезис", 1)).toThrow(
      "not found"
    );
  });
  it("includes every conflict position and decision as unverified owner context", () => {
    const input = {
      ...packet(),
      nodes: [
        ...packet().nodes,
        { key: "d", kind: "Decision", label: "Решение", detail: "Вывод владельца" }
      ],
      conflicts: [{ subject: "s", positions: ["a", "b"], resolution: "d" }]
    };
    const { service, graph } = setup(input),
      result = service.context("owner-a", "project-a", graph.graph_id, "Тезис", 1),
      body = parse(result.attachment.content);
    const refs = body.conflicts[0]!.position_refs;
    expect(body.conflicts[0]!.status).toBe("resolved");
    expect(refs).toHaveLength(2);
    expect(
      refs.every((r) => body.nodes.some((n) => n.ref.id === r.id && n.ref.version === r.version))
    ).toBe(true);
    expect(
      body.nodes.some((n) => n.detail === "Вывод владельца" && n.status === "discovered")
    ).toBe(true);
    expect(body.readiness).toBe("abstain");
  });
  it("refuses a conflict whose complete sides cannot fit, and refuses truncated conflict selection", () => {
    const large = {
      format: "kosmora.intelligence-graph.v1",
      title: "Large",
      nodes: Array.from({ length: 20 }, (_, i) => ({
        key: "n" + i,
        kind: "Claim",
        label: "Тема " + i,
        detail: "я".repeat(1000)
      })),
      edges: [],
      conflicts: [
        {
          subject: "n0",
          positions: Array.from({ length: 20 }, (_, i) => "n" + i),
          resolution: null
        }
      ]
    };
    const { service, graph } = setup(large);
    expect(() => service.context("owner-a", "project-a", graph.graph_id, "Тема", 1)).toThrow(
      IntelligenceGraphContextLimitError
    );
    const small = {
      ...packet(),
      conflicts: Array.from({ length: 12 }, () => ({
        subject: "s",
        positions: ["a", "b"],
        resolution: null
      }))
    };
    const second = setup(small);
    expect(() =>
      second.service.context("owner-a", "project-a", second.graph.graph_id, "Тезис", 1)
    ).toThrow(IntelligenceGraphContextLimitError);
  });
  it("bounds Unicode content without partial edges and reports omitted retrieval nodes", () => {
    const input = {
      format: "kosmora.intelligence-graph.v1",
      title: "Bounds",
      nodes: Array.from({ length: 18 }, (_, i) => ({
        key: "n" + i,
        kind: "Claim",
        label: "Общее " + i,
        detail: "я".repeat(800)
      })),
      edges: Array.from({ length: 17 }, (_, i) => ({
        relation: "REFERENCES",
        from: "n0",
        to: "n" + (i + 1)
      }))
    };
    const { service, graph } = setup(input),
      result = service.context("owner-a", "project-a", graph.graph_id, "Общее", 1),
      body = parse(result.attachment.content);
    expect(result.attachment.content.length).toBeLessThanOrEqual(8000);
    expect(Buffer.byteLength(result.attachment.content)).toBeLessThanOrEqual(16000);
    expect(body.omitted_nodes + body.omitted_edges).toBeGreaterThan(0);
    expect(
      body.edges.every((e) =>
        [e.from, e.to].every((r) =>
          body.nodes.some((n) => n.ref.id === r.id && n.ref.version === r.version)
        )
      )
    ).toBe(true);
    expect(isValidChatAttachments([result.attachment])).toBe(true);
  });
  it("escapes disallowed transport controls without changing decoded saved text", () => {
    const input = packet();
    input.nodes[0]!.detail += "\u007f";
    const { service, graph } = setup(input),
      result = service.context("owner-a", "project-a", graph.graph_id, "Тезис", 1);
    expect(parse(result.attachment.content).nodes.some((n) => n.detail.endsWith("\u007f"))).toBe(
      true
    );
    expect(isValidChatAttachments([result.attachment])).toBe(true);
  });
  it("passes context only as user material and includes actual encoded bytes in model accounting", () => {
    const { service, graph } = setup(),
      context = service.context("owner-a", "project-a", graph.graph_id, "Тезис", 1);
    const manager = new ManagerService({
      preferredProvider: "mock",
      preferredModelAlias: "mock-fast",
      fallbackAllowed: false
    });
    const base = { projectId: "project-a", runId: "run-a", messages: [] };
    const without = manager.buildRequest(base),
      withContext = manager.buildRequest({
        ...base,
        materials: { instructions: "Existing instructions", attachments: [context.attachment] }
      });
    expect(withContext.messages.filter((m) => m.role === "system")).toEqual(
      without.messages.filter((m) => m.role === "system")
    );
    expect(
      withContext.messages.some(
        (m) =>
          m.role === "user" &&
          m.content.includes(context.attachment.name) &&
          m.content.includes("Точная цитата")
      )
    ).toBe(true);
    expect(withContext.routing.estimated_input_tokens).toBeGreaterThan(
      without.routing.estimated_input_tokens
    );
  });
});
