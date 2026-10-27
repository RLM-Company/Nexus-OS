import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Reproducible local acceptance without pnpm startup-time dependency changes.
// An optional preinstalled browser stays outside application dependencies.
const executablePath = process.env.KOSMORA_E2E_CHROMIUM_EXECUTABLE;
const production = ["1", "true"].includes(process.env.KOSMORA_E2E_PRODUCTION ?? "");
const servers = Array.isArray(base.webServer)
  ? base.webServer
  : base.webServer
    ? [base.webServer]
    : [];

export default defineConfig({
  ...base,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...base.use,
    ...(executablePath ? { launchOptions: { executablePath } } : {})
  },
  webServer: servers.map((server, index) => ({
    ...server,
    reuseExistingServer: false,
    command:
      index === 0
        ? "node --require ../../scripts/windows-node-user.cjs --import ../api/node_modules/tsx/dist/loader.mjs --conditions=development ../api/test/fixtures/integration-server.ts"
        : `node scripts/prepare-pdf-worker.mjs && node node_modules/next/dist/bin/next ${production ? "start" : "dev --webpack"} -H 127.0.0.1`,
    env: {
      ...server.env,
      NODE_ENV: index === 0 || !production ? "development" : "production",
      KOSMORA_MEDIA_PAID_ENABLED: "false",
      NEXT_TELEMETRY_DISABLED: "1"
    }
  }))
});
