import type { IdentityContext } from "@cosmora/contracts";
import { loadServerConfig } from "@cosmora/config";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const config = loadServerConfig({ NODE_ENV: "test" });

describe("GET /api/v1/health", () => {
  it("reports API and database availability", async () => {
    const app = buildApp({ config, database: { ping: () => undefined } });
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      version: "0.1.0",
      database: "ok"
    });
    expect(response.json<{ timestamp: string }>().timestamp).toMatch(/Z$/);

    await app.close();
  });

  it("reports a secret-free model runtime status", async () => {
    const app = buildApp({ config, database: { ping: () => undefined } });
    const response = await app.inject({ method: "GET", url: "/api/v1/model-runtime" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: "mock",
      provider: "mock",
      model: "manager",
      registry_version: null,
      credential_configured: false,
      fallback_to_mock: true
    });
    expect(response.body).not.toContain("API_KEY");

    await app.close();
  });

  it("keeps token economy disabled by default and owner-scoped", async () => {
    const identityFor = (ownerId: string): IdentityContext => ({
      owner_id: ownerId,
      actor_id: `${ownerId}-actor`,
      actor_kind: "owner",
      session_id: `${ownerId}-session`,
      assurance: "local",
      authenticated_at: "2026-09-19T00:00:00.000Z",
      expires_at: "9999-12-31T23:59:59.999Z"
    });
    const app = buildApp({
      config,
      database: { ping: () => undefined },
      identityResolver: {
        resolve: (request) =>
          Promise.resolve(
            identityFor(request.headers["x-test-owner"] === "owner-2" ? "owner-2" : "owner-1")
          )
      }
    });
    const defaultResponse = await app.inject({
      method: "GET",
      url: "/api/v1/settings/token-economy"
    });
    expect(defaultResponse.json()).toEqual({ enabled: false });

    const saved = await app.inject({
      method: "PUT",
      url: "/api/v1/settings/token-economy",
      payload: { enabled: true }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ enabled: true });

    const anotherOwner = await app.inject({
      method: "GET",
      url: "/api/v1/settings/token-economy",
      headers: { "x-test-owner": "owner-2" }
    });
    expect(anotherOwner.json()).toEqual({ enabled: false });
    await app.close();
  });

  it("returns 503 when the database is unavailable", async () => {
    const app = buildApp({
      config,
      database: {
        ping: () => {
          throw new Error("unavailable");
        }
      }
    });
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "degraded", database: "error" });

    await app.close();
  });
});
