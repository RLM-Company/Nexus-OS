import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
export default defineConfig({
  ...base,
  testMatch: "**/document-upload-queue.spec.ts",
  retries: 0,
  workers: 2,
  use: { ...base.use, launchOptions: executablePath ? { executablePath } : {} }
});
