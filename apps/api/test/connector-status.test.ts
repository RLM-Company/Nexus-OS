import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, openDatabase, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";

describe("integrations status endpoint", () => {
  it("returns an honest, credential-free catalog behind the owner boundary", async () => {
    const database = openDatabase(":memory:");
    await runMigrations(database);
    const identities = new IdentityStore(database.sqlite);
    identities.registerActor("owner-a", "actor-a", "owner");
    const token = identities.issueSession({
      ownerId: "owner-a",
      actorId: "actor-a",
      assurance: "single_factor",
      ttlMs: 60_000
    }).token;
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database,
      identityStore: identities,
      identityResolver: new BearerSessionIdentityResolver(identities)
    });
    const url = "/api/v1/integrations/status";
    try {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      const response = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${token}` }
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const body = response.json<{
        project_id: string;
        connectors: { id: string; state: string; transport_wired: boolean; operations: number }[];
      }>();
      expect(body.connectors.map((item) => item.id).sort()).toEqual([
        "github",
        "google-drive",
        "office"
      ]);
      for (const connector of body.connectors) {
        expect(connector.state).toBe("not_connected");
        expect(connector.transport_wired).toBe(false);
        expect(connector.operations).toBeGreaterThan(0);
      }
      expect(response.body).not.toMatch(/token|secret|api[_-]?key|bearer/i);
    } finally {
      await app.close();
      database.close();
    }
  });
});
