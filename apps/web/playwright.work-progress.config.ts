import { defineConfig } from "@playwright/test";
import workflows from "./playwright.workflows.config";

export default defineConfig({
  ...workflows,
  testMatch: [
    "**/work-progress-refresh.spec.ts",
    "**/work-manager.spec.ts",
    "**/work-manager-dag.spec.ts"
  ]
});
