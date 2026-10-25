import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "github-issues.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:3220",
    trace: "retain-on-failure",
    launchOptions: process.env.KOSMORA_TEST_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.KOSMORA_TEST_CHROMIUM_EXECUTABLE,
          args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--disable-gpu"
          ]
        }
      : {}
  },
  webServer: [
    {
      command:
        "pnpm --dir ../api exec node --import tsx --conditions=development test/fixtures/github-issues-browser-server.ts",
      url: "http://127.0.0.1:3219/api/v1/health",
      reuseExistingServer: false,
      timeout: 60_000
    },
    {
      command: "pnpm exec next dev -H 127.0.0.1 -p 3220",
      url: "http://127.0.0.1:3220",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { COSMORA_API_ORIGIN: "http://127.0.0.1:3219", NEXT_TELEMETRY_DISABLED: "1" }
    }
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
