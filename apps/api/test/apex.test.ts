import { randomUUID, createHash, createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";

it("Apex uses real owner sessions, project isolation and explicit unavailable/input failures", async () => {
  const database = openDatabase(":memory:");
  await runMigrations(database);
  const identities = new IdentityStore(database.sqlite),
    projects = new ProjectStore(database.sqlite);
  identities.registerActor("owner-a", "actor-a", "owner");
  identities.registerActor("owner-b", "actor-b", "owner");
  const tokenA = identities.issueSession({
    ownerId: "owner-a",
    actorId: "actor-a",
    assurance: "single_factor",
    ttlMs: 60000
  }).token;
  const tokenB = identities.issueSession({
    ownerId: "owner-b",
    actorId: "actor-b",
    assurance: "single_factor",
    ttlMs: 60000
  }).token;
  const project = projects.createEmptyProject(
    randomUUID(),
    "Private Apex test",
    "owner-a",
    "ACTIVE"
  );
  const app = buildApp({
    config: loadServerConfig({ NODE_ENV: "test" }),
    database,
    projectStore: projects,
    identityResolver: new BearerSessionIdentityResolver(identities)
  });
  const url = `/api/v1/projects/${project.id}/apex/F481/execute`,
    input = {
      instruction_stream: [{ op: "PUSH", value: 999 }, { op: "HALT" }],
      gas_limit: 20,
      max_stack_limit: 4
    };
  const owner = { authorization: `Bearer ${tokenA}` };
  try {
    expect((await app.inject({ method: "GET", url: "/api/v1/apex/features" })).statusCode).toBe(
      401
    );
    const catalog = await app.inject({
      method: "GET",
      url: "/api/v1/apex/features",
      headers: owner
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json<{ features: unknown[] }>().features).toHaveLength(512);
    expect(catalog.headers["cache-control"]).toBe("no-store");
    const payload = Buffer.from(
      JSON.stringify({
        user_id: "owner-a",
        tenant_id: "owner-a",
        role: "owner",
        mfa_verified: true,
        workspace_ids: [project.id],
        exp: new Date(Date.now() + 60000).toISOString()
      })
    ).toString("base64url");
    const master = createHash("sha256")
      .update("kosmora-sovereign-enterprise-kms-default-key")
      .digest();
    const forged =
      "ksm_sess." +
      payload +
      "." +
      createHmac(
        "sha256",
        createHash("sha256")
          .update(Buffer.concat([master, Buffer.from(":session-hmac-v1")]))
          .digest()
      )
        .update(payload)
        .digest("base64url");
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { authorization: `Bearer ${forged}` },
          payload: { input }
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { authorization: `Bearer ${tokenB}` },
          payload: { input }
        })
      ).statusCode
    ).toBe(404);
    const response = await app.inject({ method: "POST", url, headers: owner, payload: { input } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      result: { return_value: 999, halted_cleanly: true },
      formal_guarantee: false
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: owner,
          payload: { input, owner_id: "owner-b", autonomyLevel: "A6" }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: owner,
          payload: { input: { ...input, host_command: "read outside project" } }
        })
      ).statusCode
    ).toBe(400);
    const unbound = await app.inject({
      method: "POST",
      url: url.replace("F481", "F001"),
      headers: owner,
      payload: { input: {} }
    });
    expect(unbound.statusCode).toBe(501);
    expect(unbound.json()).toMatchObject({ error: { code: "APEX_ADAPTER_UNAVAILABLE" } });
    expect(
      (
        await app.inject({
          method: "POST",
          url: url.replace("F481", "F999"),
          headers: owner,
          payload: { input: {} }
        })
      ).statusCode
    ).toBe(404);
    const invalid = await app.inject({
      method: "POST",
      url,
      headers: owner,
      payload: {
        input: {
          instruction_stream: [{ op: "ADD" }, { op: "HALT" }],
          gas_limit: 10,
          max_stack_limit: 0
        }
      }
    });
    expect(invalid.json()).toMatchObject({
      result: { static_verification_passed: false, halted_cleanly: false }
    });
  } finally {
    await app.close();
    database.close();
  }
});
