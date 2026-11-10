"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  saveOpenApiBundleToWorkspace
} = require("../workspace/openapi-contract-bundle-builder.cjs");

test("OpenAPI 3.1 Contract Bundle Builder emits valid openapi.json and TypeScript .d.ts interfaces", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-openapi-"));
  try {
    const saved = saveOpenApiBundleToWorkspace(tempDir, "kosmora-intelligence-api", {
      title: "Kosmora Intelligence Settings API",
      version: "2.4.0",
      endpoints: [
        {
          method: "PUT",
          path: "/api/v1/ai-intelligence/settings",
          operationId: "updateAiSettings",
          summary: "Updates owner custom system prompt and adaptive reasoning parameters",
          requestFields: {
            customSystemPrompt: "string",
            autoAdaptStyle: "boolean",
            customTemperature: "number"
          },
          responseFields: {
            ownerId: "string",
            updatedAt: "string"
          }
        }
      ]
    });

    assert.equal(fs.existsSync(saved.jsonPath), true);
    assert.equal(fs.existsSync(saved.dtsPath), true);

    const openApi = JSON.parse(fs.readFileSync(saved.jsonPath, "utf8"));
    const dts = fs.readFileSync(saved.dtsPath, "utf8");

    assert.equal(openApi.openapi, "3.1.0");
    assert.equal(openApi.info.version, "2.4.0");
    assert.ok(openApi.paths["/api/v1/ai-intelligence/settings"].put);
    assert.ok(dts.includes("export interface UpdateAiSettingsRequest"));
    assert.ok(dts.includes("customTemperature: number;"));
    assert.ok(dts.includes("export interface UpdateAiSettingsResponse"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
