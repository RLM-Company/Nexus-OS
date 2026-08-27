import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const RawServerConfigSchema = Type.Object(
  {
    NODE_ENV: Type.Optional(
      Type.Union([Type.Literal("development"), Type.Literal("test"), Type.Literal("production")])
    ),
    API_HOST: Type.Optional(Type.String({ minLength: 1 })),
    API_PORT: Type.Optional(Type.String({ pattern: "^\\d{1,5}$" })),
    WEB_ORIGIN: Type.Optional(Type.String({ minLength: 1 })),
    DATABASE_URL: Type.Optional(Type.String({ minLength: 1 })),
    MODEL_PROVIDER: Type.Optional(
      Type.Union([
        Type.Literal("mock"),
        Type.Literal("openai-compatible"),
        Type.Literal("anthropic-compatible")
      ])
    ),
    MODEL_PROVIDER_ID: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    MODEL_REGISTRY_PATH: Type.Optional(Type.String({ minLength: 1 })),
    MODEL_BASE_URL: Type.Optional(Type.String({ pattern: "^https?://" })),
    MODEL_API_KEY: Type.Optional(Type.String({ minLength: 1 })),
    MODEL_NAME: Type.Optional(Type.String({ minLength: 1 })),
    MODEL_FALLBACK_TO_MOCK: Type.Optional(
      Type.Union([Type.Literal("true"), Type.Literal("false")])
    ),
    MODEL_MAX_ATTEMPTS_PER_ROUTE: Type.Optional(Type.String({ pattern: "^\\d+$" })),
    MODEL_RETRY_BASE_DELAY_MS: Type.Optional(Type.String({ pattern: "^\\d+$" })),
    MODEL_RETRY_MAX_DELAY_MS: Type.Optional(Type.String({ pattern: "^\\d+$" })),
    MODEL_CIRCUIT_FAILURE_THRESHOLD: Type.Optional(Type.String({ pattern: "^\\d+$" })),
    MODEL_CIRCUIT_OPEN_MS: Type.Optional(Type.String({ pattern: "^\\d+$" })),
    RUNTIME_EMERGENCY_STOP: Type.Optional(
      Type.Union([Type.Literal("true"), Type.Literal("false")])
    ),
    MANAGER_TIMEOUT_MS: Type.Optional(Type.String({ pattern: "^\\d+$" })),
    MANAGER_MAX_OUTPUT_TOKENS: Type.Optional(Type.String({ pattern: "^\\d+$" })),
    LOG_LEVEL: Type.Optional(
      Type.Union([
        Type.Literal("debug"),
        Type.Literal("info"),
        Type.Literal("warn"),
        Type.Literal("error")
      ])
    ),
    MOCK_PROVIDER_MODE: Type.Optional(
      Type.Union([
        Type.Literal("success"),
        Type.Literal("slow_stream"),
        Type.Literal("timeout"),
        Type.Literal("provider_error"),
        Type.Literal("disconnect_after_delta"),
        Type.Literal("invalid_sequence"),
        Type.Literal("cancel"),
        Type.Literal("duplicate_request")
      ])
    )
  },
  { additionalProperties: true }
);

type RawServerConfig = Static<typeof RawServerConfigSchema>;
export type ModelProvider = "mock" | "openai-compatible" | "anthropic-compatible";

export interface ServerConfig {
  nodeEnv: "development" | "test" | "production";
  apiHost: string;
  apiPort: number;
  webOrigin: string;
  databaseUrl: string;
  modelProvider: ModelProvider;
  modelProviderId: string;
  modelRegistryPath: string | null;
  modelBaseUrl: string | null;
  modelApiKey: string | null;
  modelName: string;
  modelFallbackToMock: boolean;
  modelMaxAttemptsPerRoute: number;
  modelRetryBaseDelayMs: number;
  modelRetryMaxDelayMs: number;
  modelCircuitFailureThreshold: number;
  modelCircuitOpenMs: number;
  runtimeEmergencyStop: boolean;
  managerTimeoutMs: number;
  managerMaxOutputTokens: number;
  logLevel: "debug" | "info" | "warn" | "error";
  mockProviderMode:
    | "success"
    | "slow_stream"
    | "timeout"
    | "provider_error"
    | "disconnect_after_delta"
    | "invalid_sequence"
    | "cancel"
    | "duplicate_request";
}

const configKeys = [
  "NODE_ENV",
  "API_HOST",
  "API_PORT",
  "WEB_ORIGIN",
  "DATABASE_URL",
  "MODEL_PROVIDER",
  "MODEL_PROVIDER_ID",
  "MODEL_REGISTRY_PATH",
  "MODEL_BASE_URL",
  "MODEL_API_KEY",
  "MODEL_NAME",
  "MODEL_FALLBACK_TO_MOCK",
  "MODEL_MAX_ATTEMPTS_PER_ROUTE",
  "MODEL_RETRY_BASE_DELAY_MS",
  "MODEL_RETRY_MAX_DELAY_MS",
  "MODEL_CIRCUIT_FAILURE_THRESHOLD",
  "MODEL_CIRCUIT_OPEN_MS",
  "RUNTIME_EMERGENCY_STOP",
  "MANAGER_TIMEOUT_MS",
  "MANAGER_MAX_OUTPUT_TOKENS",
  "LOG_LEVEL",
  "MOCK_PROVIDER_MODE"
] as const;

