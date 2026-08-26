import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../src/index.js";

describe("loadServerConfig", () => {
  it("loads zero-cost local defaults", () => {
    expect(loadServerConfig({})).toEqual({
      nodeEnv: "development",
      apiHost: "127.0.0.1",
      apiPort: 3100,
      webOrigin: "http://localhost:3000",
      databaseUrl: "file:./data/cosmora.db",
      modelProvider: "mock",
      modelBaseUrl: null,
      modelApiKey: null,
      modelName: "manager",
      modelFallbackToMock: true,
      managerTimeoutMs: 60_000,
      managerMaxOutputTokens: 1_200,
      logLevel: "info",
      mockProviderMode: "success"
    });
  });

  it("parses an explicit port", () => {
    expect(loadServerConfig({ API_PORT: "4100" }).apiPort).toBe(4100);
  });

  it("rejects an invalid port without exposing values", () => {
    expect(() => loadServerConfig({ API_PORT: "99999" })).toThrow(
      "Invalid server configuration: /API_PORT"
    );
  });

  it("rejects an unknown mock mode", () => {
    expect(() => loadServerConfig({ MOCK_PROVIDER_MODE: "unsafe" })).toThrow(
      "Invalid server configuration: /MOCK_PROVIDER_MODE"
    );
  });

  it.each(["openai-compatible", "anthropic-compatible"] as const)(
    "requires complete %s provider settings",
    (provider) => {
      expect(() =>
        loadServerConfig({
          MODEL_PROVIDER: provider,
          MODEL_BASE_URL: "https://provider.example/v1"
        })
      ).toThrow("Invalid server configuration: /MODEL_API_KEY");

      expect(
        loadServerConfig({
          MODEL_PROVIDER: provider,
          MODEL_BASE_URL: "https://provider.example/v1",
          MODEL_API_KEY: "secret",
          MODEL_NAME: "manager-model",
          MODEL_FALLBACK_TO_MOCK: "false"
        })
      ).toMatchObject({
        modelProvider: provider,
        modelBaseUrl: "https://provider.example/v1",
        modelName: "manager-model",
        modelFallbackToMock: false
      });
    }
  );

  it("rejects unsafe manager limits", () => {
    expect(() => loadServerConfig({ MANAGER_TIMEOUT_MS: "20" })).toThrow(
      "Invalid server configuration: /MANAGER_TIMEOUT_MS"
    );
    expect(() => loadServerConfig({ MANAGER_MAX_OUTPUT_TOKENS: "0" })).toThrow(
      "Invalid server configuration: /MANAGER_MAX_OUTPUT_TOKENS"
    );
  });
});
