import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { loadServerConfig } from "@cosmora/config";
import {
  EmergencyStopStore,
  PolicyStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { configuredMcpDiscovery } from "../src/mcp-discovery.js";

const origin = "https://kosmora.example";
const owner = "local-owner";
const documentUri = "fixture://workspace/report";
const documentText = "Смета: 19 700 ₽\nАртикул 00123. Кроме доставки.\n";

it("lists tools through HTTP, confines the pilot to its project, and journals one discovery across replay", async () => {
  const database = openDatabase(":memory:");
  await runMigrations(database);
  const projects = new ProjectStore(database.sqlite);
  const project = projects.createProject("MCP fixture", "mcp-fixture").project;
  const another = projects.createProject("Other project", "other-fixture").project;
  const policy = new PolicyStore(database.sqlite);
  const profile = policy.ensureProfile(project.id)!;
  const stop = new EmergencyStopStore(database.sqlite);
  const methods: string[] = [];
  let returnedUri = documentUri;
  let remoteDenied = false;

  const upstream = createServer((req, res) => {
    const data: Buffer[] = [];
    req.on("data", (chunk: Buffer) => data.push(chunk));
    req.on("end", () => {
      if (req.method === "DELETE") {
        const session = req.headers["mcp-session-id"];
        methods.push("DELETE:" + (typeof session === "string" ? session : "missing"));
        res.writeHead(204).end();
        return;
      }
      const rpc = JSON.parse(Buffer.concat(data).toString("utf8")) as {
        id?: string;
        method: string;
        params?: { uri: string };
      };
      methods.push(rpc.method);
      if (remoteDenied) {
        res.writeHead(401).end();
        return;
      }
      if (rpc.method === "initialize") {
        res.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": "fixture-session"
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: { protocolVersion: "2025-06-18", capabilities: { tools: {}, resources: {} } }
          })
        );
      } else if (
        req.headers["mcp-protocol-version"] !== "2025-06-18" ||
        req.headers["mcp-session-id"] !== "fixture-session"
      ) {
        res.writeHead(400).end();
      } else if (rpc.method === "notifications/initialized") {
        res.writeHead(202).end();
      } else if (rpc.method === "resources/read" && rpc.params?.uri === documentUri) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: { contents: [{ uri: returnedUri, text: documentText, mimeType: "text/plain" }] }
          })
        );
      } else {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          "data: " +
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: {
                tools: [{ name: "read_fixture", description: "PRIVATE_FIXTURE_TEXT" }],
                nextCursor: "fixture-cursor"
              }
            }) +
            "\n\n"
        );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  const address = upstream.address();
  if (!address || typeof address === "string") throw Error("Test MCP address unavailable");
  const pilot = configuredMcpDiscovery(
    {
      KOSMORA_MCP_URL: "https://mcp.example.org/catalog",
      KOSMORA_MCP_OWNER: owner,
      KOSMORA_MCP_PROJECT: project.id,
      KOSMORA_MCP_DOCUMENT_URI: documentUri,
      KOSMORA_MCP_DOCUMENT_NAME: "report.txt"
    },
    (_url, init) => fetch(`http://127.0.0.1:${address.port}/catalog`, init)
  )!;
  const app = buildApp({
    config: loadServerConfig({ NODE_ENV: "test", WEB_ORIGIN: origin }),
    database,
    projectStore: projects,
    policyStore: policy,
    emergencyStopStore: stop,
    mcpDiscovery: pilot
  });
  const path = `/api/v1/projects/${project.id}/integrations/mcp`;
  const discover = (id = randomUUID(), requestOrigin = origin) =>
    app.inject({
      method: "POST",
      url: path + "/discover",
      payload: { request_id: id },
      headers: { origin: requestOrigin }
    });
  const documentAction = (mode: "preview" | "save", payload: object, projectId = project.id) =>
    app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/integrations/mcp/document/${mode}`,
      payload,
      headers: { origin }
    });
  const requestId = () => ({ request_id: randomUUID() });
  try {
    expect((await app.inject({ url: path })).json()).toEqual({
      configured: true,
      stopped: false,
      document: "report.txt"
    });
    expect(
      (
        await app.inject({
          url: `/api/v1/projects/${another.id}/integrations/mcp`
        })
      ).json()
    ).toEqual({ configured: false, stopped: false });
    expect((await discover(randomUUID(), "https://other.example")).statusCode).toBe(403);
    expect((await discover()).json<{ status: string }>().status).toMatch(
      /^(WAITING_CONFIRMATION|DENIED|PAUSED)$/u
    );
    expect(
      (await documentAction("preview", requestId())).json<{ status: string }>().status
    ).toMatch(/^(WAITING_CONFIRMATION|DENIED|PAUSED)$/u);
    expect((await documentAction("preview", requestId(), another.id)).statusCode).toBe(503);
    expect(methods).toEqual([]);

    policy.updateProfile({
      projectId: project.id,
      baseLevel: "A5",
      overrides: [],
      expectedVersion: profile.version
    });
    const id = randomUUID();
    const first = await discover(id);
    expect(first.statusCode, first.body).toBe(200);
    const output = first.json<{ operation_id: string }>();
    expect(output.operation_id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(output).toEqual({
      status: "EXECUTED",
      tools: ["read_fixture"],
      hasMore: true,
      operation_id: output.operation_id
    });
    expect(policy.getOperation(project.id, `mcp:${pilot.revision}:${id}`)).toMatchObject({
      operation_id: output.operation_id,
      status: "SUCCEEDED"
    });
    expect(first.body).not.toContain("PRIVATE_FIXTURE_TEXT");
    expect((await discover(id)).json()).toEqual(first.json());
    expect(methods).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "DELETE:fixture-session"
    ]);

    expect(
      (await documentAction("save", { ...requestId(), preview_id: randomUUID() })).statusCode
    ).toBe(409);
    returnedUri = "fixture://workspace/wrong";
    expect((await documentAction("preview", requestId())).json()).toMatchObject({
      status: "RECOVERY_REQUIRED"
    });
    returnedUri = documentUri;
    const previewRequest = requestId();
    const previewResponse = await documentAction("preview", previewRequest);
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = previewResponse.json<{ preview_id: string; operation_id: string }>();
    expect(preview).toMatchObject({
      status: "EXECUTED",
      name: "report.txt",
      source: documentUri,
      text: documentText
    });
    const entry = policy.getOperation(
      project.id,
      `mcp:${pilot.revision}:preview:${previewRequest.request_id}`
    );
    expect(entry).toMatchObject({ operation_id: preview.operation_id, status: "SUCCEEDED" });
    expect(JSON.stringify(entry)).not.toContain("00123");
    const initial = projects.getMaterials(project.id, owner)!;
    expect(initial.attachments).toEqual([]);
    projects.setMaterials(project.id, owner, {
      version: initial.version,
      instructions: "Keep this instruction",
      attachments: []
    });
    expect(
      (await documentAction("save", { ...requestId(), preview_id: preview.preview_id })).json()
    ).toMatchObject({ error: { code: "MCP_MATERIALS_CHANGED" } });

    const fresh = (await documentAction("preview", requestId())).json<{ preview_id: string }>();
    const saveRequest = { ...requestId(), preview_id: fresh.preview_id };
    const calls = methods.length;
    const saved = await documentAction("save", saveRequest);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ status: "EXECUTED", version: initial.version + 2 });
    expect((await documentAction("save", saveRequest)).json()).toEqual(saved.json());
    expect(methods).toHaveLength(calls);
    const materials = projects.getMaterials(project.id, owner);
    expect(materials).toMatchObject({
      instructions: "Keep this instruction",
      attachments: [{ name: "report.txt", content: documentText }]
    });
    expect(
      policy.getOperation(project.id, `mcp:${pilot.revision}:save:${saveRequest.request_id}`)
    ).toMatchObject({ status: "SUCCEEDED", result: { version: initial.version + 2 } });

    remoteDenied = true;
    expect((await documentAction("preview", requestId())).json()).toMatchObject({
      status: "RECOVERY_REQUIRED"
    });
    expect((await documentAction("preview", previewRequest)).json()).toMatchObject({
      error: { code: "MCP_PREVIEW_EXPIRED" }
    });
    const beforeStop = methods.length;
    stop.activateProject(project.id, "fixture stop", owner, owner);
    expect((await documentAction("preview", requestId())).json()).toMatchObject({
      error: { code: "MCP_STOPPED" }
    });
    expect((await discover(id)).json()).toMatchObject({ error: { code: "MCP_STOPPED" } });
    expect(methods).toHaveLength(beforeStop);
    expect(projects.getMaterials(project.id, owner)).toEqual(materials);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    database.close();
  }
});

it.each([
  "http://mcp.example.org",
  "https://127.0.0.1",
  "https://name.local",
  "https://mcp.example.org/?target=x"
])("keeps unsupported endpoint configuration disabled: %s", (url) => {
  expect(
    configuredMcpDiscovery({
      KOSMORA_MCP_URL: url,
      KOSMORA_MCP_OWNER: "owner",
      KOSMORA_MCP_PROJECT: "project"
    })
  ).toBeUndefined();
});
