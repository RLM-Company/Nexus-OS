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
            result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } }
          })
        );
      } else if (
        req.headers["mcp-protocol-version"] !== "2025-06-18" ||
        req.headers["mcp-session-id"] !== "fixture-session"
      ) {
        res.writeHead(400).end();
      } else if (rpc.method === "notifications/initialized") {
        res.writeHead(202).end();
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
      KOSMORA_MCP_PROJECT: project.id
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
  try {
    expect((await app.inject({ url: path })).json()).toEqual({ configured: true, stopped: false });
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

    remoteDenied = true;
    expect((await discover()).json()).toMatchObject({ status: "RECOVERY_REQUIRED" });
    expect(methods.at(-1)).toBe("initialize");
    stop.activateProject(project.id, "fixture stop", owner, owner);
    expect((await discover(id)).json()).toMatchObject({ error: { code: "MCP_STOPPED" } });
    expect(methods).toHaveLength(5);
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
