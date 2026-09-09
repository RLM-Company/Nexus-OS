import { PolicyStore, ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuardedToolRuntime } from "../src/index.js";

const NOW = "2026-09-09T18:00:00.000Z";

describe("GuardedToolRuntime policy condition authority", () => {
  let database: ReturnType<typeof openDatabase>;
  let policyStore: PolicyStore;
  let projectId: string;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    projectId = new ProjectStore(database.sqlite).createProject(
      "Condition authority test",
      "condition-authority-project"
    ).project.id;
    policyStore = new PolicyStore(database.sqlite);
    const initial = policyStore.ensureProfile(projectId, NOW)!;
    policyStore.updateProfile({
      projectId,
      baseLevel: "A5",
      overrides: [],
      expectedVersion: initial.version,
      issuedAt: NOW
    });
  });

  afterEach(() => database.close());

  it("ignores a caller-supplied conditional expansion and keeps the action confirmation-gated", async () => {
    const execute = vi.fn(() => Promise.resolve({ deployed: true }));
    const runtime = new GuardedToolRuntime(policyStore);
    runtime.register({
      id: "fake-production-release",
      resolveCapabilities: () => ["production.deploy"],
      execute
    });

    const untrustedInvocation = {
      toolId: "fake-production-release",
      operationId: "untrusted-condition-operation",
      projectId,
      actorId: "manager",
      objectIds: ["release-2"],
      purpose: "Attempt a subsequent release",
      idempotencyKey: "untrusted-condition",
      input: {},
      evaluatedAt: NOW,
      activeConditionIds: ["subsequent_release_after_approved_first_release"]
    };

    const result = await runtime.invoke(untrustedInvocation);
    expect(result.status).toBe("WAITING_CONFIRMATION");
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts a conditional expansion only from the runtime's trusted resolver", async () => {
    const resolveActiveConditionIds = vi.fn(() => [
      "subsequent_release_after_approved_first_release"
    ]);
    const execute = vi.fn(() => Promise.resolve({ deployed: true }));
    const runtime = new GuardedToolRuntime(policyStore, { resolveActiveConditionIds });
    runtime.register({
      id: "fake-production-release",
      resolveCapabilities: () => ["production.deploy"],
      execute
    });

    const result = await runtime.invoke({
      toolId: "fake-production-release",
      operationId: "trusted-condition-operation",
      projectId,
      actorId: "manager",
      objectIds: ["release-2"],
      purpose: "Execute a policy-authorized subsequent release",
      idempotencyKey: "trusted-condition",
      input: {},
      evaluatedAt: NOW
    });

    expect(result.status).toBe("EXECUTED");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(resolveActiveConditionIds).toHaveBeenCalledWith({
      projectId,
      actorId: "manager",
      objectIds: ["release-2"],
      capabilityIds: ["production.deploy"],
      evaluatedAt: NOW
    });
  });

  it("pauses without executing when authoritative condition resolution fails", async () => {
    const execute = vi.fn(() => Promise.resolve({ deployed: true }));
    const runtime = new GuardedToolRuntime(policyStore, {
      resolveActiveConditionIds: () => Promise.reject(new Error("Condition store unavailable"))
    });
    runtime.register({
      id: "fake-production-release",
      resolveCapabilities: () => ["production.deploy"],
      execute
    });

    const result = await runtime.invoke({
      toolId: "fake-production-release",
      operationId: "condition-resolution-failure",
      projectId,
      actorId: "manager",
      objectIds: ["release-2"],
      purpose: "Attempt a release while condition authority is unavailable",
      idempotencyKey: "condition-resolution-failure",
      input: {},
      evaluatedAt: NOW
    });

    expect(result.status).toBe("PAUSED");
    expect(result.verdict.reasons).toEqual([
      "Authoritative policy condition resolution failed."
    ]);
    expect(execute).not.toHaveBeenCalled();
  });
});
