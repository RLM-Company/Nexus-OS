import { loadServerConfig } from "@cosmora/config";
import type { IdentityContext } from "@cosmora/contracts";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const owner: IdentityContext = {
  owner_id: "biz-owner",
  actor_id: "biz-owner",
  actor_kind: "owner",
  session_id: "biz-session",
  assurance: "local",
  authenticated_at: "2026-11-27T00:00:00.000Z",
  expires_at: "9999-12-31T23:59:59.999Z"
};

const config = loadServerConfig({ NODE_ENV: "test" });

const payload = {
  scenario_id: "BIZ-023",
  input: { revenue: 100, discount: 10, known_cost: 60, cost_complete: false }
};

it("POST /api/v1/business-scenarios/run returns the deterministic core result", async () => {
  const app = buildApp({
    config,
    database: { ping: () => undefined },
    identityResolver: { resolve: () => Promise.resolve(owner) }
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/business-scenarios/run",
      payload
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      format: "kosmora.business-scenario-run.v1",
      scenario_id: "BIZ-023",
      needs_answer: false,
      artifact: { kind: "calculation", margin: "30" },
      gaps: []
    });
    expect(response.json<{ checks: unknown[] }>().checks.length).toBeGreaterThan(0);

    const gap = await app.inject({
      method: "POST",
      url: "/api/v1/business-scenarios/run",
      payload: { scenario_id: "BIZ-023", input: { revenue: 100 } }
    });
    expect(gap.statusCode).toBe(200);
    expect(gap.json()).toMatchObject({ needs_answer: true, artifact: { kind: "gaps" } });
    expect(gap.json<{ gaps: unknown[] }>().gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "known_cost" })])
    );

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/business-scenarios/run",
      payload: { scenario_id: "BIZ-999", input: {} }
    });
    expect(invalid.statusCode).toBe(400);
  } finally {
    await app.close();
  }
});
