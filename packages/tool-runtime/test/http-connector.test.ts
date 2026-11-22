import { PolicyStore, ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import type { ConnectorDescriptor } from "@cosmora/contracts";
import {
  ConnectorRegistry,
  GuardedToolRuntime,
  createHttpConnectorTransport,
  mcpToolCall,
  connectorToolId,
  type HttpFetch
} from "../src/index.js";

const NOW = "2026-08-24T12:00:00.000Z";

/** Descriptor for a compatible HTTP/MCP-style connector. No credentials. */
const descriptor: ConnectorDescriptor = {
  id: "http-api",
  version: 1,
  app: "Compatible HTTP API",
  implementation: "packages/tool-runtime/src/http-connector.ts",
  auth_kind: "server.token",
  state: "not_connected",
  operations: [
    {
      id: "call",
      kind: "read",
      summary: "Call an allowlisted HTTP endpoint owned by the integration.",
      capability_ids: ["integration.private.use", "context.project.read"],
      result_checks: ["bytes.sha256"]
    }
  ]
};

const emptyFetch: HttpFetch = () =>
  Promise.resolve({ status: 200, text: () => Promise.resolve("") });

describe("HTTP/MCP-compatible connector transport", () => {
  it("validates base URL, path allowlist, method and strips credential headers", async () => {
    expect(() =>
      createHttpConnectorTransport({ baseUrl: "file:///etc", fetchImpl: emptyFetch })
    ).toThrow("INVALID_CONNECTOR_BASE_URL");
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string> } }> =
      [];
    const fetchImpl: HttpFetch = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ status: 200, text: () => Promise.resolve("ok") });
    };
    const transport = createHttpConnectorTransport({
      baseUrl: "https://api.example.test/v1/",
      fetchImpl
    });
    const context = {} as Parameters<typeof transport.execute>[1];
    const result = await transport.execute(
      {
        path: "/v1/tools/search/call",
        method: "POST",
        body: { q: "term" },
        headers: { authorization: "Bearer leaked", "x-api-key": "secret", "x-ok": "1" }
      },
      context
    );
    expect(result).toEqual({ status: 200, ok: true, body: "ok" });
    expect(calls[0]!.init.headers.authorization).toBeUndefined();
    expect(calls[0]!.init.headers["x-api-key"]).toBeUndefined();
    expect(calls[0]!.init.headers["x-ok"]).toBe("1");
    expect(calls[0]!.init.headers["content-type"]).toBe("application/json");
    await expect(transport.execute({ path: "https://evil.test/v1/x" }, context)).rejects.toThrow(
      "INVALID_CONNECTOR_PATH"
    );
    await expect(transport.execute({ path: "/other/x" }, context)).rejects.toThrow(
      "CONNECTOR_PATH_NOT_ALLOWED"
    );
    await expect(
      transport.execute({ path: "/v1/x", method: "PATCH" as "GET" }, context)
    ).rejects.toThrow("INVALID_CONNECTOR_METHOD");
  });

  it("creates a namespaced MCP tool call and bounds oversized responses", async () => {
    expect(mcpToolCall("files.read", { path: "a.txt" })).toMatchObject({
      path: "/tools/files.read/call",
      method: "POST"
    });
    expect(() => mcpToolCall("bad name", {})).toThrow("INVALID_MCP_TOOL_NAME");
    const transport = createHttpConnectorTransport({
      baseUrl: "https://api.example.test",
      fetchImpl: () =>
        Promise.resolve({ status: 200, text: () => Promise.resolve("x".repeat(300)) }),
      maxResponseBytes: 100
    });
    const context = {} as Parameters<typeof transport.execute>[1];
    await expect(transport.execute({ path: "/anything" }, context)).rejects.toThrow(
      "CONNECTOR_RESPONSE_TOO_LARGE"
    );
  });

  it("stays fail-closed in the registry until a transport is explicitly bound", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const projectId = new ProjectStore(database.sqlite).createProject("HTTP connector", "http")
        .project.id;
      const policy = new PolicyStore(database.sqlite);
      policy.ensureProfile(projectId, NOW);
      const runtime = new GuardedToolRuntime(policy, { now: () => NOW });
      const registry = new ConnectorRegistry(runtime);
      registry.register([descriptor]);
      registry.bindToRuntime();
      const toolId = connectorToolId("http-api", "call");
      expect(registry.isWired(toolId)).toBe(false);
      expect(registry.status(projectId).connectors[0]).toMatchObject({
        id: "http-api",
        state: "not_connected",
        transport_wired: false
      });
      const paused = await registry.invoke({
        toolId,
        projectId,
        actorId: "manager",
        objectIds: [projectId],
        purpose: "unbound call",
        idempotencyKey: "k1",
        input: { path: "/v1/x" }
      });
      expect(paused.status).toBe("PAUSED");
    } finally {
      database.close();
    }
  });

  it("executes a bound descriptor through the policy-checked runtime once", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const projectId = new ProjectStore(database.sqlite).createProject("HTTP connector", "http2")
        .project.id;
      const policy = new PolicyStore(database.sqlite);
      policy.ensureProfile(projectId, NOW);
      const profile = policy.getProfile(projectId)!;
      policy.updateProfile({
        projectId,
        baseLevel: "A5",
        overrides: [],
        expectedVersion: profile.version,
        issuedAt: NOW
      });
      const runtime = new GuardedToolRuntime(policy, { now: () => NOW });
      const registry = new ConnectorRegistry(runtime);
      registry.register([descriptor]);
      let calls = 0;
      registry.bindTransport(
        connectorToolId("http-api", "call"),
        createHttpConnectorTransport({
          baseUrl: "https://api.example.test",
          fetchImpl: () => {
            calls++;
            return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') });
          }
        })
      );
      registry.bindToRuntime();
      expect(registry.isWired(connectorToolId("http-api", "call"))).toBe(true);
      const invocation = {
        toolId: connectorToolId("http-api", "call"),
        projectId,
        actorId: "manager",
        objectIds: [projectId],
        purpose: "bound call",
        idempotencyKey: "k2",
        input: mcpToolCall("files.read", { path: "a.txt" })
      };
      const first = await registry.invoke(invocation);
      const replay = await registry.invoke(invocation);
      expect(first.status).toBe("EXECUTED");
      expect(replay.status).toBe("EXECUTED");
      expect(calls).toBe(1); // idempotency replay, no second external call
    } finally {
      database.close();
    }
  });
});
