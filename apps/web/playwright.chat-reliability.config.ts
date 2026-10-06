import { defineConfig, devices } from "@playwright/test";

// This checkout owns these servers and database. Never attach to another chat's server.
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 2,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3337", trace: "retain-on-failure" },
  webServer: [
    {
      command:
        "pnpm --dir ../api exec node --require ../../scripts/windows-node-user.cjs --import tsx --conditions=development test/fixtures/chat-reliability-server.ts",
      url: "http://127.0.0.1:3437/api/v1/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "development",
        API_PORT: "3437",
        DATABASE_URL: `file:./data/chat-reliability-${process.pid}.db`,
        MODEL_PROVIDER: "mock",
        MOCK_PROVIDER_MODE: "slow_stream",
        MANAGER_TIMEOUT_MS: "60000"
      }
    },
    {
      command: "pnpm dev --port 3337",
      url: "http://127.0.0.1:3337",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { COSMORA_API_ORIGIN: "http://127.0.0.1:3437", NEXT_TELEMETRY_DISABLED: "1" }
    }
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
