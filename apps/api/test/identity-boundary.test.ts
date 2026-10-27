import { loadServerConfig } from "@cosmora/config";
import type { PolicyIntent, PolicyVerdict } from "@cosmora/contracts";
import {
  EmergencyStopStore,
  IdentityStore,
  openDatabase,
  PolicyStore,
  ProjectStore,
  runMigrations
} from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { buildModelRuntime } from "../src/model-runtime.js";

describe("API identity boundary", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let database: ReturnType<typeof openDatabase>;
  let identityStore: IdentityStore;
  let policyStore: PolicyStore;
  let app: ReturnType<typeof buildApp>;
  let ownerOneToken: string;
  let ownerTwoToken: string;
  let agentToken: string;
  let systemToken: string;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    identityStore = new IdentityStore(database.sqlite, {
      now: () => Date.parse("2026-08-27T12:00:00.000Z")
    });
    identityStore.registerActor("owner-1", "owner-actor-1", "owner");
    identityStore.registerActor("owner-2", "owner-actor-2", "owner");
    ownerOneToken = identityStore.issueSession({
      ownerId: "owner-1",
      actorId: "owner-actor-1",
      assurance: "single_factor",
      ttlMs: 60_000
    }).token;
    ownerTwoToken = identityStore.issueSession({
      ownerId: "owner-2",
      actorId: "owner-actor-2",
      assurance: "single_factor",
      ttlMs: 60_000
    }).token;
    identityStore.registerActor("owner-1", "agent-actor-1", "agent");
    identityStore.registerActor("owner-1", "system-actor-1", "system");
    agentToken = identityStore.issueSession({
      ownerId: "owner-1",
      actorId: "agent-actor-1",
      assurance: "single_factor",
      ttlMs: 60_000
    }).token;
    systemToken = identityStore.issueSession({
      ownerId: "owner-1",
      actorId: "system-actor-1",
      assurance: "single_factor",
      ttlMs: 60_000
    }).token;
    const runtime = await buildModelRuntime(config);
    policyStore = new PolicyStore(database.sqlite);
    app = buildApp({
      config,
      database,
      identityStore,
      projectStore: new ProjectStore(database.sqlite),
      emergencyStopStore: new EmergencyStopStore(database.sqlite),
      policyStore,
      modelGateway: runtime.gateway,
      manager: runtime.manager,
      identityResolver: new BearerSessionIdentityResolver(identityStore)
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("requires a valid bearer session outside the public health endpoint", async () => {
    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    const missing = await app.inject({ method: "GET", url: "/api/v1/projects" });
    const malformed = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { authorization: "Bearer malformed" }
    });

    expect(health.statusCode).toBe(200);
    expect(missing.statusCode).toBe(401);
    expect(missing.json<{ error: { code: string } }>().error.code).toBe("UNAUTHORIZED");
    expect(malformed.statusCode).toBe(401);
  });

  it("denies valid agent and system sessions at the owner API boundary", async () => {
    for (const token of [agentToken, systemToken]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/projects",
        headers: { authorization: `Bearer ${token}` }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("FORBIDDEN");
      expect(response.body).not.toContain(token);
    }

    const ownerResponse = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { authorization: `Bearer ${ownerOneToken}` }
    });
    expect(ownerResponse.statusCode).toBe(200);
  });

  it("lists only owner-bound session metadata and revokes sessions idempotently", async () => {
    const ownerOneHeaders = { authorization: `Bearer ${ownerOneToken}` };
    const ownerTwoHeaders = { authorization: `Bearer ${ownerTwoToken}` };
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/identity/sessions",
      headers: ownerOneHeaders
    });
    const sessions = listed.json<{ items: Array<Record<string, unknown>> }>().items;
    const agentSessionId = identityStore
      .listSessions("owner-1")
      .find((session) => session.actor_id === "agent-actor-1")?.session_id;

    expect(listed.statusCode).toBe(200);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((session) => session.current === true)).toHaveLength(1);
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actor_kind: "owner", current: true }),
        expect.objectContaining({ actor_kind: "agent", current: false }),
        expect.objectContaining({ actor_kind: "system", current: false })
      ])
    );
    expect(listed.body).not.toContain(ownerOneToken);
    expect(listed.body).not.toContain(agentToken);
    expect(listed.body).not.toContain(systemToken);

    const crossOwner = await app.inject({
      method: "POST",
      url: `/api/v1/identity/sessions/${agentSessionId ?? "missing"}/revoke`,
      headers: ownerTwoHeaders,
      payload: { reason: "Cross-owner attempt" }
    });
    expect(crossOwner.statusCode).toBe(404);
    expect(crossOwner.json<{ error: { code: string } }>().error.code).toBe(
      "IDENTITY_SESSION_NOT_FOUND"
    );
    expect(identityStore.resolveSession(agentToken)).not.toBeNull();

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/identity/sessions/${agentSessionId ?? "missing"}/revoke`,
      headers: ownerOneHeaders,
      payload: { reason: "Lost agent device" }
    });
    const repeated = await app.inject({
      method: "POST",
      url: `/api/v1/identity/sessions/${agentSessionId ?? "missing"}/revoke`,
      headers: ownerOneHeaders,
      payload: { reason: "Repeated request" }
    });

    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      actor_kind: "agent",
      current: false,
      status: "revoked",
      revoke_reason: "Lost agent device"
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toMatchObject({
      status: "revoked",
      revoke_reason: "Lost agent device"
    });
    expect(identityStore.resolveSession(agentToken)).toBeNull();
  });

  it("returns bounded recent identity audit events inside the owner boundary", async () => {
    const ownerOne = await app.inject({
      method: "GET",
      url: "/api/v1/identity/audit-events?limit=2",
      headers: { authorization: `Bearer ${ownerOneToken}` }
    });
    const ownerTwo = await app.inject({
      method: "GET",
      url: "/api/v1/identity/audit-events",
      headers: { authorization: `Bearer ${ownerTwoToken}` }
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/identity/audit-events?limit=101",
      headers: { authorization: `Bearer ${ownerOneToken}` }
    });

    expect(ownerOne.statusCode).toBe(200);
    expect(ownerOne.json<{ items: Array<{ owner_id: string }>; limit: number }>()).toMatchObject({
      limit: 2,
      items: [{ owner_id: "owner-1" }, { owner_id: "owner-1" }]
    });
    expect(ownerTwo.statusCode).toBe(200);
    expect(
      ownerTwo
        .json<{ items: Array<{ owner_id: string }> }>()
        .items.every((event) => event.owner_id === "owner-2")
    ).toBe(true);
    expect(ownerOne.body).not.toContain(ownerOneToken);
    expect(ownerOne.body).not.toContain(agentToken);
    expect(invalid.statusCode).toBe(400);
  });

  it("revokes the current owner session after returning a safe response", async () => {
    const currentSessionId = identityStore
      .listSessions("owner-1")
      .find((session) => session.actor_id === "owner-actor-1")?.session_id;
    const headers = { authorization: `Bearer ${ownerOneToken}` };
    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/identity/sessions/${currentSessionId ?? "missing"}/revoke`,
      headers,
      payload: { reason: "Owner logout" }
    });
    const afterRevoke = await app.inject({
      method: "GET",
      url: "/api/v1/identity/sessions",
      headers
    });

    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ current: true, status: "revoked" });
    expect(revoked.body).not.toContain(ownerOneToken);
    expect(afterRevoke.statusCode).toBe(401);
  });

  it("propagates owner and actor identity without leaking session tokens", async () => {
    const authorization = { authorization: `Bearer ${ownerOneToken}` };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authorization,
      payload: { initial_message: "Owner one project", client_message_id: "identity-owner-1" }
    });
    const projectId = created.json<{ project: { id: string } }>().project.id;
    const traceIntent: PolicyIntent = {
      operation_id: "owner-bound-trace-operation",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["external.communicate"],
      object_ids: ["campaign-owner-1"],
      purpose: "Owner one private campaign purpose",
      idempotency_key: "owner-one-private-idempotency"
    };
    const traceVerdict: PolicyVerdict = {
      operation_id: traceIntent.operation_id,
      verdict: "NEEDS_CONFIRMATION",
      evaluated_capabilities: [
        {
          capability_id: "external.communicate",
          mode: "CONFIRM",
          scope: [],
          conditions: []
        }
      ],
      permission_ids: [],
      reasons: ["Owner confirmation required"],
      evaluated_at: "2026-09-01T10:00:00.000Z",
      policy_version: "1.1.0"
    };
    policyStore.createConfirmation(traceIntent, traceVerdict, "2026-09-01T10:00:00.000Z");
    const visibleTrace = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/decision-trace`,
      headers: authorization
    });
    const hiddenTrace = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/decision-trace`,
      headers: { authorization: `Bearer ${ownerTwoToken}` }
    });
    const hiddenList = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { authorization: `Bearer ${ownerTwoToken}` }
    });
    const hiddenDetail = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}`,
      headers: { authorization: `Bearer ${ownerTwoToken}` }
    });
    const stopped = await app.inject({
      method: "POST",
      url: "/api/v1/operations/emergency-stop",
      headers: authorization,
      payload: { scope: "project", project_id: projectId, reason: "Identity audit test" }
    });
    const visibleStop = await app.inject({
      method: "GET",
      url: `/api/v1/operations/emergency-stop?project_id=${projectId}`,
      headers: authorization
    });
    const hiddenStop = await app.inject({
      method: "GET",
      url: `/api/v1/operations/emergency-stop?project_id=${projectId}`,
      headers: { authorization: `Bearer ${ownerTwoToken}` }
    });

    expect(created.statusCode).toBe(201);
    expect(visibleTrace.statusCode).toBe(200);
    expect(visibleTrace.json()).toMatchObject({
      limit: 50,
      items: [
        {
          project_id: projectId,
          actor_id: "manager",
          verdict: "NEEDS_CONFIRMATION",
          object_ids: ["campaign-owner-1"]
        }
      ]
    });
    expect(visibleTrace.body).not.toContain(traceIntent.purpose);
    expect(visibleTrace.body).not.toContain(traceIntent.idempotency_key);
    expect(visibleTrace.body).not.toContain(ownerOneToken);
    expect(hiddenTrace.statusCode).toBe(404);
    expect(hiddenTrace.json<{ error: { code: string } }>().error.code).toBe("PROJECT_NOT_FOUND");
    expect(hiddenTrace.body).not.toContain("owner-bound-trace-operation");
    expect(hiddenList.json<{ items: unknown[] }>().items).toHaveLength(0);
    expect(hiddenDetail.statusCode).toBe(404);
    expect(stopped.json()).toMatchObject({ activated_by: "owner-actor-1" });
    expect(visibleStop.statusCode).toBe(200);
    expect(visibleStop.json()).toMatchObject({
      scope: "project",
      project_id: projectId,
      active: true,
      reason: "Identity audit test",
      activated_by: "owner-actor-1"
    });
    expect(hiddenStop.statusCode).toBe(200);
    expect(hiddenStop.json()).toBeNull();
    expect(created.body).not.toContain(ownerOneToken);
    expect(stopped.body).not.toContain(ownerOneToken);
    expect(visibleStop.body).not.toContain(ownerOneToken);
  });

  it("rejects a revoked session immediately", async () => {
    const issued = identityStore.listSessions("owner-1")[0];
    expect(issued).toBeDefined();
    identityStore.revokeSession(
      issued?.session_id ?? "",
      "owner-1",
      "owner-actor-1",
      "Security logout"
    );
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { authorization: `Bearer ${ownerOneToken}` }
    });

    expect(response.statusCode).toBe(401);
  });

  it("moderates only same-owner technical actors with MFA and preserves revoked sessions", async () => {
    const mfaToken = identityStore.issueSession({
      ownerId: "owner-1",
      actorId: "owner-actor-1",
      assurance: "multi_factor",
      ttlMs: 60_000
    }).token;
    const endpoint = "/api/v1/identity/actors/agent-actor-1";
    const payload = { reason: "Confirmed security investigation" };
    const withoutMfa = await app.inject({
      method: "POST",
      url: `${endpoint}/suspend`,
      headers: { authorization: `Bearer ${ownerOneToken}` },
      payload
    });
    expect(withoutMfa.statusCode).toBe(403);
    expect(identityStore.getActor("agent-actor-1", "owner-1")?.status).toBe("active");

    const protectedOwner = await app.inject({
      method: "POST",
      url: "/api/v1/identity/actors/owner-actor-1/suspend",
      headers: { authorization: `Bearer ${mfaToken}` },
      payload
    });
    expect(protectedOwner.statusCode).toBe(403);

    const crossOwner = await app.inject({
      method: "POST",
      url: "/api/v1/identity/actors/owner-actor-2/suspend",
      headers: { authorization: `Bearer ${mfaToken}` },
      payload
    });
    expect(crossOwner.statusCode).toBe(404);

    const suspended = await app.inject({
      method: "POST",
      url: `${endpoint}/suspend`,
      headers: { authorization: `Bearer ${mfaToken}` },
      payload
    });
    expect(suspended.statusCode, suspended.body).toBe(200);
    expect(suspended.json()).toMatchObject({ actor_id: "agent-actor-1", status: "disabled" });
    expect(identityStore.resolveSession(agentToken)).toBeNull();

    const restored = await app.inject({
      method: "POST",
      url: `${endpoint}/restore`,
      headers: { authorization: `Bearer ${mfaToken}` },
      payload
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ actor_id: "agent-actor-1", status: "active" });
    expect(identityStore.resolveSession(agentToken)).toBeNull();
    expect(identityStore.listAuditEvents("owner-1").map((entry) => entry.event_type)).toEqual(
      expect.arrayContaining(["actor.disabled", "actor.enabled"])
    );
    expect(identityStore.listActorModerations("owner-1")).toEqual([
      expect.objectContaining({
        target_actor_id: "agent-actor-1",
        performed_by: "owner-actor-1",
        action: "restore",
        reason: payload.reason
      }),
      expect.objectContaining({
        target_actor_id: "agent-actor-1",
        performed_by: "owner-actor-1",
        action: "suspend",
        reason: payload.reason
      })
    ]);
    expect(identityStore.listActorModerations("owner-2")).toHaveLength(0);
    expect(() => database.sqlite.prepare("DELETE FROM identity_actor_moderations").run()).toThrow(
      "IMMUTABLE"
    );
  });

  it("fails production construction without an explicit resolver", async () => {
    await app.close();
    database.close();
    const productionConfig = { ...config, nodeEnv: "production" as const };

    expect(() =>
      buildApp({
        config: productionConfig,
        database: { ping: () => undefined }
      })
    ).toThrow("Production requires an explicit verified identity resolver");

    database = openDatabase(":memory:");
    await runMigrations(database);
    app = buildApp({ config, database: { ping: () => undefined } });
  });
});
