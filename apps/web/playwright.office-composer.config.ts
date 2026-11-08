import { defineConfig } from "@playwright/test";
import base from "./playwright.composer.config";

export default defineConfig({
  ...base,
  testMatch: [
    "**/office-workspace.spec.ts",
    "**/chat-reliability.spec.ts",
    "**/composer-draft-races.spec.ts"
  ]
});
