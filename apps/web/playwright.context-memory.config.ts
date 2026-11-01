import { defineConfig, devices } from "@playwright/test";

const production = ["1", "true"].includes(process.env.KOSMORA_E2E_PRODUCTION ?? "");

// Memory mutations deliberately require the whole owner to be idle. Other
// browser suites exercise live Work concurrently, so use a fresh HTTP/SQLite
// fixture instead of weakening that production guard or retrying mutations.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/context-memory.spec.ts",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: [
    {
      command:
        "pnpm --dir ../api exec node --require ../../scripts/windows-node-user.cjs --import tsx --conditions=development test/fixtures/integration-server.ts",
      url: "http://127.0.0.1:3226/api/v1/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        API_PORT: "3226",
        LOG_LEVEL: "error",
        MODEL_PROVIDER: "mock",
        DATABASE_URL: `file:./data/e2e-memory-${process.pid}-${Date.now()}.db`,
        MOCK_PROVIDER_MODE: "slow_stream",
        MANAGER_TIMEOUT_MS: "60000"
      }
    },
    {
      command: production
        ? "pnpm --filter @cosmora/contracts build && pnpm build && pnpm start"
        : "pnpm dev",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: production ? 180_000 : 60_000,
      env: {
        ...process.env,
        COSMORA_API_ORIGIN: "http://127.0.0.1:3226",
        NEXT_TELEMETRY_DISABLED: "1"
      }
    }
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
