import Fastify from "fastify";
import { registerDocumentWorkspaceRoutes } from "../src/document-workspace-routes.js";
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import { openDatabase } from "@cosmora/db";
import { buildApp } from "../src/app.js";
const require = createRequire(import.meta.url);
const { buildOfficeDocument } =
  require("../../../desktop/windows/workspace/office-document.cjs") as {
    buildOfficeDocument: (action: unknown) => { buffer: Buffer };
  };
const { extractOfficeText } = require("../../../desktop/windows/workspace/office-text.cjs") as {
  extractOfficeText: (name: string, bytes: Buffer) => { text: string };
};
let database: ReturnType<typeof openDatabase>;
let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  database = openDatabase(":memory:");
  app = buildApp({
    database,
    config: loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" })
  });
});
afterEach(async () => {
  await app.close();
  database.close();
});
it("exports a real verified copy only for a matching preview, original bytes/version and operations", async () => {
  const name = "offer.docx";
  const bytes = buildOfficeDocument({
    kind: "workspace_create_docx",
    path: name,
    title: "Предложение",
    sections: [{ heading: "", text: "Компания А; 19 700; 00123; 07.11.2026; кроме доставки" }]
  }).buffer.toString("base64");
  const call = (mode: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/api/v1/document-workspace/${mode}`, payload });
  const opened = await call("inspect", { name, bytes });
  expect(opened.statusCode, opened.body).toBe(200);
  const source = opened.json<{ version: string }>();
  const input = {
    name,
    bytes,
    expected_version: source.version,
    operations: [
      { kind: "replace_text", target: "paragraph:2", find: "Компания А", replace: "Компания Б" }
    ]
  };
  const preview = await call("preview", input);
  expect(preview.statusCode, preview.body).toBe(200);
  const token = preview.json<{ expires: number; preview_token: string; version: string }>();
  const confirmation = { ...input, expires: token.expires, preview_token: token.preview_token };
  const modified = await call("commit", {
    ...confirmation,
    operations: [{ ...input.operations[0], replace: "Подмена" }]
  });
  expect(modified.statusCode).toBe(409);
  const stale = await call("commit", {
    ...confirmation,
    expected_version: "sha256:" + "0".repeat(64)
  });
  expect(stale.statusCode).toBe(409);
  const expired = await call("commit", { ...confirmation, expires: 1 });
  expect(expired.statusCode).toBe(409);
  const saved = await call("commit", confirmation);
  expect(saved.statusCode, saved.body).toBe(200);
  const result = saved.json<{ bytes: string; version: string; readback: { version: string } }>();
  expect(result.version).toBe(token.version);
  expect(result.readback.version).toBe(result.version);
  const text = extractOfficeText(name, Buffer.from(result.bytes, "base64")).text;
  for (const v of ["Компания Б", "19 700", "00123", "07.11.2026", "кроме доставки"])
    expect(text).toContain(v);
  expect(extractOfficeText(name, Buffer.from(bytes, "base64")).text).toContain("Компания А");
  const extra = await call("inspect", { name, bytes, absolutePath: "/etc/passwd" });
  expect(extra.statusCode).toBe(400);
  const invalid = await call("inspect", { name, bytes: "AAAA" });
  expect(invalid.statusCode).toBe(422);
});

it.each(["DOCX", "XLSX", "PPTX"])(
  "opens, edits and verifies an uppercase %s file name",
  async (format) => {
    const name = "OFFER." + format;
    const action =
      format === "DOCX"
        ? {
            kind: "workspace_create_docx",
            path: "offer.docx",
            title: "Offer",
            sections: [{ heading: "", text: "Company A; 00123; 19 700; except delivery" }]
          }
        : format === "XLSX"
          ? {
              kind: "workspace_create_xlsx",
              path: "offer.xlsx",
              sheets: [{ name: "Data", rows: [["00123", 19700]] }]
            }
          : {
              kind: "workspace_create_pptx",
              path: "offer.pptx",
              title: "Offer",
              slides: [{ title: "Company A", text: "00123; 19 700; except delivery" }]
            };
    const bytes = buildOfficeDocument(action).buffer.toString("base64");
    const operations =
      format === "XLSX"
        ? [{ kind: "set_cell", target: "sheet:1", address: "B2", value: { formula: "SUM(B1:B1)" } }]
        : [
            {
              kind: "replace_text",
              target: format === "DOCX" ? "paragraph:2" : "slide:1/shape:2",
              find: "Company A",
              replace: "Company B"
            }
          ];
    const call = (mode: string, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/api/v1/document-workspace/${mode}`, payload });
    const opened = await call("inspect", { name, bytes });
    expect(opened.statusCode, opened.body).toBe(200);
    const input = {
      name,
      bytes,
      expected_version: opened.json<{ version: string }>().version,
      operations
    };
    const preview = await call("preview", input);
    expect(preview.statusCode, preview.body).toBe(200);
    const { expires, preview_token, version } = preview.json<{
      expires: number;
      preview_token: string;
      version: string;
    }>();
    const saved = await call("commit", { ...input, expires, preview_token });
    expect(saved.statusCode, saved.body).toBe(200);
    const result = saved.json<{ bytes: string; readback: { version: string } }>();
    expect(result.readback.version).toBe(version);
    const readback = extractOfficeText(name, Buffer.from(result.bytes, "base64")).text;
    expect(readback).toContain("00123");
    expect(readback).toContain(format === "XLSX" ? '"cached_value":null' : "Company B");
  }
);

