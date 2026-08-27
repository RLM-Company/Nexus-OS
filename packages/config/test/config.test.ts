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
      modelProviderId: "mock",
      modelRegistryPath: null,
      modelBaseUrl: null,
      modelApiKey: null,
      modelName: "manager",
      modelFallbackToMock: true,
      modelMaxAttemptsPerRoute: 2,
      modelRetryBaseDelayMs: 250,
      modelRetryMaxDelayMs: 2_000,
      modelCircuitFailureThreshold: 3,
      modelCircuitOpenMs: 30_000,
      runtimeEmergencyStop: false,
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

  it("keeps the mock provider identity canonical", () => {
    expect(() => loadServerConfig({ MODEL_PROVIDER_ID: "external" })).toThrow(
      "Invalid server configuration: /MODEL_PROVIDER_ID"
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
        modelProviderId: "vibecode",
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

  it("loads bounded Model Gateway reliability settings", () => {
    expect(
      loadServerConfig({
        MODEL_MAX_ATTEMPTS_PER_ROUTE: "3",
        MODEL_RETRY_BASE_DELAY_MS: "100",
        MODEL_RETRY_MAX_DELAY_MS: "500",
        MODEL_CIRCUIT_FAILURE_THRESHOLD: "4",
        MODEL_CIRCUIT_OPEN_MS: "5000"
      })
    ).toMatchObject({
      modelMaxAttemptsPerRoute: 3,
      modelRetryBaseDelayMs: 100,
      modelRetryMaxDelayMs: 500,
      modelCircuitFailureThreshold: 4,
      modelCircuitOpenMs: 5_000
    });
  });

  it("rejects unsafe Model Gateway reliability settings", () => {
    expect(() => loadServerConfig({ MODEL_MAX_ATTEMPTS_PER_ROUTE: "0" })).toThrow(
      "Invalid server configuration: /MODEL_MAX_ATTEMPTS_PER_ROUTE"
    );
    expect(() =>
      loadServerConfig({
        MODEL_RETRY_BASE_DELAY_MS: "500",
        MODEL_RETRY_MAX_DELAY_MS: "100"
      })
    ).toThrow("Invalid server configuration: /MODEL_RETRY_MAX_DELAY_MS");
    expect(() => loadServerConfig({ MODEL_CIRCUIT_OPEN_MS: "0" })).toThrow(
      "Invalid server configuration: /MODEL_CIRCUIT_OPEN_MS"
    );
  });

  it("loads the fail-closed process emergency switch", () => {
    expect(loadServerConfig({ RUNTIME_EMERGENCY_STOP: "true" }).runtimeEmergencyStop).toBe(true);
    expect(() => loadServerConfig({ RUNTIME_EMERGENCY_STOP: "yes" })).toThrow(
      "Invalid server configuration: /RUNTIME_EMERGENCY_STOP"
    );
  });
});
