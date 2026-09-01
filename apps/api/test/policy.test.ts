import { loadServerConfig } from "@cosmora/config";
import type { PolicyIntent, PolicyVerdict } from "@cosmora/contracts";
import { openDatabase, PolicyStore, ProjectStore, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { StepUpProofConsumption } from "../src/identity.js";
import { buildModelRuntime } from "../src/model-runtime.js";

describe("autonomy and confirmation API", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let database: ReturnType<typeof openDatabase>;
  let policyStore: PolicyStore;
  let app: ReturnType<typeof buildApp>;
  let projectId: string;
  let consumedStepUps: StepUpProofConsumption[];

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    const projectStore = new ProjectStore(database.sqlite);
    policyStore = new PolicyStore(database.sqlite);
    const runtime = await buildModelRuntime(config);
    consumedStepUps = [];
    app = buildApp({
      config,
      database,
      projectStore,
      policyStore,
      modelGateway: runtime.gateway,
      manager: runtime.manager,
      stepUpProofConsumer: {
        consume: (input) => {
          consumedStepUps.push(input);
          return Promise.resolve(input.token === "valid-step-up");
        }
      }
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { initial_message: "Policy API", client_message_id: "policy-api-project" }
    });
    projectId = created.json<{ project: { id: string } }>().project.id;
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("persists canonical profiles and rejects stale updates", async () => {
    const initial = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/autonomy-profile`
    });
    const initialProfile = initial.json<{
      profile: { base_level: string; grants: unknown[] };
    }>().profile;
    expect(initialProfile.base_level).toBe("A0");
    expect(initialProfile.grants).toHaveLength(19);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/autonomy-profile`,
      payload: { base_level: "A3", overrides: [], expected_version: 1 }
    });
    expect(updated.statusCode).toBe(200);
    expect(
      updated.json<{ profile: { base_level: string; version: number } }>().profile
    ).toMatchObject({
      base_level: "A3",
      version: 2
    });

    const stale = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/autonomy-profile`,
      payload: { base_level: "A4", overrides: [], expected_version: 1 }
    });
    expect(stale.statusCode).toBe(409);
  });

  it("previews authority changes without mutating the stored profile", async () => {
    const preview = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/autonomy-profile/preview`,
      payload: { base_level: "A4", overrides: [], expected_version: 1 }
    });
    expect(preview.statusCode).toBe(200);
    expect(
      preview.json<{
        current_version: number;
        proposed_profile: { base_level: string; version: number };
        requires_step_up: boolean;
      }>()
    ).toMatchObject({
      current_version: 1,
      proposed_profile: { base_level: "A4", version: 2 },
      requires_step_up: false
    });

    const stored = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/autonomy-profile`
    });
    expect(
      stored.json<{ profile: { base_level: string; version: number } }>().profile
    ).toMatchObject({ base_level: "A0", version: 1 });

    const a6Preview = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/autonomy-profile/preview`,
      payload: { base_level: "A6", overrides: [], expected_version: 1 }
    });
    expect(a6Preview.statusCode).toBe(200);
    expect(a6Preview.json<{ requires_step_up: boolean }>().requires_step_up).toBe(true);
    expect(consumedStepUps).toHaveLength(0);

    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/autonomy-profile/preview`,
      payload: { base_level: "A4", overrides: [], expected_version: 0 }
    });
    expect(stale.statusCode).toBe(409);
  });

  it("requires verified step-up before enabling A6", async () => {
    const denied = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/autonomy-profile`,
      payload: { base_level: "A6", overrides: [], expected_version: 1 }
    });
    expect(denied.statusCode).toBe(403);

    const approved = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/autonomy-profile`,
      headers: { "x-step-up-token": "valid-step-up" },
      payload: { base_level: "A6", overrides: [], expected_version: 1 }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json<{ profile: { base_level: string } }>().profile.base_level).toBe("A6");
    expect(consumedStepUps).toHaveLength(1);
    expect(consumedStepUps[0]).toMatchObject({
      purpose: "autonomy_profile_escalation",
      challenge: `project:${projectId}:autonomy-profile:1`,
      identity: {
        owner_id: "local-owner",
        actor_id: "local-owner",
        session_id: "local-development-session"
      }
    });
  });

  it("exposes pending confirmation cards and enforces nonce plus step-up", async () => {
    const intent: PolicyIntent = {
      operation_id: "critical-operation",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["finance.spend"],
      object_ids: ["invoice-1"],
      purpose: "Pay approved invoice",
      idempotency_key: "critical-operation-once"
    };
    const verdict: PolicyVerdict = {
      operation_id: intent.operation_id,
      verdict: "NEEDS_CONFIRMATION",
      evaluated_capabilities: [
        { capability_id: "finance.spend", mode: "CONFIRM", scope: [], conditions: [] }
      ],
      permission_ids: [],
      reasons: ["Owner confirmation required"],
      evaluated_at: "2026-08-24T12:00:00.000Z",
      policy_version: "1.1.0"
    };
    const confirmation = policyStore.createConfirmation(intent, verdict, new Date().toISOString());

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/confirmations?status=PENDING`
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);

    const noStepUp = await app.inject({
      method: "POST",
      url: `/api/v1/confirmations/${confirmation.confirmation_id}/approve`,
      payload: { challenge_nonce: confirmation.challenge_nonce }
    });
    expect(noStepUp.statusCode).toBe(403);

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/confirmations/${confirmation.confirmation_id}/approve`,
      headers: { "x-step-up-token": "valid-step-up" },
      payload: { challenge_nonce: confirmation.challenge_nonce }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json<{ status: string }>().status).toBe("APPROVED");
    expect(consumedStepUps).toHaveLength(1);
    expect(consumedStepUps[0]).toMatchObject({
      purpose: "critical_tool_confirmation",
      challenge: confirmation.challenge_nonce,
      identity: {
        owner_id: "local-owner",
        actor_id: "local-owner",
        session_id: "local-development-session"
      }
    });
  });

  it("records a reasoned rejection without consuming step-up proof", async () => {
    const intent: PolicyIntent = {
      operation_id: "rejected-critical-operation",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["finance.spend"],
      object_ids: ["invoice-2"],
      purpose: "Pay an invoice that is not approved",
      idempotency_key: "rejected-critical-operation-once"
    };
    const verdict: PolicyVerdict = {
      operation_id: intent.operation_id,
      verdict: "NEEDS_CONFIRMATION",
      evaluated_capabilities: [
        { capability_id: "finance.spend", mode: "CONFIRM", scope: [], conditions: [] }
      ],
      permission_ids: [],
      reasons: ["Owner confirmation required"],
      evaluated_at: "2026-08-31T22:15:00.000Z",
      policy_version: "1.1.0"
    };
    const confirmation = policyStore.createConfirmation(intent, verdict, new Date().toISOString());

    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/confirmations/${confirmation.confirmation_id}/reject`,
      payload: {
        challenge_nonce: confirmation.challenge_nonce,
        reason: "Invoice is outside the approved budget"
      }
    });
    expect(rejected.statusCode).toBe(200);
    expect(
      rejected.json<{
        status: string;
        decision_reason: string | null;
        decided_by: string | null;
      }>()
    ).toMatchObject({
      status: "REJECTED",
      decision_reason: "Invoice is outside the approved budget",
      decided_by: "local-owner"
    });
    expect(consumedStepUps).toHaveLength(0);
  });
});
