import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const production = ["1", "true"].includes(process.env.KOSMORA_E2E_PRODUCTION ?? "");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
export default defineConfig({
  ...base,
  testMatch: [
    "**/chat-reliability.spec.ts",
    "**/composer-draft-races.spec.ts",
    "**/terminal-run-recovery.spec.ts",
    "**/run-draft-recovery.spec.ts"
  ],
  retries: 0,
  // Dev webpack compiles pages on first request (~10-20s each), so the base
  // 30s timeout is too tight for the longer chat-recovery scenarios. Production
  // runs are unaffected (pages are prebuilt).
  ...(production ? {} : { timeout: 90_000 }),
  workers: 1,
  use: {
    ...base.use,
    launchOptions: executablePath ? { executablePath } : {}
  }
});
