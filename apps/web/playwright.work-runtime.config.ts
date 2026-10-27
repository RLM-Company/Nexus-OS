import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  expect: { timeout: 20000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3009", trace: "retain-on-failure" },
  webServer: [
    {
      command:
        "node --require ../../scripts/windows-node-user.cjs --import ../api/node_modules/tsx/dist/loader.mjs --conditions=development ../api/test/fixtures/integration-server.ts",
      url: "http://127.0.0.1:3109/api/v1/health",
      reuseExistingServer: false,
      timeout: 90000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "development",
        LOG_LEVEL: "error",
        API_PORT: "3109",
        MODEL_PROVIDER: "mock",
        DATABASE_URL: "file:./data/e2e-manager-local.db",
        MOCK_PROVIDER_MODE: "slow_stream",
        MANAGER_TIMEOUT_MS: "60000"
      }
    },
    {
      command: "node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3009",
      url: "http://127.0.0.1:3009",
      reuseExistingServer: false,
      timeout: 90000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        COSMORA_API_ORIGIN: "http://127.0.0.1:3109",
        NEXT_TELEMETRY_DISABLED: "1"
      }
    }
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
