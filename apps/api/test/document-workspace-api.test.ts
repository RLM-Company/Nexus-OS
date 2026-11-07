import { createRequire } from "node:module";
import { afterEach, expect, it } from "vitest";
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
const database = openDatabase(":memory:");
const app = buildApp({
  database,
  config: loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" })
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
