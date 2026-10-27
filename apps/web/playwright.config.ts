import { defineConfig, devices } from "@playwright/test";

const production = ["1", "true"].includes(process.env.KOSMORA_E2E_PRODUCTION ?? "");

export default defineConfig({
  testDir: "./e2e",
  // Issues use their dedicated real HTTP/SQLite fixture on 3219, run by test:e2e:issues.
  testIgnore: "**/github-issues.spec.ts",
  timeout: 30_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command:
        "pnpm --dir ../api exec node --require ../../scripts/windows-node-user.cjs --import tsx --conditions=development test/fixtures/integration-server.ts",
      url: "http://127.0.0.1:3100/api/v1/health",
      stdout: "pipe",
      stderr: "pipe",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        LOG_LEVEL: "error",
        MODEL_PROVIDER: "mock",
        KOSMORA_GRAPH_WORKSPACE_ENABLED: "true",
        DATABASE_URL: `file:./data/e2e-b0.1-${process.pid}-${Date.now()}.db`,
        MOCK_PROVIDER_MODE: "slow_stream",
        MANAGER_TIMEOUT_MS: "60000"
      }
    },
    {
      command: production ? "pnpm build && pnpm start" : "pnpm dev",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: production ? 180_000 : 60_000,
      env: {
        ...process.env,
        COSMORA_API_ORIGIN: "http://127.0.0.1:3100",
        NEXT_TELEMETRY_DISABLED: "1"
      }
    }
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
