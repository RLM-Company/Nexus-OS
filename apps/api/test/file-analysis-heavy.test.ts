/* eslint-disable @typescript-eslint/require-await -- Deterministic fixture transport. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  DocumentLibraryStore,
  DocumentAnswerStore
} from "@cosmora/db";
import { chunkLibraryPages, ChatService } from "@cosmora/core";
import type { ModelRequest } from "@cosmora/contracts";
import {
  DocumentAnswerService,
  type DocumentAnswerOwnerBudget,
  type DocumentAnswerTransport
} from "../src/document-answer-service.js";
import { buildWorkResultsArchive } from "../src/work-results-archive.js";

/**
 * HEAVY reproducible scenario for the File Analysis section:
 * nested ZIP, PDF scan, 140-page document, 600-row CSV -> real library,
 * real chunking, deep analysis coverage, cancel/retry and one reconciled ZIP
 * export with TXT/DOCX/PDF/CSV artifacts. No network or paid calls.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureDir = join(root, "docs/handoff/fixtures/file-analysis-heavy");
type Manifest = {
  question: string;
  expected: {
    long_pages: number;
    long_lines: number;
    csv_rows: number;
    citations: Array<{ file: string; quote: string; page: number | null }>;
  };
  limits: Record<string, number>;
};
const manifest = JSON.parse(readFileSync(join(fixtureDir, "manifest.json"), "utf8")) as Manifest;
const started = Date.now();
const peak = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
const route = {
  attempt: 0,
  registry_version: "fixture",
  provider_id: "fixture",
  model_id: "fixture",
  estimated_input_tokens: 200,
  max_output_tokens: 300,
  estimated_cost: null
};
const settle = async (store: DocumentAnswerStore, project: string, owner: string, id: string) => {
  for (let i = 0; i < 300; i++) {
    const result = store.get(project, owner, id)!;
    if (!["queued", "running"].includes(result.status)) return result;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("heavy run never settled");
};
function unzip(buffer: Buffer): Map<string, Buffer> {
  const end = buffer.length - 22;
  expect(buffer.readUInt32LE(end)).toBe(0x06054b50);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const local = buffer.readUInt32LE(cursor + 42);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const bytes = buffer.subarray(start, start + size);
    expect(crc32(bytes)).toBe(buffer.readUInt32LE(cursor + 16));
    files.set(name, bytes);
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  return files;
}
const transport: DocumentAnswerTransport = {
  assertRoute: () => undefined,
  async *stream(request: ModelRequest) {
    yield { type: "route.selected" as const, route };
    const input = request.messages.at(-1)!.content;
    const block = input.match(/\[(S\d+)\][^\n]*\n([^\n]{5,})/);
    const quoted = input.match(/«([^»]{5,500})»\s*\[(S\d+)\]/);
    const delta = block
      ? `«${block[2]}» [${block[1]}]`
      : quoted
        ? `«${quoted[1]}» [${quoted[2]}]`
        : "НЕТ РЕЛЕВАНТНЫХ ДАННЫХ";
    yield { type: "text.delta" as const, delta };
    yield {
      type: "response.completed" as const,
      provider: "fixture",
      model: "fixture",
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 20 },
      route,
      calculatedCost: null
    };
  }
};
const budget: DocumentAnswerOwnerBudget = {
  reserve: () => true,
  reconcile: () => undefined,
  uncertain: () => undefined
};

describe("heavy file-analysis scenario", () => {
  it("indexes, analyzes, cancels/retries and exports one reconciled result", async () => {
    const db = openDatabase(":memory:");
    try {
      await runMigrations(db);
      const owner = "heavy-owner";
      const project = new ProjectStore(db.sqlite).createProject("Heavy", "heavy-files", owner)
        .project.id;
      const library = new DocumentLibraryStore(db.sqlite);
      const answers = new DocumentAnswerStore(db.sqlite);
      const service = new DocumentAnswerService(
        library,
        answers,
        transport,
        new ChatService({
          preferredProvider: "fixture",
          preferredModelAlias: "fixture",
          fallbackAllowed: false
        }),
        budget
      );
      const zip = unzip(readFileSync(join(fixtureDir, "heavy.zip")));
      const nested = unzip(zip.get("nested-evidence.zip")!);
      const entries: Array<{ name: string; bytes: Buffer; text: string }> = [
        {
          name: "brief.txt",
          bytes: zip.get("brief.txt")!,
          text: zip.get("brief.txt")!.toString("utf8")
        },
        {
          name: "tables › budget.csv",
          bytes: zip.get("tables/budget.csv")!,
          text: zip.get("tables/budget.csv")!.toString("utf8")
        },
        {
          name: "long › report.txt",
          bytes: zip.get("long/report.txt")!,
          text: zip.get("long/report.txt")!.toString("utf8")
        },
        {
          name: "long › report.pdf",
          bytes: zip.get("long/report.pdf")!,
          text: zip.get("long/report.txt")!.toString("utf8")
        },
        {
          name: "scans › scan.pdf",
          bytes: zip.get("scans/scan.pdf")!,
          text: zip.get("scans/scan.txt")!.toString("utf8")
        },
        {
          name: "scans › scan.txt",
          bytes: zip.get("scans/scan.txt")!,
          text: zip.get("scans/scan.txt")!.toString("utf8")
        },
        {
          name: "memo.docx",
          bytes: zip.get("memo.docx")!,
          text: "Показатель SELENE-047 утверждён.\nСумма 19700."
        },
        {
          name: "nested-evidence.zip › nested › extra.csv",
          bytes: nested.get("nested/extra.csv")!,
          text: nested.get("nested/extra.csv")!.toString("utf8")
        },
        {
          name: "nested-evidence.zip › nested › quote.txt",
          bytes: nested.get("nested/quote.txt")!,
          text: nested.get("nested/quote.txt")!.toString("utf8")
        }
      ];
      const ids: string[] = [];
      for (const entry of entries) {
        const staged = library.stage(project, owner, entry.name, entry.bytes);
        const isPdf = entry.name.endsWith(".pdf");
        const pageCount = isPdf && entry.name.startsWith("long") ? manifest.expected.long_pages : 1;
        const lines = entry.text.split("\n");
        const pages = Array.from({ length: pageCount }, (_, i) => ({
          page: isPdf ? i + 1 : null,
          text: isPdf ? `Страница ${i + 1}. ${lines[i % lines.length] ?? ""}` : entry.text
        }));
        library.complete(project, owner, staged.id, pages, chunkLibraryPages(pages));
        ids.push(staged.id);
      }
      expect(library.list(project, owner)).toHaveLength(entries.length);
      const longFile = library.list(project, owner).find((f) => f.name === "long › report.txt")!;
      expect(longFile.chunks).toBeGreaterThanOrEqual(20);
      expect(longFile.chunks).toBeLessThanOrEqual(manifest.limits.chunks_per_file ?? 5000);

      const first = await service.ask(project, owner, manifest.question, ids, "deep");
      const cancelled = await service.cancel(project, owner, first.id);
      expect(cancelled).toBe(true);
      expect((await settle(answers, project, owner, first.id)).status).toBe("cancelled");
      const retried = await service.retry(project, owner, first.id);
      expect(retried.id).not.toBe(first.id);
      const done = await settle(answers, project, owner, retried.id);
      expect(done.status, done.error_code ?? "").toBe("done");
      expect(done.coverage).toBeDefined();
      expect(done.coverage!.analyzed_chunks + done.coverage!.failed_chunks).toBe(
        done.coverage!.total_chunks
      );
      expect(done.coverage!.files.filter((f) => f.name.includes("report"))).toHaveLength(2);

      // One completed result -> deterministic ZIP export with all formats.
      const files = done.coverage!.files.map((coverageFile, index) => {
        const entry = entries.find((e) => e.name === coverageFile.name)!;
        const content = entry.text;
        const contentBytes = Buffer.from(content, "utf8");
        const digest = createHash("sha256").update(contentBytes).digest("hex");
        return {
          name: entry.name,
          content,
          id: `artifact-${index}`,
          node_id: `node-${index}`,
          work_id: `work-${index}`,
          version: 1,
          sha256: digest,
          bytes: contentBytes.length,
          project_id: project,
          published: true,
          review: { verdict: "PASS" as const, reason: "fixture" },
          sources: []
        };
      });
      const graph = {
        id: "heavy-graph",
        project_id: project,
        owner_id: owner,
        actor_id: owner,
        version: 1,
        client_request_id: "heavy-request",
        title: "Heavy result",
        mode: "active" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        events: [],
        nodes: files.map((file, index) => ({
          id: file.node_id,
          title: file.name,
          goal: "export",
          depends_on: [],
          status: "completed" as const,
          attempts: [{ work_id: file.work_id, number: 1 }],
          artifacts: [
            {
              id: file.id,
              work_id: file.work_id,
              version: 1,
              name: file.name,
              sha256: file.sha256,
              bytes: file.bytes
            }
          ]
        }))
      };
      const archive = buildWorkResultsArchive(graph as never, files as never);
      const exported = unzip(archive);
      const exportedManifest = JSON.parse(exported.get("manifest.json")!.toString("utf8"));
      for (const manifestFile of exportedManifest.files) {
        const bytes = exported.get(manifestFile.path);
        expect(bytes?.length).toBe(manifestFile.bytes ?? 0);
        expect(manifestFile.original_name).toMatch(/\.(txt|csv|pdf|docx)$/);
      }
      expect(exportedManifest.complete).toBe(true);
      expect(exportedManifest.files).toHaveLength(files.length);
      const formats = new Set(files.map((f) => f.name.split(".").at(-1)));
      expect([...formats].sort()).toEqual(["csv", "docx", "pdf", "txt"]);
      console.log(
        "HEAVY_METRICS=" +
          JSON.stringify({
            ms: Date.now() - started,
            heapMb: peak(),
            files: files.length,
            chunks: done.coverage!.total_chunks,
            archiveBytes: archive.length
          })
      );
    } finally {
      db.close();
    }
  }, 120_000);
});
