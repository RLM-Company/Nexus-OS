import Fastify from "fastify";
import { openDatabase, runMigrations, ContextMemoryStore } from "@cosmora/db";
import { expect, it } from "vitest";
import { registerContextMemoryRoutes } from "../src/context-memory-routes.js";

it("exports and verifies a scope-preserving Drive manifest", async () => {
  const app = Fastify();
  const db = openDatabase(":memory:");
  try {
    await runMigrations(db);
    registerContextMemoryRoutes(
      app,
      new ContextMemoryStore(db.sqlite),
      () => ({
        owner_id: "owner-a",
        actor_id: "owner-a",
        actor_kind: "owner",
        session_id: "s",
        assurance: "local",
        authenticated_at: new Date().toISOString(),
        expires_at: "9999-12-31T23:59:59.999Z"
      }),
      () => []
    );

    const manifest = await app.inject({
      url: "/api/v1/memory/drive-manifest?scope=personal"
    });
    expect(manifest.statusCode).toBe(200);
    const body = manifest.json<{ format: string; scope: string; sha256: string }>();
    expect(body.format).toBe("kosmora.memory-drive-manifest.v1");
    expect(body.scope).toBe("personal");
    expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);

    const verified = await app.inject({
      method: "POST",
      url: "/api/v1/memory/drive-manifest/verify",
      payload: body
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({ ok: true, scope: "personal" });

    const tampered = await app.inject({
      method: "POST",
      url: "/api/v1/memory/drive-manifest/verify",
      payload: { ...body, scope: "project" }
    });
    expect(tampered.statusCode).toBe(409);
  } finally {
    await app.close();
    db.sqlite.close();
  }
});
