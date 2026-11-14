import { defineConfig, devices } from "@playwright/test";

// This UI suite intercepts the complete Code API contract, uses no AI requests,
// and needs only its own web server, independently of production/API fixtures.
const port = Number(process.env.KOSMORA_CODE_AGENT_E2E_PORT ?? "3412");
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error("KOSMORA_CODE_AGENT_E2E_PORT must be a non-privileged TCP port");
const production = ["1", "true"].includes(process.env.KOSMORA_E2E_PRODUCTION ?? "");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
export default defineConfig({
  testDir: "./e2e",
  testMatch: "code-agent.spec.ts",
  timeout: 30_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {}
  },
  webServer: {
    command: production
      ? `pnpm --filter @cosmora/contracts build && pnpm build && node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${port}`
      : `node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p ${port}`,
    url: `http://127.0.0.1:${port}/code-agent`,
    reuseExistingServer: false,
    timeout: production ? 180_000 : 90_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", COSMORA_API_ORIGIN: "http://127.0.0.1:3413" }
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
