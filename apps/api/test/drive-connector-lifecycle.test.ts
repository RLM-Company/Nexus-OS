import { PolicyStore, ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorRegistry,
  GuardedToolRuntime,
  FIRST_SLICE_CONNECTORS,
  connectorToolId
} from "@cosmora/tool-runtime";
import { driveConnectorTransports } from "../src/drive-connector-transport.js";
import type { GoogleDriveRuntime } from "../src/cloud-storage/google-drive-runtime.js";

const NOW = "2026-11-26T12:00:00.000Z";

describe("Drive connector lifecycle through the guarded runtime", () => {
  let database: ReturnType<typeof openDatabase>;
  let policy: PolicyStore;
  let projectId: string;
  let runtime: GuardedToolRuntime;
  const sources = vi.fn(() => ({
    items: [{ id: "chat-1", title: "Обсуждение документа" }],
    chats: [],
    files: [{ id: "file-1", name: "договор.pdf", sha256: "a".repeat(64), version: 1 }],
    file_selection: true,
    office_file_selection: true
  }));
  const restore = vi.fn(() => ({ status: "RESTORED", file: "договор.pdf" }));
  const drive = {
    bundleStore: { sources },
    store: { status: () => ({ connection_id: "conn-1", folder_state: "ready" }) },
    bundles: { restore }
  } as unknown as GoogleDriveRuntime;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    projectId = new ProjectStore(database.sqlite).createProject("Drive", "drive").project.id;
    policy = new PolicyStore(database.sqlite);
    policy.ensureProfile(projectId, NOW);
    const profile = policy.getProfile(projectId)!;
    policy.updateProfile({
      projectId,
      baseLevel: "A5",
      overrides: [],
      expectedVersion: profile.version,
      issuedAt: NOW
    });
    runtime = new GuardedToolRuntime(policy, { now: () => NOW });
    sources.mockClear();
    restore.mockClear();
  });
  afterEach(() => database.close());

  const invoke = (toolId: string, idempotencyKey: string, input: object) =>
    runtime.invoke({
      toolId,
      projectId,
      actorId: "owner-1",
      objectIds: [projectId],
      purpose: "drive lifecycle check",
      idempotencyKey,
      input
    });

  it("connects a transport, lists selected resources, executes an allowed action and replays once", async () => {
    const registry = new ConnectorRegistry(runtime);
    registry.register(FIRST_SLICE_CONNECTORS);
    const transports = driveConnectorTransports(drive);
    registry.bindTransport(
      connectorToolId("google-drive", "list_sources"),
      transports.list_sources
    );
    registry.bindTransport(
      connectorToolId("google-drive", "restore_backup"),
      transports.restore_backup
    );
    registry.bindToRuntime();

    const status = registry.status(projectId).connectors.find((c) => c.id === "google-drive")!;
    expect(status.transport_wired).toBe(true);

    const listed = await invoke(
      connectorToolId("google-drive", "list_sources"),
      "drive-list-1",
      {}
    );
    if (listed.status !== "EXECUTED") throw new Error(listed.status);
    expect(sources).toHaveBeenCalledWith("owner-1");
    expect((listed.result as { files: unknown[] }).files).toHaveLength(1);

    const restoreId = connectorToolId("google-drive", "restore_backup");
    const action = {
      archive_id: "archive-1",
      token: "token-1",
      operation_id: "operation-1"
    };
    const first = await invoke(restoreId, "drive-restore-1", action);
    if (first.status !== "EXECUTED") throw new Error(first.status);
    expect(restore).toHaveBeenCalledWith("owner-1", "archive-1", "token-1", "operation-1");
    const replay = await invoke(restoreId, "drive-restore-1", action);
    if (replay.status !== "EXECUTED") throw new Error(replay.status);
    expect(replay.replayed).toBe(true);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("stays fail-closed when no transport is bound", async () => {
    const registry = new ConnectorRegistry(runtime);
    registry.register(FIRST_SLICE_CONNECTORS);
    registry.bindToRuntime();
    const result = await invoke(
      connectorToolId("google-drive", "list_sources"),
      "drive-unbound",
      {}
    );
    expect(result.status).toBe("PAUSED");
    expect(sources).not.toHaveBeenCalled();
  });
});
