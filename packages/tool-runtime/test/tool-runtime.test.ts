import { PolicyStore, ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuardedToolRuntime } from "../src/index.js";

const NOW = "2026-08-24T12:00:00.000Z";

describe("GuardedToolRuntime", () => {
  let database: ReturnType<typeof openDatabase>;
  let policyStore: PolicyStore;
  let runtime: GuardedToolRuntime;
  let projectId: string;
  let currentTime: string;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    projectId = new ProjectStore(database.sqlite).createProject("Runtime test", "runtime-project")
      .project.id;
    policyStore = new PolicyStore(database.sqlite);
    policyStore.ensureProfile(projectId, NOW);
    currentTime = NOW;
    runtime = new GuardedToolRuntime(policyStore, { now: () => currentTime });
  });

  afterEach(() => database.close());

  const setLevel = (baseLevel: "A0" | "A1" | "A2" | "A3") => {
    const current = policyStore.getProfile(projectId)!;
    policyStore.updateProfile({
      projectId,
      baseLevel,
      overrides: [],
      expectedVersion: current.version,
      issuedAt: NOW
    });
  };

  it("executes only after an ALLOW verdict and replays the stored result", async () => {
    setLevel("A2");
    const execute = vi.fn((input: { value: number }) =>
      Promise.resolve({ doubled: input.value * 2 })
    );
    runtime.register({
      id: "workspace.write-test",
      resolveCapabilities: () => ["workspace.write"],
      execute
    });
    const invocation = {
      toolId: "workspace.write-test",
      projectId,
      actorId: "manager",
      objectIds: [projectId],
      purpose: "Write a project artifact",
      idempotencyKey: "write-once",
      input: { value: 4 }
    };
    const first = await runtime.invoke<typeof invocation.input, { doubled: number }>(invocation);
    const replay = await runtime.invoke<typeof invocation.input, { doubled: number }>(invocation);
    expect(first).toMatchObject({ status: "EXECUTED", result: { doubled: 8 }, replayed: false });
    expect(replay).toMatchObject({ status: "EXECUTED", result: { doubled: 8 }, replayed: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("consumes a finite point override at reservation and not on replay", async () => {
    const current = policyStore.getProfile(projectId)!;
    policyStore.updateProfile({
      projectId,
      baseLevel: "A0",
      overrides: [
        {
          override_id: "one-project-write",
          capability_id: "workspace.write",
          mode: "AUTONOMOUS",
          object_ids: [projectId],
          purpose: "Allow one exact project write",
          valid_until: null,
          remaining_uses: 1
        }
      ],
      expectedVersion: current.version,
      issuedAt: NOW
    });
    const execute = vi.fn(() => Promise.resolve({ written: true }));
    runtime.register({
      id: "finite-workspace-write",
      resolveCapabilities: () => ["workspace.write"],
      execute
    });
    const invocation = {
      toolId: "finite-workspace-write",
      operationId: "finite-runtime-operation-1",
      projectId,
      actorId: "manager",
      objectIds: [projectId],
      purpose: "Write one exact project artifact",
      idempotencyKey: "finite-runtime-write-1",
      input: {}
    };

    const first = await runtime.invoke(invocation);
    expect(first).toMatchObject({ status: "EXECUTED", replayed: false });
    expect(policyStore.getProfile(projectId)).toMatchObject({ version: 3, overrides: [] });
    const replay = await runtime.invoke(invocation);
    expect(replay).toMatchObject({ status: "EXECUTED", replayed: true });
    expect(policyStore.getProfile(projectId)).toMatchObject({ version: 3, overrides: [] });

    const exhausted = await runtime.invoke({
      ...invocation,
      operationId: "finite-runtime-operation-2",
      idempotencyKey: "finite-runtime-write-2"
    });
    expect(exhausted.status).toBe("DENIED");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not restore or retry a finite use after an uncertain tool failure", async () => {
    const current = policyStore.getProfile(projectId)!;
    policyStore.updateProfile({
      projectId,
      baseLevel: "A0",
      overrides: [
        {
          override_id: "one-failing-write",
          capability_id: "workspace.write",
          mode: "AUTONOMOUS",
          object_ids: [projectId],
          purpose: "Bound a potentially uncertain project write",
          valid_until: null,
          remaining_uses: 1
        }
      ],
      expectedVersion: current.version,
      issuedAt: NOW
    });
    const execute = vi.fn(() => Promise.reject(new Error("External outcome is unknown")));
    runtime.register({
      id: "finite-failing-write",
      resolveCapabilities: () => ["workspace.write"],
      execute
    });
    const invocation = {
      toolId: "finite-failing-write",
      operationId: "finite-failing-operation",
      projectId,
      actorId: "manager",
      objectIds: [projectId],
      purpose: "Attempt one bounded project write",
      idempotencyKey: "finite-failing-write-once",
      input: {}
    };

    expect(await runtime.invoke(invocation)).toMatchObject({
      status: "FAILED",
      errorCode: "Error"
    });
    expect(policyStore.getProfile(projectId)).toMatchObject({ version: 3, overrides: [] });
    expect((await runtime.invoke(invocation)).status).toBe("PAUSED");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not call an external tool before confirmation and consumes approval once", async () => {
    setLevel("A2");
    const execute = vi.fn(() => Promise.resolve({ sent: true }));
    runtime.register({
      id: "send-message",
      resolveCapabilities: () => ["external.communicate"],
      execute
    });
    const invocation = {
      toolId: "send-message",
      operationId: "operation-send",
      projectId,
      actorId: "manager",
      objectIds: ["recipient-1"],
      purpose: "Send a message",
      idempotencyKey: "send-once",
      input: { text: "Hello" }
    };
    const pending = await runtime.invoke(invocation);
    expect(pending.status).toBe("WAITING_CONFIRMATION");
    expect(execute).not.toHaveBeenCalled();
    if (pending.status !== "WAITING_CONFIRMATION") throw new Error("Expected confirmation");

    expect(
      policyStore.decideConfirmation({
        confirmationId: pending.confirmation.confirmation_id,
        challengeNonce: pending.confirmation.challenge_nonce,
        decision: "approve",
        decidedBy: "local-owner",
        approvalMethod: "session",
        decidedAt: "2026-08-24T12:00:01.000Z"
      }).status
    ).toBe("APPROVED");

    currentTime = "2026-08-24T12:00:02.000Z";
    const executed = await runtime.invoke(invocation);
    currentTime = "2026-08-24T12:00:03.000Z";
    const replay = await runtime.invoke(invocation);
    expect(executed.status).toBe("EXECUTED");
    expect(replay).toMatchObject({ status: "EXECUTED", replayed: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate execution while the first external action is in flight", async () => {
    setLevel("A2");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async () => {
      await gate;
      return { ok: true };
    });
    runtime.register({
      id: "slow-write",
      resolveCapabilities: () => ["workspace.write"],
      execute
    });
    const invocation = {
      toolId: "slow-write",
      operationId: "operation-slow",
      projectId,
      actorId: "manager",
      objectIds: [projectId],
      purpose: "Slow write",
      idempotencyKey: "slow-once",
      input: {}
    };
    const first = runtime.invoke(invocation);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const duplicate = await runtime.invoke(invocation);
    expect(duplicate.status).toBe("RECOVERY_REQUIRED");
    release();
    expect((await first).status).toBe("EXECUTED");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("pauses scoped execution when the tool cannot enforce limits", async () => {
    setLevel("A1");
    const execute = vi.fn(() => Promise.resolve({ ok: true }));
    runtime.register({
      id: "unsafe-web-reader",
      resolveCapabilities: () => ["context.web.read"],
      execute
    });
    const result = await runtime.invoke({
      toolId: "unsafe-web-reader",
      operationId: "operation-web",
      projectId,
      actorId: "manager",
      objectIds: ["https://example.com"],
      purpose: "Read a website",
      idempotencyKey: "web-read",
      input: {}
    });
    expect(result.status).toBe("PAUSED");
    expect(execute).not.toHaveBeenCalled();
  });
});
