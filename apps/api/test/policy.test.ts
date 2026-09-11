import { loadServerConfig } from "@cosmora/config";
import type { PolicyIntent, PolicyVerdict } from "@cosmora/contracts";
import { openDatabase, PolicyStore, ProjectStore, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { StepUpProofConsumption } from "../src/identity.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { autonomyProfileStepUpChallenge } from "../src/step-up-challenge.js";

describe("autonomy and confirmation API", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let database: ReturnType<typeof openDatabase>;
  let projectStore: ProjectStore;
  let policyStore: PolicyStore;
  let app: ReturnType<typeof buildApp>;
  let projectId: string;
  let consumedStepUps: StepUpProofConsumption[];

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    projectStore = new ProjectStore(database.sqlite);
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

    const staleCritical = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/autonomy-profile`,
      headers: { "x-step-up-token": "valid-step-up" },
      payload: { base_level: "A6", overrides: [], expected_version: 1 }
    });
    expect(staleCritical.statusCode).toBe(409);
    expect(consumedStepUps).toHaveLength(0);
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

  it("previews finite point overrides, rejects invalid counters, and requires step-up for FULL", async () => {
    const override = {
      override_id: "override-external-full",
      capability_id: "external.communicate",
      mode: "FULL",
      object_ids: ["campaign-override-api"],
      purpose: "Allow one exact owner-selected campaign scope",
      valid_until: "2099-09-03T12:00:00.000Z",
      remaining_uses: 2
    } as const;
    const invalidCounter = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/autonomy-profile/preview`,
      payload: {
        base_level: "A0",
        overrides: [{ ...override, remaining_uses: 0 }],
        expected_version: 1
      }
    });
    expect(invalidCounter.statusCode).toBe(400);

    const duplicatePreview = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/autonomy-profile/preview`,
      payload: { base_level: "A0", overrides: [override, { ...override }], expected_version: 1 }
    });
    expect(duplicatePreview.statusCode).toBe(400);
    expect(duplicatePreview.json<{ error: { code: string } }>().error.code).toBe(
      "VALIDATION_ERROR"
    );

    const duplicateApply = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/autonomy-profile`,
      headers: { "x-step-up-token": "valid-step-up" },
      payload: { base_level: "A0", overrides: [override, { ...override }], expected_version: 1 }
    });
    expect(duplicateApply.statusCode).toBe(400);
    expect(consumedStepUps).toHaveLength(0);

    const preview = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/autonomy-profile/preview`,
      payload: { base_level: "A0", overrides: [override], expected_version: 1 }
    });
    expect(preview.statusCode).toBe(200);
    expect(
      preview.json<{
        current_version: number;
        proposed_profile: { overrides: unknown[]; version: number };
        requires_step_up: boolean;
      }>()
    ).toMatchObject({
      current_version: 1,
      proposed_profile: { overrides: [override], version: 2 },
      requires_step_up: true
    });
    const beforeApply = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/autonomy-profile`
    });
    expect(beforeApply.json<{ profile: { overrides: unknown[] } }>().profile.overrides).toEqual([]);

    const denied = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/autonomy-profile`,
      payload: { base_level: "A0", overrides: [override], expected_version: 1 }
    });
    expect(denied.statusCode).toBe(403);

    const applied = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/autonomy-profile`,
      headers: { "x-step-up-token": "valid-step-up" },
      payload: { base_level: "A0", overrides: [override], expected_version: 1 }
    });
    expect(applied.statusCode).toBe(200);
    expect(
      applied.json<{ profile: { overrides: unknown[]; version: number } }>().profile
    ).toMatchObject({ overrides: [override], version: 2 });
    expect(consumedStepUps).toHaveLength(1);

    const removed = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/autonomy-profile`,
      payload: { base_level: "A0", overrides: [], expected_version: 2 }
    });
    expect(removed.statusCode).toBe(200);
    expect(
      removed.json<{ profile: { overrides: unknown[]; version: number } }>().profile
    ).toMatchObject({ overrides: [], version: 3 });
    expect(consumedStepUps).toHaveLength(1);
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
      challenge: autonomyProfileStepUpChallenge(projectId, {
        base_level: "A6",
        overrides: [],
        expected_version: 1
      }),
      identity: {
        owner_id: "local-owner",
        actor_id: "local-owner",
        session_id: "local-development-session"
      }
    });
  });

  it("expires a stale critical confirmation before consuming step-up proof", async () => {
    const requestedAt = new Date(Date.now() - 60_000).toISOString();
    const intent: PolicyIntent = {
      operation_id: "expired-critical-operation",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["finance.spend"],
      object_ids: ["invoice-expired"],
      purpose: "Pay an invoice before confirmation expiry",
      idempotency_key: "expired-critical-operation-once"
    };
    const verdict: PolicyVerdict = {
      operation_id: intent.operation_id,
      verdict: "NEEDS_CONFIRMATION",
      evaluated_capabilities: [
        { capability_id: "finance.spend", mode: "CONFIRM", scope: [], conditions: [] }
      ],
      permission_ids: [],
      reasons: ["Owner confirmation required"],
      evaluated_at: requestedAt,
      policy_version: "1.1.0"
    };
    const confirmation = policyStore.createConfirmation(intent, verdict, requestedAt, 1_000);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/confirmations/${confirmation.confirmation_id}/approve`,
      headers: { "x-step-up-token": "valid-step-up" },
      payload: { challenge_nonce: confirmation.challenge_nonce }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("CONFIRMATION_EXPIRED");
    expect(consumedStepUps).toHaveLength(0);
    expect(policyStore.getConfirmation(confirmation.confirmation_id)?.status).toBe("EXPIRED");
  });

  it("returns a bounded content-minimized Policy Decision Trace", async () => {
    const intent: PolicyIntent = {
      operation_id: "trace-operation",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["external.communicate"],
      object_ids: ["campaign-trace-api"],
      purpose: "Private campaign content must not appear in Decision Trace",
      idempotency_key: "private-trace-idempotency-key"
    };
    const verdict: PolicyVerdict = {
      operation_id: intent.operation_id,
      verdict: "NEEDS_CONFIRMATION",
      evaluated_capabilities: [
        {
          capability_id: "external.communicate",
          mode: "CONFIRM",
          scope: ["private-audience-segment"],
          conditions: []
        }
      ],
      permission_ids: ["internal-permission-id"],
      reasons: ["Owner confirmation required"],
      evaluated_at: "2026-09-01T10:00:00.000Z",
      policy_version: "1.1.0"
    };
    policyStore.createConfirmation(intent, verdict, "2026-09-01T10:00:00.000Z");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/decision-trace?limit=1`
    });
    const invalid = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/decision-trace?limit=101`
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<{
        items: Array<{
          operation_id: string;
          project_id: string;
          actor_id: string;
          verdict: string;
          capability_ids: string[];
          object_ids: string[];
          reasons: string[];
          policy_version: string;
        }>;
        limit: number;
      }>()
    ).toMatchObject({
      limit: 1,
      items: [
        {
          operation_id: "trace-operation",
          project_id: projectId,
          actor_id: "manager",
          verdict: "NEEDS_CONFIRMATION",
          capability_ids: ["external.communicate"],
          object_ids: ["campaign-trace-api"],
          reasons: ["Owner confirmation required"],
          policy_version: "1.1.0"
        }
      ]
    });
    expect(response.body).not.toContain(intent.purpose);
    expect(response.body).not.toContain(intent.idempotency_key);
    expect(response.body).not.toContain("private-audience-segment");
    expect(response.body).not.toContain("internal-permission-id");
    expect(invalid.statusCode).toBe(400);
  });

  it("returns owner-bound recovery-required operations without replay material", async () => {
    const intent: PolicyIntent = {
      operation_id: "recovery-operation-api",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["agent.manage"],
      object_ids: ["campaign-recovery-api"],
      purpose: "Private campaign content must not appear in recovery API",
      idempotency_key: "private-recovery-api-key"
    };
    const profile = policyStore.ensureProfile(projectId)!;
    const reservedAt = new Date(Date.parse(profile.issued_at) + 1_000).toISOString();
    const verdict: PolicyVerdict = {
      operation_id: intent.operation_id,
      verdict: "ALLOW",
      evaluated_capabilities: [
        {
          capability_id: "agent.manage",
          mode: "AUTONOMOUS",
          scope: [],
          conditions: []
        }
      ],
      permission_ids: [],
      reasons: ["Operation was allowed by the active profile."],
      evaluated_at: profile.issued_at,
      policy_version: "1.1.0"
    };
    policyStore.reserveAllowed(
      intent,
      verdict,
      { profileVersion: profile.version, appliedOverrideIds: [] },
      reservedAt
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/recovery-required?limit=1`
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          operation_id: intent.operation_id,
          project_id: projectId,
          actor_id: "manager",
          recovery_status: "RECOVERY_REQUIRED",
          capability_ids: ["agent.manage"],
          object_ids: ["campaign-recovery-api"],
          reasons: ["Operation was allowed by the active profile."],
          policy_version: "1.1.0",
          reserved_at: reservedAt
        }
      ],
      limit: 1
    });
    expect(response.body).not.toContain(intent.purpose);
    expect(response.body).not.toContain(intent.idempotency_key);
    expect(response.body).not.toContain("private-audience-segment");

    const invalid = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/recovery-required?limit=101`
    });
    expect(invalid.statusCode).toBe(400);

    const hidden = projectStore.createProject(
      "Hidden recovery project",
      "hidden-recovery-project",
      "other-owner"
    );
    const hiddenResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${hidden.project.id}/recovery-required`
    });
    expect(hiddenResponse.statusCode).toBe(404);
    expect(hiddenResponse.body).not.toContain(hidden.run.id);
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

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/confirmations/${confirmation.confirmation_id}/approve`,
      headers: { "x-step-up-token": "valid-step-up" },
      payload: { challenge_nonce: confirmation.challenge_nonce }
    });
    expect(replay.statusCode).toBe(409);
    expect(consumedStepUps).toHaveLength(1);
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