it("pages an uploaded source by exact version and rejects a missing or stale version", async () => {
  const { pagedWord } =
    require("../../../desktop/windows/test/fixtures/office-paged-brief.cjs") as {
      pagedWord: () => { buffer: Buffer; texts: string[] };
    };
  const source = pagedWord(),
    name = "brief.docx",
    bytes = source.buffer.toString("base64");
  const call = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/document-workspace/inspect", payload });
  const first = await call({ name, bytes });
  expect(first.statusCode, first.body).toBe(200);
  const initial = first.json<{
    version: string;
    next_cursor: { target_offset: number; content_offset: number };
  }>();
  const without = await call({ name, bytes, cursor: initial.next_cursor });
  expect(without.statusCode).toBe(409);
  const wrong = await call({
    name,
    bytes,
    cursor: initial.next_cursor,
    expected_version: "sha256:" + "0".repeat(64)
  });
  expect(wrong.statusCode).toBe(409);
  const next = await call({
    name,
    bytes,
    cursor: initial.next_cursor,
    expected_version: initial.version
  });
  expect(next.statusCode, next.body).toBe(200);
  const result = next.json<{ cursor: unknown; version: string }>();
  expect(result.cursor).toEqual(initial.next_cursor);
  expect(result.version).toBe(initial.version);
  expect(Buffer.byteLength(next.body)).toBeLessThanOrEqual(10000);
});

it("binds the web preview token to the owner supplied by the existing identity boundary", async () => {
  const isolated = Fastify(),
    now = new Date().toISOString(),
    later = new Date(Date.now() + 60000).toISOString();
  registerDocumentWorkspaceRoutes(isolated, (request) => {
    const owner =
      typeof request.headers["x-fixture-owner"] === "string"
        ? request.headers["x-fixture-owner"]
        : "fixture-a";
    return {
      owner_id: owner,
      actor_id: owner,
      actor_kind: "owner",
      session_id: owner + "-session",
      assurance: "local",
      authenticated_at: now,
      expires_at: later
    };
  });
  try {
    const name = "owner.docx",
      bytes = buildOfficeDocument({
        kind: "workspace_create_docx",
        path: name,
        title: "Offer",
        sections: [{ heading: "", text: "Company A" }]
      }).buffer.toString("base64");
    const call = (mode: string, owner: string, payload: Record<string, unknown>) =>
      isolated.inject({
        method: "POST",
        url: `/api/v1/document-workspace/${mode}`,
        headers: { "x-fixture-owner": owner },
        payload
      });
    const opened = await call("inspect", "fixture-a", { name, bytes });
    const input = {
      name,
      bytes,
      expected_version: opened.json<{ version: string }>().version,
      operations: [
        { kind: "replace_text", target: "paragraph:2", find: "Company A", replace: "Company B" }
      ]
    };
    const preview = await call("preview", "fixture-a", input);
    expect(preview.statusCode).toBe(200);
    const token = preview.json<{ expires: number; preview_token: string }>(),
      body = { ...input, expires: token.expires, preview_token: token.preview_token };
    expect((await call("commit", "fixture-b", body)).statusCode).toBe(409);
    expect((await call("commit", "fixture-a", body)).statusCode).toBe(200);
  } finally {
    await isolated.close();
  }
});
