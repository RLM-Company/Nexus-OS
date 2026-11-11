import type { Page } from "@playwright/test";

/** Media route fixture: options are advertised, but paid execution is not available. */
export async function installOfflineImageCapabilities(page: Page): Promise<void> {
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({
      json: {
        capabilities: {
          image_generation: {
            ready: false,
            model: "gpt-image-1",
            reason: "PAID_EXECUTION_DISABLED",
            constraints: {
              sizes: ["1024x1024", "1536x1024", "1024x1536"],
              aspectRatios: ["1:1", "3:2", "2:3"],
              qualities: ["low", "medium", "high", "auto"],
              formats: ["png", "jpeg", "webp"],
              maxCount: 1,
              maxPromptLength: 2000,
              supportsReferenceImage: false
            }
          },
          image_editing: { ready: false, reason: "EDITING_UNAVAILABLE", model: null },
          speech: { ready: false, reason: "PAID_EXECUTION_DISABLED", model: null },
          transcription: { ready: false, reason: "PAID_EXECUTION_DISABLED", model: null }
        }
      }
    })
  );
}