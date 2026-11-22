/* eslint-disable @typescript-eslint/require-await -- Deterministic fixture transport. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/** Drive the REAL deep document analyzer with the synthetic Studio package.
 * No paid calls, no network: mock transport echoes verbatim source citations. */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureDir = join(root, "docs/handoff/fixtures/studio-document-package");
type Manifest = {
  question: string;
  citations: Array<{ file: string; page: number | null; line: number; quote: string }>;
  archives: {
    extended: {
      file: string;
      incomplete: Array<{ name: string; reason: string }>;
      skipped: Array<{ name: string; reason: string }>;
    };
  };
};
const manifest = JSON.parse(readFileSync(join(fixtureDir, "manifest.json"), "utf8")) as Manifest;
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
  for (let i = 0; i < 100; i++) {
    const result = store.get(project, owner, id)!;
    if (!["queued", "running"].includes(result.status)) return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("fixture never settled");
};

/** stage() verifies only the container signature; page/chunk text is supplied
 * separately by complete(), so a minimal signed buffer is enough here. */
const bytesFor = (name: string, quote: string): Buffer => {
  if (name.endsWith(".pdf"))
    return Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(quote, "utf8")]);
  if (name.endsWith(".docx"))
    return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(quote, "utf8")]);
  return Buffer.from(quote, "utf8");
};

describe("synthetic Studio package through real deep analysis", () => {
  it("analyzes packaged documents and reports honest coverage", async () => {
    const db = openDatabase(":memory:");
    try {
      await runMigrations(db);
      const owner = "owner-a";
      const project = new ProjectStore(db.sqlite).createProject(
        "Studio fixture",
        "studio-fixture",
        owner
      ).project.id;
      const library = new DocumentLibraryStore(db.sqlite);
      const answers = new DocumentAnswerStore(db.sqlite);

      // Register only files with a usable text layer. The scanned PDF has no
      // text chunks and is reported as incomplete in the manifest, not passed
      // to the analyzer as if it were analyzable.
      const ids: string[] = [];
      for (const c of manifest.citations) {
        const staged = library.stage(project, owner, c.file, bytesFor(c.file, c.quote));
        const pages = [{ page: c.page, text: c.quote }];
        library.complete(project, owner, staged.id, pages, chunkLibraryPages(pages));
        ids.push(staged.id);
      }
      expect(ids).toHaveLength(manifest.citations.length);

      const transport: DocumentAnswerTransport = {
        assertRoute: () => undefined,
        async *stream(request: ModelRequest) {
          yield { type: "route.selected" as const, route };
          const input = request.messages.at(-1)!.content;
          // Return a verbatim citation for per-batch inputs; synthesis inputs
          // already contain such notes and are merged without new claims.
          const existing = input.match(/«([^»]{5,500})»\s*\[(S\d+)\]/);
          const delta = existing ? `«${existing[1]}» [${existing[2]}]` : "НЕТ РЕЛЕВАНТНЫХ ДАННЫХ";
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
      const chat = new ChatService({
        preferredProvider: "fixture",
        preferredModelAlias: "fixture",
        fallbackAllowed: false
      });
      const service = new DocumentAnswerService(library, answers, transport, chat, budget);
      const initial = await service.ask(project, owner, manifest.question, ids, "deep");
      const result = await settle(answers, project, owner, initial.id);
      expect(result.status, result.error_code ?? "").toBe("done");
      expect(result.coverage).toBeDefined();
      expect(result.coverage!.files).toHaveLength(manifest.citations.length);
      expect(result.coverage!.total_chunks).toBeGreaterThan(0);
      expect(result.coverage!.analyzed_chunks + result.coverage!.failed_chunks).toBe(
        result.coverage!.total_chunks
      );
      // The mock deliberately produces no findings: the point is honest
      // coverage and gaps, not model-authored prose (see self-check.mjs for quotes).
      expect(result.answer).toContain("не нашла сведений");
      // Honest gaps from the fixture remain described, never silently absorbed.
      expect(manifest.archives.extended.incomplete).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: "image_only_page_no_text_layer" })
        ])
      );
      expect(manifest.archives.extended.skipped).toEqual(
        expect.arrayContaining([expect.objectContaining({ reason: "unsupported_extension" })])
      );
      expect(manifest.archives.extended.nested_expanded).toHaveLength(2);
      expect(
        readFileSync(join(fixtureDir, manifest.archives.extended.file)).length
      ).toBeGreaterThan(0);
      expect(Object.keys(manifest.archives).length).toBeGreaterThan(1);
    } finally {
      db.close();
    }
  });
});
