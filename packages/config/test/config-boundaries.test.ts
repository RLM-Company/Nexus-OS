import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../src/index.js";

const expectConfigError = (env: NodeJS.ProcessEnv, field: string) => {
  expect(() => loadServerConfig(env)).toThrow(`Invalid server configuration: /${field}`);
};

describe("server config boundaries", () => {
  it("accepts API port minimum and maximum", () => {
    expect(loadServerConfig({ API_PORT: "1" }).apiPort).toBe(1);
    expect(loadServerConfig({ API_PORT: "65535" }).apiPort).toBe(65_535);
  });

  it("rejects invalid API ports", () => {
    for (const value of ["0", "65536", "-1", "1.5", "abc", "123456"]) {
      expectConfigError({ API_PORT: value }, "API_PORT");
    }
  });

  it("accepts manager timeout minimum and maximum", () => {
    const minimum = loadServerConfig({ MANAGER_TIMEOUT_MS: "100" });
    expect(minimum.managerTimeoutMs).toBe(100);

    const maximum = loadServerConfig({ MANAGER_TIMEOUT_MS: "600000" });
    expect(maximum.managerTimeoutMs).toBe(600_000);
  });

  it("rejects invalid manager timeout values", () => {
    for (const value of ["99", "600001", "1.5", "-1", "abc"]) {
      expectConfigError({ MANAGER_TIMEOUT_MS: value }, "MANAGER_TIMEOUT_MS");
    }
  });

  it("accepts manager output-token minimum and maximum", () => {
    const minimum = loadServerConfig({ MANAGER_MAX_OUTPUT_TOKENS: "1" });
    expect(minimum.managerMaxOutputTokens).toBe(1);

    const maximum = loadServerConfig({ MANAGER_MAX_OUTPUT_TOKENS: "100000" });
    expect(maximum.managerMaxOutputTokens).toBe(100_000);
  });

  it("rejects invalid manager output-token values", () => {
    for (const value of ["0", "100001", "1.5", "-1", "abc"]) {
      expectConfigError({ MANAGER_MAX_OUTPUT_TOKENS: value }, "MANAGER_MAX_OUTPUT_TOKENS");
    }
  });

  it("accepts model attempt-count minimum and maximum", () => {
    const minimum = loadServerConfig({ MODEL_MAX_ATTEMPTS_PER_ROUTE: "1" });
    expect(minimum.modelMaxAttemptsPerRoute).toBe(1);

    const maximum = loadServerConfig({ MODEL_MAX_ATTEMPTS_PER_ROUTE: "5" });
    expect(maximum.modelMaxAttemptsPerRoute).toBe(5);
  });

  it("rejects invalid model attempt counts", () => {
    for (const value of ["0", "6", "1.5", "-1", "abc"]) {
      expectConfigError({ MODEL_MAX_ATTEMPTS_PER_ROUTE: value }, "MODEL_MAX_ATTEMPTS_PER_ROUTE");
    }
  });

  it("accepts retry delay boundaries", () => {
    const zero = loadServerConfig({
      MODEL_RETRY_BASE_DELAY_MS: "0",
      MODEL_RETRY_MAX_DELAY_MS: "0"
    });
    expect(zero.modelRetryBaseDelayMs).toBe(0);
    expect(zero.modelRetryMaxDelayMs).toBe(0);

    const maximum = loadServerConfig({
      MODEL_RETRY_BASE_DELAY_MS: "60000",
      MODEL_RETRY_MAX_DELAY_MS: "60000"
    });
    expect(maximum.modelRetryBaseDelayMs).toBe(60_000);
    expect(maximum.modelRetryMaxDelayMs).toBe(60_000);
  });

  it("rejects retry delays outside their bounds", () => {
    expectConfigError({ MODEL_RETRY_BASE_DELAY_MS: "60001" }, "MODEL_RETRY_BASE_DELAY_MS");
    expectConfigError({ MODEL_RETRY_MAX_DELAY_MS: "60001" }, "MODEL_RETRY_MAX_DELAY_MS");
    expectConfigError({ MODEL_RETRY_BASE_DELAY_MS: "-1" }, "MODEL_RETRY_BASE_DELAY_MS");
    expectConfigError({ MODEL_RETRY_MAX_DELAY_MS: "-1" }, "MODEL_RETRY_MAX_DELAY_MS");
  });

  it("rejects retry max below retry base", () => {
    expectConfigError(
      {
        MODEL_RETRY_BASE_DELAY_MS: "101",
        MODEL_RETRY_MAX_DELAY_MS: "100"
      },
      "MODEL_RETRY_MAX_DELAY_MS"
    );
  });

  it("accepts circuit failure-threshold boundaries", () => {
    const minimum = loadServerConfig({ MODEL_CIRCUIT_FAILURE_THRESHOLD: "1" });
    expect(minimum.modelCircuitFailureThreshold).toBe(1);

    const maximum = loadServerConfig({ MODEL_CIRCUIT_FAILURE_THRESHOLD: "100" });
    expect(maximum.modelCircuitFailureThreshold).toBe(100);
  });

  it("rejects invalid circuit failure thresholds", () => {
    for (const value of ["0", "101", "1.5", "-1", "abc"]) {
      expectConfigError(
        { MODEL_CIRCUIT_FAILURE_THRESHOLD: value },
        "MODEL_CIRCUIT_FAILURE_THRESHOLD"
      );
    }
  });

  it("accepts circuit-open duration boundaries", () => {
    const minimum = loadServerConfig({ MODEL_CIRCUIT_OPEN_MS: "100" });
    expect(minimum.modelCircuitOpenMs).toBe(100);

    const maximum = loadServerConfig({ MODEL_CIRCUIT_OPEN_MS: "3600000" });
    expect(maximum.modelCircuitOpenMs).toBe(3_600_000);
  });

  it("rejects invalid circuit-open durations", () => {
    for (const value of ["99", "3600001", "1.5", "-1", "abc"]) {
      expectConfigError({ MODEL_CIRCUIT_OPEN_MS: value }, "MODEL_CIRCUIT_OPEN_MS");
    }
  });

  it("accepts every canonical provider mode", () => {
    expect(loadServerConfig({ MODEL_PROVIDER: "mock" }).modelProvider).toBe("mock");

    for (const provider of ["openai-compatible", "anthropic-compatible"] as const) {
      const config = loadServerConfig({
        MODEL_PROVIDER: provider,
        MODEL_BASE_URL: "https://provider.example/v1",
        MODEL_API_KEY: "test-key",
        MODEL_NAME: "manager-model"
      });
      expect(config.modelProvider).toBe(provider);
      expect(config.modelApiKeyConfigured).toBe(true);
    }
  });

  it("rejects non-canonical external credentials and model values", () => {
    const valid = {
      MODEL_PROVIDER: "openai-compatible",
      MODEL_BASE_URL: "https://provider.example/v1",
      MODEL_API_KEY: "test-key",
      MODEL_NAME: "manager-model"
    } as const;

    expectConfigError({ ...valid, MODEL_API_KEY: " test-key" }, "MODEL_API_KEY");
    expectConfigError({ ...valid, MODEL_API_KEY: "test-key " }, "MODEL_API_KEY");
    expectConfigError({ ...valid, MODEL_NAME: " manager-model" }, "MODEL_NAME");
    expectConfigError({ ...valid, MODEL_NAME: "manager-model " }, "MODEL_NAME");
    expectConfigError({ ...valid, MODEL_PROVIDER_ID: "provider id" }, "MODEL_PROVIDER_ID");
  });

  it("rejects embedded URL credentials and malformed provider URLs", () => {
    const valid = {
      MODEL_PROVIDER: "openai-compatible",
      MODEL_API_KEY: "test-key",
      MODEL_NAME: "manager-model"
    } as const;

    expectConfigError(
      {
        ...valid,
        MODEL_BASE_URL: "https://user:password@provider.example/v1"
      },
      "MODEL_BASE_URL"
    );
    expectConfigError({ ...valid, MODEL_BASE_URL: "https://" }, "MODEL_BASE_URL");
    expectConfigError({ ...valid, MODEL_BASE_URL: " provider.example" }, "MODEL_BASE_URL");
  });

  it("accepts both fallback literals and rejects lookalikes", () => {
    expect(loadServerConfig({ MODEL_FALLBACK_TO_MOCK: "true" }).modelFallbackToMock).toBe(true);
    expect(loadServerConfig({ MODEL_FALLBACK_TO_MOCK: "false" }).modelFallbackToMock).toBe(false);

    for (const value of ["TRUE", "False", "1", "yes", ""]) {
      expectConfigError({ MODEL_FALLBACK_TO_MOCK: value }, "MODEL_FALLBACK_TO_MOCK");
    }
  });

  it("accepts every log level and mock provider mode", () => {
    for (const logLevel of ["debug", "info", "warn", "error"] as const) {
      expect(loadServerConfig({ LOG_LEVEL: logLevel }).logLevel).toBe(logLevel);
    }

    const modes = [
      "success",
      "slow_stream",
      "timeout",
      "provider_error",
      "disconnect_after_delta",
      "invalid_sequence",
      "cancel",
      "duplicate_request"
    ] as const;

    for (const mockProviderMode of modes) {
      expect(loadServerConfig({ MOCK_PROVIDER_MODE: mockProviderMode }).mockProviderMode).toBe(
        mockProviderMode
      );
    }
  });
});
