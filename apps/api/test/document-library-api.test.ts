import { loadServerConfig } from "@cosmora/config";
import { DocumentLibraryStore, ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("document library API, owner-only document flow", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let database: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof buildApp>;
  let path: string;
  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    const projects = new ProjectStore(database.sqlite);
    path = `/api/v1/projects/${projects.createProject("Документы", "document-library-api-project").project.id}/document-library`;
    app = buildApp({
      config,
      database,
      projectStore: projects,
      documentLibrary: new DocumentLibraryStore(database.sqlite)
    });
  });
  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("uploads a real byte buffer, indexes lines, searches it and downloads the original", async () => {
    const bytes = Buffer.from("Контракт\nОкончание договора: март 2027", "utf8");
    const staged = await app.inject({
      method: "POST",
      url: path,
      headers: {
        "content-type": "application/octet-stream",
        "x-kosmora-file-name": encodeURIComponent("контракт.txt")
      },
      payload: bytes
    });
    expect(staged.statusCode, staged.body).toBe(201);
    const file = staged.json<{ id: string }>();
    const indexed = await app.inject({
      method: "PUT",
      url: `${path}/${file.id}/index`,
      payload: { pages: [{ page: null, text: bytes.toString("utf8") }] }
    });
    expect(indexed.statusCode, indexed.body).toBe(200);
    const found = await app.inject({
      method: "POST",
      url: `${path}/search`,
      payload: { question: "окончание договора", file_ids: [] }
    });
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json<{ hits: Array<{ citation: string }> }>().hits[0]?.citation).toContain(
      "контракт.txt, строки 1–2"
    );
    const download = await app.inject({ method: "GET", url: `${path}/${file.id}/download` });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(bytes);
    const deleted = await app.inject({ method: "DELETE", url: `${path}/${file.id}` });
    expect(deleted.statusCode).toBe(204);
    expect(
      (await app.inject({ method: "GET", url: `${path}/${file.id}/download` })).statusCode
    ).toBe(404);
  });

  it("rejects invalid formats and unknown projects", async () => {
    const bad = await app.inject({
      method: "POST",
      url: path,
      headers: { "content-type": "application/octet-stream", "x-kosmora-file-name": "x.exe" },
      payload: Buffer.from("unsafe")
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/projects/unknown/document-library" }))
        .statusCode
    ).toBe(404);
  });

  it("indexes PDFs with blank pages while preserving the original citation page", async () => {
    const staged = await app.inject({
      method: "POST",
      url: path,
      headers: { "content-type": "application/octet-stream", "x-kosmora-file-name": "report.pdf" },
      payload: Buffer.from("%PDF-1.4\nfixture")
    });
    const file = staged.json<{ id: string }>();
    expect(staged.statusCode).toBe(201);
    const indexed = await app.inject({
      method: "PUT",
      url: `${path}/${file.id}/index`,
      payload: {
        pages: [
          { page: 1, text: "" },
          { page: 2, text: "" },
          { page: 3, text: "Факт: бюджет 2027" }
        ]
      }
    });
    expect(indexed.statusCode, indexed.body).toBe(200);
    const found = await app.inject({
      method: "POST",
      url: `${path}/search`,
      payload: { question: "бюджет", file_ids: [] }
    });
    expect(found.json<{ hits: Array<{ citation: string }> }>().hits[0]?.citation).toContain(
      "report.pdf, стр. 3"
    );
  });
});
