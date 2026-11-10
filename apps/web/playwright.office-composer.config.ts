import { defineConfig } from "@playwright/test";
import base from "./playwright.composer.config";

export default defineConfig({
  ...base,
  testMatch: [
    "**/office-workspace.spec.ts",
    "**/office-range.spec.ts",
    "**/office-plan.spec.ts",
    "**/office-draft.spec.ts",
    "**/office-composer-integration.spec.ts",
    "**/chat-reliability.spec.ts",
    "**/composer-draft-races.spec.ts",
    "**/csv-composer-transfer.spec.ts",
    "**/studio-files.spec.ts",
    "**/document-upload-queue.spec.ts"
  ]
});