const toRawConfig = (env: NodeJS.ProcessEnv): unknown =>
  Object.fromEntries(
    configKeys.flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]]]))
  );

export const loadServerConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const candidate = toRawConfig(env);

  if (!Value.Check(RawServerConfigSchema, candidate)) {
    const field = configKeys.find((key) => {
      const value = env[key];
      return value !== undefined && !Value.Check(RawServerConfigSchema.properties[key], value);
    });
    throw new Error(`Invalid server configuration: /${field ?? "environment"}`);
  }

  const raw: RawServerConfig = candidate;

  const apiPort = Number(raw.API_PORT ?? "3100");
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
    throw new Error("Invalid server configuration: /API_PORT");
  }

  const modelProvider = raw.MODEL_PROVIDER ?? "mock";
  if (modelProvider === "mock" && raw.MODEL_PROVIDER_ID && raw.MODEL_PROVIDER_ID !== "mock") {
    throw new Error("Invalid server configuration: /MODEL_PROVIDER_ID");
  }
  if (modelProvider !== "mock") {
    for (const key of ["MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_NAME"] as const) {
      if (!raw[key]) throw new Error(`Invalid server configuration: /${key}`);
    }
  }

  const managerTimeoutMs = Number(raw.MANAGER_TIMEOUT_MS ?? "60000");
  if (!Number.isInteger(managerTimeoutMs) || managerTimeoutMs < 100 || managerTimeoutMs > 600_000) {
    throw new Error("Invalid server configuration: /MANAGER_TIMEOUT_MS");
  }

  const managerMaxOutputTokens = Number(raw.MANAGER_MAX_OUTPUT_TOKENS ?? "1200");
  if (
    !Number.isInteger(managerMaxOutputTokens) ||
    managerMaxOutputTokens < 1 ||
    managerMaxOutputTokens > 100_000
  ) {
    throw new Error("Invalid server configuration: /MANAGER_MAX_OUTPUT_TOKENS");
  }

  const boundedInteger = (
    key:
      | "MODEL_MAX_ATTEMPTS_PER_ROUTE"
      | "MODEL_RETRY_BASE_DELAY_MS"
      | "MODEL_RETRY_MAX_DELAY_MS"
      | "MODEL_CIRCUIT_FAILURE_THRESHOLD"
      | "MODEL_CIRCUIT_OPEN_MS",
    fallback: number,
    minimum: number,
    maximum: number
  ): number => {
    const value = Number(raw[key] ?? fallback);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`Invalid server configuration: /${key}`);
    }
    return value;
  };

  const modelMaxAttemptsPerRoute = boundedInteger("MODEL_MAX_ATTEMPTS_PER_ROUTE", 2, 1, 5);
  const modelRetryBaseDelayMs = boundedInteger("MODEL_RETRY_BASE_DELAY_MS", 250, 0, 60_000);
  const modelRetryMaxDelayMs = boundedInteger("MODEL_RETRY_MAX_DELAY_MS", 2_000, 0, 60_000);
  const modelCircuitFailureThreshold = boundedInteger("MODEL_CIRCUIT_FAILURE_THRESHOLD", 3, 1, 100);
  const modelCircuitOpenMs = boundedInteger("MODEL_CIRCUIT_OPEN_MS", 30_000, 100, 3_600_000);
  if (modelRetryMaxDelayMs < modelRetryBaseDelayMs) {
    throw new Error("Invalid server configuration: /MODEL_RETRY_MAX_DELAY_MS");
  }

  return {
    nodeEnv: raw.NODE_ENV ?? "development",
    apiHost: raw.API_HOST ?? "127.0.0.1",
    apiPort,
    webOrigin: raw.WEB_ORIGIN ?? "http://localhost:3000",
    databaseUrl: raw.DATABASE_URL ?? "file:./data/cosmora.db",
    modelProvider,
    modelProviderId: raw.MODEL_PROVIDER_ID ?? (modelProvider === "mock" ? "mock" : "vibecode"),
    modelRegistryPath: raw.MODEL_REGISTRY_PATH ?? null,
    modelBaseUrl: raw.MODEL_BASE_URL ?? null,
    modelApiKey: raw.MODEL_API_KEY ?? null,
    modelName: raw.MODEL_NAME ?? "manager",
    modelFallbackToMock: raw.MODEL_FALLBACK_TO_MOCK !== "false",
    modelMaxAttemptsPerRoute,
    modelRetryBaseDelayMs,
    modelRetryMaxDelayMs,
    modelCircuitFailureThreshold,
    modelCircuitOpenMs,
    runtimeEmergencyStop: raw.RUNTIME_EMERGENCY_STOP === "true",
    managerTimeoutMs,
    managerMaxOutputTokens,
    logLevel: raw.LOG_LEVEL ?? "info",
    mockProviderMode: raw.MOCK_PROVIDER_MODE ?? "success"
  };
};
