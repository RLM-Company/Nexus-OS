import { defineConfig, devices } from "@playwright/test";

const production = process.env.KOSMORA_E2E_PRODUCTION === "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["koscode-navigation.spec.ts", "code-agent.spec.ts", "github-integration.spec.ts"],
  timeout: 40_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3338", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "pnpm --dir ../api exec node --require ../../scripts/windows-node-user.cjs --import tsx --conditions=development test/fixtures/integration-server.ts",
      url: "http://127.0.0.1:3138/api/v1/health",
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        API_PORT: "3138",
        NODE_ENV: "development",
        MODEL_PROVIDER: "mock",
        LOG_LEVEL: "error",
        DATABASE_URL: `file:./data/koscode-design-${process.pid}-${Date.now()}.db`,
        MOCK_PROVIDER_MODE: "success",
        MANAGER_TIMEOUT_MS: "60000"
      }
    },
    {
      command: production
        ? "pnpm --filter @cosmora/web... build && pnpm start --port 3338"
        : "pnpm demo --port 3338",
      url: "http://127.0.0.1:3338",
      timeout: production ? 300_000 : 90_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        COSMORA_API_ORIGIN: "http://127.0.0.1:3138",
        NEXT_TELEMETRY_DISABLED: "1"
      }
    }
  ]
});
