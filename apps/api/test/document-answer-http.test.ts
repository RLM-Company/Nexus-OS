/* eslint-disable @typescript-eslint/require-await -- Deterministic fixtures implement asynchronous provider interfaces without artificial scheduling. */
import { describe, it, expect } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  DocumentLibraryStore,
  DocumentAnswerStore
} from "@cosmora/db";
import type { ModelRequest } from "@cosmora/contracts";
import { ChatService } from "@cosmora/core";
import { buildApp } from "../src/app.js";
import {
  DocumentAnswerService,
  type DocumentAnswerOwnerBudget,
  type DocumentAnswerTransport
} from "../src/document-answer-service.js";

const route = {
  attempt: 0,
  registry_version: "fixture",
  provider_id: "fixture",
  model_id: "fixture",
  estimated_input_tokens: 200,
  max_output_tokens: 300,
  estimated_cost: null
};
describe("real authenticated HTTP document answer flow (fixture transport, zero paid calls)", () => {
  it("uploads,indexes,answers,persists and reads saved answer; holds ledger on uncertain error", async () => {
    const db = openDatabase(":memory:");
    let app: ReturnType<typeof buildApp> | undefined;
    try {
      await runMigrations(db);
      const projectStore = new ProjectStore(db.sqlite);
      const project = projectStore.createProject("Document QA", "qa-http-doc").project.id;
      const library = new DocumentLibraryStore(db.sqlite);
      const answers = new DocumentAnswerStore(db.sqlite);
      const records: number[] = [];
      const requests: string[] = [];
      const budget: DocumentAnswerOwnerBudget = {
        reserve: (_owner, _id, attempt) => {
          records.push(attempt.attempt);
          return true;
        },
        reconcile: () => undefined,
        uncertain: () => {
          throw new Error("Unexpected uncertain attempt");
        }
      };
      const gateway = {
        assertRoute: () => undefined,
        async *stream(request: ModelRequest) {
          const input = request.messages.at(-1)!.content;
          requests.push(input);
          yield { type: "route.selected" as const, route };
          const delta = input.includes("Ошибка обработки")
            ? "«Придуманная цитата» [S999]"
            : input.includes("«Маркер без совпадения» [S2]")
              ? "«Конец договора в октябре 2027» [S1]\n«Маркер без совпадения» [S2]"
              : input.includes("Маркер без совпадения")
                ? "«Маркер без совпадения» [S2]"
                : "Документ говорит: «Конец договора в октябре 2027» [S1]";
          yield { type: "text.delta" as const, delta };
          yield {
            type: "response.completed" as const,
            provider: "fixture",
            model: "fixture",
            finishReason: "stop",
            usage: { inputTokens: 210, outputTokens: 20 },
            route,
            calculatedCost: null
          };
        }
      } as DocumentAnswerTransport;
      const chat = new ChatService({
        preferredProvider: "fixture",
        preferredModelAlias: "fixture",
        fallbackAllowed: false
      });
      const service = new DocumentAnswerService(library, answers, gateway, chat, budget);
      app = buildApp({
        config: loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" }),
        database: db,
        projectStore,
        documentLibrary: library,
        documentAnswerService: service
      });
      const url = `/api/v1/projects/${project}/document-library`;
      const raw = Buffer.from("Конец договора в октябре 2027");
      const staged = await app.inject({
        method: "POST",
        url,
        headers: {
          "content-type": "application/octet-stream",
          "x-kosmora-file-name": "contract.txt"
        },
        payload: raw
      });
      expect(staged.statusCode).toBe(201);
      const id = staged.json<{ id: string }>().id;
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `${url}/${id}/index`,
            payload: { pages: [{ page: null, text: raw.toString() }] }
          })
        ).statusCode
      ).toBe(200);
      const created = await app.inject({
        method: "POST",
        url: `${url}/answers`,
        payload: { question: "Когда конец договора?", file_ids: [id] }
      });
      expect(created.statusCode).toBe(202);
      const answerId = created.json<{ id: string }>().id;
      let saved = answers.get(project, "local-owner", answerId)!;
      for (let tries = 0; tries < 30 && ["running", "queued"].includes(saved.status); tries++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        saved = answers.get(project, "local-owner", answerId)!;
      }
      expect(saved.status, saved.error_code ?? "").toBe("done");
      expect(saved.answer).toContain("contract.txt, строки 1–1");
      expect(records).toEqual([0]);
      const retrieved = await app.inject({ method: "GET", url: `${url}/answers/${answerId}` });
      expect(retrieved.statusCode).toBe(200);
      expect(retrieved.json<{ status: string }>().status).toBe("done");
      const pdf = library.stage(
        project,
        "local-owner",
        "appendix.pdf",
        Buffer.from("%PDF-1.4\nfixture")
      );
      const pdfPages = [
        { page: 1, text: "" },
        { page: 2, text: "Маркер без совпадения" }
      ];
      const failed = library.stage(
        project,
        "local-owner",
        "notes.txt",
        Buffer.from("Ошибка обработки")
      );
      const failedPages = [{ page: null, text: "Ошибка обработки" }];
      expect(
        (
          await app.inject({
            method: "PUT",
            url: url + "/" + pdf.id + "/index",
            payload: { pages: pdfPages }
          })
        ).statusCode
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "PUT",
            url: url + "/" + failed.id + "/index",
            payload: { pages: failedPages }
          })
        ).statusCode
      ).toBe(200);
      records.length = 0;
      requests.length = 0;
      const deep = await app.inject({
        method: "POST",
        url: url + "/answers",
        payload: {
          mode: "deep",
          question: "Когда конец договора?",
          file_ids: [id, pdf.id, failed.id]
        }
      });
      expect(deep.statusCode).toBe(202);
      const deepId = deep.json<{ id: string }>().id;
      await expect.poll(() => answers.get(project, "local-owner", deepId)?.status).toBe("done");
      const report = answers.get(project, "local-owner", deepId)!;
      expect(report.coverage).toMatchObject({
        phase: "complete",
        total_chunks: 3,
        analyzed_chunks: 2,
        failed_chunks: 1,
        files: [
          { name: "contract.txt", analyzed_chunks: 1 },
          { name: "appendix.pdf", analyzed_chunks: 1, indexed_pages: 1, total_pages: 2 },
          { name: "notes.txt", analyzed_chunks: 0, failed_chunks: 1 }
        ]
      });
      expect(report.answer).toContain("appendix.pdf, стр. 2");
      expect(records.sort((a, b) => a - b)).toEqual([0, 2, 4, 6]);
      expect(requests).toHaveLength(4);
      expect(requests[3]).toContain("Конец договора в октябре 2027");
      expect(requests[3]).toContain("Маркер без совпадения");
      expect(requests[3]).not.toContain("Придуманная цитата");
      const deleted = await app.inject({ method: "DELETE", url: `${url}/${id}` });
      expect(deleted.statusCode).toBe(204);
      expect(saved.sources[0]?.content).toContain("2027"); // immutable evidence snapshot retained in answer
    } finally {
      await app?.close();
      db.close();
    }
  });
});
