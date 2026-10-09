import { loadServerConfig } from "@cosmora/config";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MediaService } from "../src/media/media-service.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5d8AAAAASUVORK5CYII=", "base64");
const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });

// Covered by global owner-only onRequest hook; does not use network or provider funds.
describe("media HTTP contract", () => {
  it("blocks unconfirmed costs and exposes the real stored PNG only when done", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kosmora-media-http-"));
    const mediaService = new MediaService({ directory, paidEnabled: true, ownerBudget: { reserve: async () => {}, reconcile: async () => {}, uncertain: async () => {} }, adapter: {
      generateImage: async () => ({ bytes: png, mime: "image/png", extension: "png" }),
      speak: async () => { throw new Error("not configured"); },
      transcribe: async () => ""
    } });
    const app = buildApp({ config, database: { ping: () => undefined }, mediaService });
    try {
      const capabilities = await app.inject({ method: "GET", url: "/api/v1/media/capabilities" });
      expect(capabilities.statusCode).toBe(200);
      expect(capabilities.json<{ capabilities: { image_generation: { ready: boolean } } }>().capabilities.image_generation.ready).toBe(true);
      const missingHeader = await app.inject({ method: "POST", url: "/api/v1/media/images", payload: { prompt: "moon", explicit_paid_consent: true } });
      expect(missingHeader.statusCode).toBe(403);
      const denied = await app.inject({ method: "POST", url: "/api/v1/media/images", headers: { "x-kosmora-media-consent": "explicit" }, payload: { prompt: "moon", explicit_paid_consent: false } });
      expect(denied.statusCode).toBe(403);
      const response = await app.inject({ method: "POST", url: "/api/v1/media/images", headers: { "x-kosmora-media-consent": "explicit" }, payload: { prompt: "moon", explicit_paid_consent: true } });
      expect(response.statusCode).toBe(202);
      const id = response.json<{ id: string }>().id;
      for (let index = 0; index < 50; index++) {
        const check = await app.inject({ method: "GET", url: `/api/v1/media/jobs/${id}` });
        if (check.json<{ status: string }>().status === "done") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const result = await app.inject({ method: "GET", url: `/api/v1/media/assets/${id}?download=1` });
      expect(result.statusCode).toBe(200);
      expect(result.headers["content-type"]).toMatch(/image\/png/);
      expect(result.headers["content-disposition"]).toContain("attachment");
      expect(result.rawPayload).toEqual(png);
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
