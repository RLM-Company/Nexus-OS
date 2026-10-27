import { defineConfig, devices } from "@playwright/test";

// This UI suite intercepts the complete Code API contract, uses no AI requests,
// and needs only its own web server, independently of production/API fixtures.
const port = 3412;
export default defineConfig({
  testDir: "./e2e",
  testMatch: "code-agent.spec.ts",
  timeout: 30_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: `node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p ${port}`,
    url: `http://127.0.0.1:${port}/code-agent`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", COSMORA_API_ORIGIN: "http://127.0.0.1:3413" }
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
