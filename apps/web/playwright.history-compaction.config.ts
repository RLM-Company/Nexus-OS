import { defineConfig, devices } from "@playwright/test";
const production = ["1", "true"].includes(process.env.KOSMORA_E2E_PRODUCTION ?? "");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/history-compaction.spec.ts",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: [
    {
      command:
        "pnpm --dir ../api exec node --require ../../scripts/windows-node-user.cjs --import tsx --conditions=development test/fixtures/history-compaction-server.ts",
      url: "http://127.0.0.1:3225/api/v1/health",
      reuseExistingServer: false,
      timeout: 60000,
      env: { ...process.env, NODE_ENV: "test", MODEL_PROVIDER: "mock" }
    },
    {
      command: production
        ? "pnpm --filter @cosmora/contracts build && pnpm build && pnpm start"
        : "pnpm dev",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: production ? 180000 : 60000,
      env: {
        ...process.env,
        NODE_ENV: production ? "production" : "development",
        COSMORA_API_ORIGIN: "http://127.0.0.1:3225",
        NEXT_TELEMETRY_DISABLED: "1"
      }
    }
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
