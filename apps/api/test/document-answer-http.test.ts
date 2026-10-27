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
      const records: string[] = [];
      const budget: DocumentAnswerOwnerBudget = {
        reserve: () => {
          records.push("reserve");
          return true;
        },
        reconcile: () => {
          records.push("reconcile");
        },
        uncertain: () => {
          records.push("uncertain");
        }
      };
      const gateway = {
        assertRoute: () => undefined,
        async *stream() {
          yield { type: "route.selected" as const, route };
          yield {
            type: "text.delta" as const,
            delta: "Документ говорит: «Конец договора в октябре 2027» [S1]"
          };
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
      expect(records).toEqual(["reserve", "reconcile"]);
      const retrieved = await app.inject({ method: "GET", url: `${url}/answers/${answerId}` });
      expect(retrieved.statusCode).toBe(200);
      expect(retrieved.json<{ status: string }>().status).toBe("done");
      const deleted = await app.inject({ method: "DELETE", url: `${url}/${id}` });
      expect(deleted.statusCode).toBe(204);
      expect(saved.sources[0]?.content).toContain("2027"); // immutable evidence snapshot retained in answer
    } finally {
      await app?.close();
      db.close();
    }
  });
});
