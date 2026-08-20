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

export interface ServerConfig {
  nodeEnv: "development" | "test" | "production";
  apiHost: string;
  apiPort: number;
  webOrigin: string;
  databaseUrl: string;
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

  return {
    nodeEnv: raw.NODE_ENV ?? "development",
    apiHost: raw.API_HOST ?? "127.0.0.1",
    apiPort,
    webOrigin: raw.WEB_ORIGIN ?? "http://localhost:3000",
    databaseUrl: raw.DATABASE_URL ?? "file:./data/nexus.db",
    logLevel: raw.LOG_LEVEL ?? "info",
    mockProviderMode: raw.MOCK_PROVIDER_MODE ?? "success"
  };
};
