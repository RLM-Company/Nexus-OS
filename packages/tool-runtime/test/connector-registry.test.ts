import { PolicyStore, ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorRegistry,
  GuardedToolRuntime,
  FIRST_SLICE_CONNECTORS,
  connectorToolId,
  type ConnectorTransport
} from "../src/index.js";

const NOW = "2026-08-24T12:00:00.000Z";

describe("ConnectorRegistry", () => {
  let database: ReturnType<typeof openDatabase>;
  let policyStore: PolicyStore;
  let runtime: GuardedToolRuntime;
  let projectId: string;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    projectId = new ProjectStore(database.sqlite).createProject("Integrations test", "integrations")
      .project.id;
    policyStore = new PolicyStore(database.sqlite);
    policyStore.ensureProfile(projectId, NOW);
    runtime = new GuardedToolRuntime(policyStore, { now: () => NOW });
  });

  afterEach(() => database.close());

  const setLevel = (baseLevel: "A0" | "A5") => {
    const current = policyStore.getProfile(projectId)!;
    policyStore.updateProfile({
      projectId,
      baseLevel,
      overrides: [],
      expectedVersion: current.version,
      issuedAt: NOW
    });
  };

  const readToolId = connectorToolId("github", "read_file");

  it("registers descriptors without wiring any transport and reports honest status", () => {
    const registry = new ConnectorRegistry(runtime);
    registry.register(FIRST_SLICE_CONNECTORS);
    registry.bindToRuntime();
    const status = registry.status(projectId);
    expect(status.connectors).toHaveLength(6);
    for (const connector of status.connectors) {
      expect(connector.state).toBe("not_connected");
      expect(connector.transport_wired).toBe(false);
      expect(connector.operations).toBeGreaterThan(0);
    }
    expect(registry.list()).toHaveLength(6);
    expect(registry.isWired(readToolId)).toBe(false);
  });

  it("is fail-closed: an unbound connector is PAUSED with no network and no secret", async () => {
    const registry = new ConnectorRegistry(runtime);
    registry.register(FIRST_SLICE_CONNECTORS);
    registry.bindToRuntime();
    const result = await registry.invoke({
      toolId: readToolId,
      projectId,
      actorId: "manager",
      objectIds: [projectId],
      purpose: "Read a repository file",
      idempotencyKey: "unbound-read",
      input: { path: "README.md" }
    });
    expect(result.status).toBe("PAUSED");
  });

  it("executes a bound operation through GuardedToolRuntime and replays it once", async () => {
    setLevel("A5");
    const registry = new ConnectorRegistry(runtime);
    registry.register(FIRST_SLICE_CONNECTORS);
    const execute = vi.fn((input) => Promise.resolve({ read: (input as { path: string }).path }));
    const transport: ConnectorTransport = { execute };
    registry.bindTransport(readToolId, transport);
    registry.bindToRuntime();
    const invocation = {
      toolId: readToolId,
      projectId,
      actorId: "manager",
      objectIds: [projectId],
      purpose: "Read a repository file",
      idempotencyKey: "bound-read",
      input: { path: "README.md" }
    };
    const first = await registry.invoke(invocation);
    const replay = await registry.invoke(invocation);
    expect(first).toMatchObject({
      status: "EXECUTED",
      result: { read: "README.md" },
      replayed: false
    });
    expect(replay).toMatchObject({ status: "EXECUTED", replayed: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(registry.isWired(readToolId)).toBe(true);
  });

  it("does not call a bound external action before confirmation", async () => {
    setLevel("A0");
    const registry = new ConnectorRegistry(runtime);
    registry.register(FIRST_SLICE_CONNECTORS);
    const execute = vi.fn(() => Promise.resolve({ ok: true }));
    const transport: ConnectorTransport = { execute };
    registry.bindTransport(connectorToolId("github", "prepare_draft"), transport);
    registry.bindToRuntime();
    const result = await registry.invoke({
      toolId: connectorToolId("github", "prepare_draft"),
      projectId,
      actorId: "manager",
      objectIds: [projectId],
      purpose: "Prepare a draft PR",
      idempotencyKey: "confirm-draft",
      input: {}
    });
    expect(["WAITING_CONFIRMATION", "DENIED", "PAUSED"]).toContain(result.status);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects duplicate registration, duplicate bind and late bind", () => {
    const registry = new ConnectorRegistry(runtime);
    registry.register(FIRST_SLICE_CONNECTORS);
    expect(() => registry.register(FIRST_SLICE_CONNECTORS)).toThrow(/already registered/);
    const transport: ConnectorTransport = { execute: () => Promise.resolve({}) };
    expect(() => registry.bindTransport("integration.unknown.op", transport)).toThrow(
      "CONNECTOR_OPERATION_NOT_FOUND"
    );
    registry.bindTransport(readToolId, transport);
    expect(() => registry.bindTransport(readToolId, transport)).toThrow(
      "CONNECTOR_TRANSPORT_ALREADY_BOUND"
    );
    registry.bindToRuntime();
    expect(() => registry.bindTransport(readToolId, transport)).toThrow(
      "CONNECTOR_REGISTRY_ALREADY_BOUND"
    );
  });
});
