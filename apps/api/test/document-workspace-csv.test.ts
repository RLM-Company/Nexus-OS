import Fastify from "fastify";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import { openDatabase } from "@cosmora/db";
import { registerDocumentWorkspaceRoutes } from "../src/document-workspace-routes.js";
import { buildApp } from "../src/app.js";
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
const csvSource =
  [
    "id,title,amount,note",
    '"00123","Company, A",19700,"кроме доставки"',
    "002,Ünïcode,19800,"
  ].join("\r\n") + "\n";

it("runs the full CSV chain: inspect → preview → commit → independent readback", async () => {
  const name = "prices.csv";
  const bytes = Buffer.from(csvSource, "utf8").toString("base64");
  const call = (mode: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/api/v1/document-workspace/${mode}`, payload });
  const opened = await call("inspect", { name, bytes });
  expect(opened.statusCode, opened.body).toBe(200);
  const source = opened.json<{
    version: string;
    representation: { kind: string };
    targets: unknown[];
  }>();
  expect(source.representation.kind).toBe("office_csv");
  const input = {
    name,
    bytes,
    expected_version: source.version,
    operations: [
      { kind: "set_cell", target: "table:1", address: "A2", value: "00456" },
      { kind: "set_cell", target: "table:1", address: "C3", value: { formula: "SUM(C1:C2)" } }
    ]
  };
  const preview = await call("preview", input);
  expect(preview.statusCode, preview.body).toBe(200);
  const token = preview.json<{
    expires: number;
    preview_token: string;
    version: string;
    diff: unknown[];
  }>();
  expect(token.diff).toHaveLength(2);
  const saved = await call("commit", {
    ...input,
    expires: token.expires,
    preview_token: token.preview_token
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const result = saved.json<{
    bytes: string;
    version: string;
    sha256: string;
    source_version: string;
    readback: { version: string };
  }>();
  expect(result.version).toBe(token.version);
  expect(result.readback.version).toBe(result.version);
  const output = Buffer.from(result.bytes, "base64").toString("utf8");
  expect(output).toContain("00456");
  expect(output).toContain("=SUM(C1:C2)");
  // Untouched cells survive.
  expect(output).toContain('"Company, A"');
  expect(output).toContain("кроме доставки");
  expect(output).toContain("Ünïcode");
  // Re-open with an independent reader path (engine inspect on exported bytes).
  const reopened = await call("inspect", { name, bytes: result.bytes });
  expect(reopened.statusCode, reopened.body).toBe(200);
  expect(reopened.json<{ version: string }>().version).toBe(result.version);
});

it("keeps a value containing the file's own separator as one cell through the full API chain", async () => {
  const name = "semicolon.csv";
  const source = ["id;title;amount", "00123;Old;19700", "002;Other;19800"].join("\n") + "\n";
  const bytes = Buffer.from(source, "utf8").toString("base64");
  const call = (mode: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/api/v1/document-workspace/${mode}`, payload });
  const opened = await call("inspect", { name, bytes });
  expect(opened.statusCode, opened.body).toBe(200);
  const input = {
    name,
    bytes,
    expected_version: opened.json<{ version: string }>().version,
    operations: [{ kind: "set_cell", target: "table:1", address: "B2", value: "Company; A" }]
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
  expect(result.readback.version).toBe(result.version);
  const output = Buffer.from(result.bytes, "base64").toString("utf8");
  expect(output).toContain('"Company; A"');
  const reopened = await call("inspect", { name, bytes: result.bytes });
  expect(reopened.statusCode, reopened.body).toBe(200);
  const cells = reopened.json<{
    targets: Array<{ cells: Array<{ address: string; text: string }> }>;
  }>().targets[0]!.cells;
  expect(cells.find((c) => c.address === "B2")?.text).toBe("Company; A");
  expect(cells.find((c) => c.address === "C2")?.text).toBe("19700");
  expect(cells.find((c) => c.address === "A3")?.text).toBe("002");
});

it("commit is idempotent on a lost response: the same token replays identical bytes", async () => {
  const name = "retry.csv";
  const bytes = Buffer.from(csvSource, "utf8").toString("base64");
  const call = (mode: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/api/v1/document-workspace/${mode}`, payload });
  const opened = await call("inspect", { name, bytes });
  const input = {
    name,
    bytes,
    expected_version: opened.json<{ version: string }>().version,
    operations: [{ kind: "set_cell", target: "table:1", address: "A2", value: "00456" }]
  };
  const preview = await call("preview", input);
  const token = preview.json<{ expires: number; preview_token: string; version: string }>();
  const confirmation = { ...input, expires: token.expires, preview_token: token.preview_token };
  const first = await call("commit", confirmation);
  const replay = await call("commit", confirmation); // response lost after first commit
  expect(first.statusCode).toBe(200);
  expect(replay.statusCode, replay.body).toBe(200);
  expect(first.json<{ bytes: string; version: string }>()).toEqual(
    replay.json<{ bytes: string; version: string }>()
  );
});

it("rejects CSV formula injection and owner mismatch on commit", async () => {
  const isolated = Fastify();
  registerDocumentWorkspaceRoutes(isolated, (request) => ({
    owner_id:
      typeof request.headers["x-fixture-owner"] === "string"
        ? request.headers["x-fixture-owner"]
        : "a",
    actor_id: "a",
    actor_kind: "owner",
    session_id: "a",
    assurance: "local",
    authenticated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString()
  }));
  try {
    const name = "inject.csv";
    const bytes = Buffer.from(csvSource, "utf8").toString("base64");
    const call = (mode: string, owner: string, payload: Record<string, unknown>) =>
      isolated.inject({
        method: "POST",
        url: `/api/v1/document-workspace/${mode}`,
        headers: { "x-fixture-owner": owner },
        payload
      });
    const opened = await call("inspect", "a", { name, bytes });
    const input = {
      name,
      bytes,
      expected_version: opened.json<{ version: string }>().version,
      operations: [
        {
          kind: "set_cell",
          target: "table:1",
          address: "A2",
          value: { formula: 'WEBSERVICE("https://x")' }
        }
      ]
    };
    expect((await call("preview", "a", input)).statusCode).toBe(422);
    const valid = {
      ...input,
      operations: [{ kind: "set_cell", target: "table:1", address: "A2", value: "ok" }]
    };
    const preview = await call("preview", "a", valid);
    expect(preview.statusCode).toBe(200);
    const token = preview.json<{ expires: number; preview_token: string }>();
    const confirmation = { ...valid, expires: token.expires, preview_token: token.preview_token };
    expect((await call("commit", "b", confirmation)).statusCode).toBe(409);
    expect((await call("commit", "a", confirmation)).statusCode).toBe(200);
  } finally {
    await isolated.close();
  }
});
