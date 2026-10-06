import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Several existing tests address the API directly on 3100. Refuse occupied servers
// rather than testing another checkout. The fixture never loads a provider .env.
export default defineConfig({
  ...base,
  workers: 2,
  reporter: "list",
  webServer: Array.isArray(base.webServer)
    ? base.webServer.map((server) => ({
        ...server,
        command: server.command?.replace(
          "test/fixtures/e2e-server.ts",
          "test/fixtures/integration-server.ts"
        ),
        reuseExistingServer: false,
        env: {
          ...server.env,
          MODEL_PROVIDER: "mock",
          LOG_LEVEL: "error",
          NEXT_TELEMETRY_DISABLED: "1"
        }
      }))
    : base.webServer
});
