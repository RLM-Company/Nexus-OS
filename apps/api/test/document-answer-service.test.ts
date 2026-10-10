/* eslint-disable @typescript-eslint/require-await -- Deterministic fixtures implement asynchronous provider interfaces without artificial scheduling. */
import { describe, it, expect } from "vitest";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  DocumentLibraryStore,
  DocumentAnswerStore
} from "@cosmora/db";
import { chunkLibraryPages, ChatService } from "@cosmora/core";
import {
  DocumentAnswerService,
  validateDocumentAnswer,
  type DocumentAnswerOwnerBudget,
  type DocumentAnswerTransport
} from "../src/document-answer-service.js";
import { createDocumentLibraryPrivacyAdapter } from "../src/document-library-privacy-adapter.js";

const route = {
  attempt: 0,
  registry_version: "fixture",
  provider_id: "fixture",
  model_id: "fixture",
  estimated_input_tokens: 200,
  max_output_tokens: 300,
  estimated_cost: null
};
const chat = new ChatService({
  preferredProvider: "fixture",
  preferredModelAlias: "fixture",
  fallbackAllowed: false
});
const settle = async (store: DocumentAnswerStore, project: string, owner: string, id: string) => {
  for (let i = 0; i < 50; i++) {
    const result = store.get(project, owner, id)!;
    if (!["queued", "running"].includes(result.status)) return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("fixture never settled");
};
const sources = [
  {
    ref: "S1",
    chunk_id: 1,
    file_id: "f",
    name: "test.pdf",
    page: 3,
    line_start: 1,
    line_end: 2,
    content: "Бюджет проекта — 2027. Дата сдачи 12 октября."
  }
];
describe("document answers canonical gateway accounting contract", () => {
  it("checks citations strictly and distinguishes unsupported interpretations", () => {
    const valid = validateDocumentAnswer("Бюджет: «Бюджет проекта — 2027» [S1]", sources);
    expect(valid.verifiedQuotes).toBe(1);
    expect(valid.answer).toContain("test.pdf, стр. 3, строки 1–2");
    expect(() => validateDocumentAnswer("Факт: «Бюджет проекта — 2099» [S1]", sources)).toThrow();
    expect(() => validateDocumentAnswer("«Бюджет проекта — 2027» [S99]", sources)).toThrow();
    expect(
      validateDocumentAnswer("«Бюджет проекта — 2027» [S1]\nВнеисточниковое мнение", sources)
        .unverifiedLines
    ).toBe(1);
  });
  it("persists real answer and original manifest, reconciles fixture usage, fences cancellation", async () => {
    const db = openDatabase(":memory:");
    try {
      await runMigrations(db);
      const owner = "owner-a",
        project = new ProjectStore(db.sqlite).createProject("Проект", "doc-qa-proj", owner).project
          .id;
      const library = new DocumentLibraryStore(db.sqlite);
      const doc = library.stage(
        project,
        owner,
        "fact.txt",
        Buffer.from("Бюджет проекта — 2027. Дата сдачи 12 октября.")
      );
      const pages = [{ page: null, text: "Бюджет проекта — 2027. Дата сдачи 12 октября." }];
      library.complete(project, owner, doc.id, pages, chunkLibraryPages(pages));
      const store = new DocumentAnswerStore(db.sqlite);
      const events: string[] = [];
      const budget: DocumentAnswerOwnerBudget = {
        reserve: () => {
          events.push("reserve");
          return true;
        },
        reconcile: (_owner, _id, e) => {
          events.push(`reconcile:${e.usage.inputTokens}`);
        },
        uncertain: () => {
          events.push("uncertain");
        }
      };
      const gateway = {
        assertRoute: () => undefined,
        async *stream(_request: unknown, signal: AbortSignal) {
          yield { type: "route.selected" as const, route };
          if (signal.aborted) throw Error("cancelled");
          yield {
            type: "text.delta" as const,
            delta: "Согласно документу «Бюджет проекта — 2027» [S1]"
          };
          yield {
            type: "response.completed" as const,
            provider: "fixture",
            model: "fixture",
            finishReason: "stop",
            usage: { inputTokens: 200, outputTokens: 50 },
            route,
            calculatedCost: null
          };
        }
      } as DocumentAnswerTransport;
      const service = new DocumentAnswerService(library, store, gateway, chat, budget);
      const initial = await service.ask(project, owner, "Какой бюджет проекта?", [doc.id]);
      const result = await settle(store, project, owner, initial.id);
      expect(result.status).toBe("done");
      expect(result.answer).toContain("fact.txt, строки 1–1");
      expect(events).toEqual(["reserve", "reconcile:200"]);
      expect(new DocumentAnswerStore(db.sqlite).get(project, owner, initial.id)?.status).toBe(
        "done"
      );
      const privacy = createDocumentLibraryPrivacyAdapter(service, store);
      await privacy.quiesce(owner);
      const exported = privacy.export(owner);
      expect(exported.manifest).toHaveLength(1);
      expect(exported.manifest[0]?.authenticated_url).toContain(doc.id);
      expect(exported.manifest[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(exported.answers).toHaveLength(1);
      expect(privacy.delete(owner)).toEqual({ originals: 1, answers: 1 });
      expect(library.list(project, owner)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
  it("does not duplicate file bytes on retry; interrupted results never auto-dispatch", async () => {
    const db = openDatabase(":memory:");
    try {
      await runMigrations(db);
      const project = new ProjectStore(db.sqlite).createProject("A", "doc-qa-retry").project.id;
      const library = new DocumentLibraryStore(db.sqlite);
      const file = library.stage(project, "local-owner", "source.txt", Buffer.from("data"));
      library.fail(project, "local-owner", file.id);
      const retried = library.retry(project, "local-owner", file.id);
      expect(retried.id).toBe(file.id);
      expect(library.list(project, "local-owner")).toHaveLength(1);
      expect(library.original(project, "local-owner", file.id)?.bytes).toEqual(Buffer.from("data"));
      const store = new DocumentAnswerStore(db.sqlite);
      expect(store.recoverInterrupted()).toBe(0);
    } finally {
      db.close();
    }
  });
});
