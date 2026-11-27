import Fastify from "fastify";
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import { openDatabase } from "@cosmora/db";
import { registerDocumentWorkspaceRoutes } from "../src/document-workspace-routes.js";
import { buildApp } from "../src/app.js";
const require = createRequire(import.meta.url);
const { buildOfficeDocument } =
  require("../../../desktop/windows/workspace/office-document.cjs") as {
    buildOfficeDocument: (action: unknown) => { buffer: Buffer };
  };
const { zip } = require("../../../desktop/windows/workspace/office-document.cjs") as {
  zip: (entries: [string, Buffer][]) => Buffer;
};
const { unpack, extractOfficeText } =
  require("../../../desktop/windows/workspace/office-text.cjs") as {
    unpack: (bytes: Buffer, limit: number) => { entries: Map<string, Buffer> };
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
function docxWithTable() {
  const source = buildOfficeDocument({
    kind: "workspace_create_docx",
    path: "offer.docx",
    title: "Предложение",
    sections: [{ heading: "", text: "Компания А; 00123; 19 700" }]
  }).buffer;
  const { entries } = unpack(source, 16000000);
  const doc = entries.get("word/document.xml")!.toString();
  entries.set(
    "word/document.xml",
    Buffer.from(
      doc.replace(
        "<w:sectPr>",
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Старая цена</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>00123</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr>"
      )
    )
  );
  return zip([...entries]);
}

it("replaces a whole DOCX table cell and preserves untouched cells and styles", async () => {
  const name = "table.docx";
  const bytes = docxWithTable().toString("base64");
  const call = (mode: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/api/v1/document-workspace/${mode}`, payload });
  const opened = await call("inspect", { name, bytes });
  expect(opened.statusCode, opened.body).toBe(200);
  const view = opened.json<{ targets: Array<{ id: string }> }>();
  expect(view.targets.map((t) => t.id)).toContain("table:1/row:1/cell:1");
  const input = {
    name,
    bytes,
    expected_version: opened.json<{ version: string }>().version,
    operations: [{ kind: "set_docx_cell", target: "table:1/row:1/cell:1", value: "Новая цена" }]
  };
  const preview = await call("preview", input);
  expect(preview.statusCode, preview.body).toBe(200);
  const token = preview.json<{ expires: number; preview_token: string; version: string }>();
  const saved = await call("commit", {
    ...input,
    expires: token.expires,
    preview_token: token.preview_token
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const result = saved.json<{ bytes: string; version: string; readback: { version: string } }>();
  expect(result.version).toBe(token.version);
  expect(result.readback.version).toBe(result.version);
  const output = Buffer.from(result.bytes, "base64");
  const text = extractOfficeText(name, output).text;
  expect(text).toContain("Новая цена");
  expect(text).toContain("00123"); // neighbour cell survives
  expect(text).not.toContain("Старая цена");
  const after = unpack(output, 16000000).entries;
  const doc = after.get("word/document.xml")!.toString();
  expect(doc).toContain("<w:rPr><w:b/></w:rPr>"); // style preserved
});
