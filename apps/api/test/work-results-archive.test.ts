import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import type { WorkDag } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { buildWorkResultsArchive } from "../src/work-results-archive.js";

// Read through the central directory, independently of the writer's local-record ordering.
function unzip(buffer: Buffer): Map<string, Buffer> {
  const end = buffer.length - 22;
  expect(buffer.readUInt32LE(end)).toBe(0x06054b50);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    expect(buffer.readUInt16LE(cursor + 10)).toBe(0);
    const size = buffer.readUInt32LE(cursor + 24),
      nameLength = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const local = buffer.readUInt32LE(cursor + 42);
    expect(buffer.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const bytes = buffer.subarray(start, start + size);
    expect(bytes.length).toBe(size);
    expect(crc32(bytes)).toBe(buffer.readUInt32LE(cursor + 16));
    expect(files.has(name)).toBe(false);
    files.set(name, bytes);
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  expect(cursor).toBe(end);
  return files;
}
function fixture(content = "Привет, мир!\r\nТочные байты ✅\n") {
  const files = [0, 1].map((i) => ({
    id: `artifact-${i}`,
    project_id: "project",
    work_id: `work-${i}`,
    name: "result.md",
    version: i + 1,
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: Buffer.byteLength(content),
    published: true,
    created_at: "2026-10-16T00:00:00Z",
    content,
    node_id: `node-${i}`,
    title: i ? "Второй" : "<img src=x> | [ссылка](https://example.com)",
    review: { verdict: "PASS", reason: "Checked" },
    sources: [{ run_id: `run-${i}`, provider: "mock", model: "fixture", stage: "draft" }]
  }));
  const graph: WorkDag = {
    id: "graph",
    project_id: "project",
    owner_id: "PRIVATE_OWNER",
    actor_id: "PRIVATE_ACTOR",
    version: 7,
    client_request_id: "PRIVATE_REQUEST",
    title: "Отчёт",
    mode: "active",
    created_at: "2026-10-16T00:00:00Z",
    updated_at: "2026-10-16T00:00:00Z",
    events: [],
    nodes: files.map((file) => ({
      id: file.node_id,
      title: file.title,
      goal: "PRIVATE_GOAL",
      depends_on: [],
      status: "completed",
      blocked_reason: null,
      attempts: [],
      artifacts: [{ ...file }]
    }))
  };
  return { graph, files, content };
}

describe("Work results ZIP", () => {
  it("preserves exact UTF-8 bytes, duplicate basenames, versions and source provenance with deterministic output", () => {
    const { graph, files, content } = fixture();
    const zip = buildWorkResultsArchive(graph, files),
      entries = unzip(zip);
    expect([...entries.keys()]).toEqual([
      "README.md",
      "manifest.json",
      "steps/01/001-result.md",
      "steps/02/002-result.md"
    ]);
    expect(entries.get("steps/01/001-result.md")).toEqual(Buffer.from(content));
    expect(entries.get("steps/02/002-result.md")).toEqual(Buffer.from(content));
    const manifest = JSON.parse(entries.get("manifest.json")!.toString()) as {
      complete: boolean;
      graph_version: number;
      files: Record<string, unknown>[];
    };
    expect(manifest.complete).toBe(true);
    expect(manifest.graph_version).toBe(7);
    expect(manifest.files[1]).toMatchObject({
      version: 2,
      original_name: "result.md",
      review: { verdict: "PASS" },
      sources: files[1]!.sources
    });
    const report = entries.get("README.md")!.toString();
    expect(report).not.toMatch(/(?<!\\)<img/);
    expect(report).not.toContain("[ссылка](https://");
    expect(report).toContain("\\<img");
    expect(zip.includes(Buffer.from("PRIVATE_"))).toBe(false);
    expect(buildWorkResultsArchive(graph, files)).toEqual(zip);
  });
  it("labels partial and empty exports honestly, including cancelled and archived plans", () => {
    const { graph, files } = fixture();
    graph.nodes[1]!.status = "cancelled";
    graph.nodes[1]!.artifacts = [];
    graph.archived_at = graph.updated_at;
    const entries = unzip(buildWorkResultsArchive(graph, files.slice(0, 1)));
    const manifest = JSON.parse(entries.get("manifest.json")!.toString()) as Record<
      string,
      unknown
    >;
    expect(manifest).toMatchObject({
      complete: false,
      completed_steps: 1,
      total_steps: 2,
      archived: true
    });
    expect(entries.get("README.md")!.toString()).toContain("Это частичный результат");
    expect(entries.get("README.md")!.toString()).toContain("Отменён");
    graph.nodes[0]!.status = "pending";
    graph.nodes[0]!.artifacts = [];
    expect([...unzip(buildWorkResultsArchive(graph, [])).keys()]).toEqual([
      "README.md",
      "manifest.json"
    ]);
  });
  it.each(["../escape.md", "folder/file.md", "C:\\file.md", "/root.md", "name.exe", "é.md"])(
    "rejects unsafe or unexpected archive filename %s",
    (name) => {
      const { graph, files } = fixture();
      files[0]!.name = name;
      expect(() => buildWorkResultsArchive(graph, files)).toThrow("RESULTS_INVALID_ARTIFACT");
    }
  );
  it.each(["content", "bytes", "work_id", "published", "project_id", "version"])(
    "refuses a mismatched %s before returning any ZIP",
    (field) => {
      const { graph, files } = fixture();
      Object.assign(files[0]!, {
        [field]:
          field === "published" ? false : field === "bytes" || field === "version" ? 999 : "changed"
      });
      expect(() => buildWorkResultsArchive(graph, files)).toThrow("DEPENDENCY_ARTIFACT_MISSING");
    }
  );
  it("refuses unpublished or non-completed results and bounded-output overflow", () => {
    const { graph, files } = fixture();
    graph.nodes[0]!.status = "failed";
    expect(() => buildWorkResultsArchive(graph, files)).toThrow("DEPENDENCY_ARTIFACT_MISSING");
    const huge = fixture("x".repeat(2_000_000));
    expect(() => buildWorkResultsArchive(huge.graph, huge.files)).toThrow("RESULTS_LIMIT");
  });
});
