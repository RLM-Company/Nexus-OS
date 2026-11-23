import { expect, test } from "@playwright/test";

/** Stage-three: the integrations catalog must match shipped code, not a
 * hardcoded preview flag. Connection state comes from the connector registry. */
test("catalog shows implemented integrations and honest connector state", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kosmora:profile-onboarding.v1", "done");
      localStorage.removeItem("cosmora:workspace-surface");
    } catch {
      /* Storage may be unavailable. */
    }
  });
  await page.route("**/api/v1/integrations/status", (route) =>
    route.fulfill({
      json: {
        project_id: "p",
        connectors: [
          {
            id: "github",
            app: "GitHub",
            state: "not_connected",
            transport_wired: false,
            operations: 2
          },
          {
            id: "google-drive",
            app: "Google Drive",
            state: "not_connected",
            transport_wired: false,
            operations: 2
          },
          {
            id: "office",
            app: "Office",
            state: "not_connected",
            transport_wired: false,
            operations: 6
          }
        ]
      }
    })
  );
  await page.goto("/?surface=apps");
  const panel = page.locator(".capability-workspace");
  await expect(panel.getByRole("heading", { name: "Интеграции" })).toBeVisible();
  // Google Drive is implemented (not "planned") and links to its settings.
  const drive = panel.locator("article").filter({ hasText: "Google Drive" });
  await expect(drive).toContainText("Реализовано");
  await expect(drive).not.toContainText("Запланировано");
  await expect(drive.getByRole("link", { name: "Настроить Drive" })).toHaveAttribute(
    "href",
    "/personal-settings#drive-storage"
  );
  await expect(drive).toContainText("Ожидает подключения владельца");
  // Office is present from the connector registry.
  await expect(panel.locator("article").filter({ hasText: "Office" })).toContainText("Реализовано");
  // Telegram is still honestly marked as planned.
  await expect(panel.locator("article").filter({ hasText: "Telegram" })).toContainText(
    "Запланировано"
  );
});
