import { PolicyStore, ProjectStore, openDatabase, runMigrations } from "@nexus/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuardedToolRuntime } from "../src/index.js";

const NOW = "2026-08-24T12:00:00.000Z";

describe("GuardedToolRuntime", () => {
  let database: ReturnType<typeof openDatabase>;
  let policyStore: PolicyStore;
  let runtime: GuardedToolRuntime;
  let projectId: string;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    projectId = new ProjectStore(database.sqlite).createProject("Runtime test", "runtime-project")
      .project.id;
    policyStore = new PolicyStore(database.sqlite);
    policyStore.ensureProfile(projectId, NOW);
    runtime = new GuardedToolRuntime(policyStore);
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
      input: { value: 4 },
      evaluatedAt: NOW
    };
    const first = await runtime.invoke<typeof invocation.input, { doubled: number }>(invocation);
    const replay = await runtime.invoke<typeof invocation.input, { doubled: number }>(invocation);
    expect(first).toMatchObject({ status: "EXECUTED", result: { doubled: 8 }, replayed: false });
    expect(replay).toMatchObject({ status: "EXECUTED", result: { doubled: 8 }, replayed: true });
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
      input: { text: "Hello" },
      evaluatedAt: NOW
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

    const executed = await runtime.invoke({
      ...invocation,
      evaluatedAt: "2026-08-24T12:00:02.000Z"
    });
    const replay = await runtime.invoke({
      ...invocation,
      evaluatedAt: "2026-08-24T12:00:03.000Z"
    });
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
      input: {},
      evaluatedAt: NOW
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
      input: {},
      evaluatedAt: NOW
    });
    expect(result.status).toBe("PAUSED");
    expect(execute).not.toHaveBeenCalled();
  });
});
