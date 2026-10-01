import { expect, test, type Page } from "@playwright/test";

const installShellFixture = async (
  page: Page,
  options?: { ownerSessionStatus?: number }
): Promise<void> => {
  const nearExpiry = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const laterExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (request.method() !== "GET") {
      await route.continue();
      return;
    }

    if (path === "/api/v1/projects" || path === "/api/v1/chats") {
      await route.fulfill({ json: { items: [] } });
      return;
    }

    if (path === "/api/v1/model-runtime") {
      await route.fulfill({
        json: {
          mode: "mock",
          provider: "mock",
          model: "owner-session-fixture",
          registry_version: "owner-session-registry",
          credential_configured: false,
          fallback_to_mock: false
        }
      });
      return;
    }

    if (path === "/api/v1/operations/status") {
      await route.fulfill({ json: { process_stop: null } });
      return;
    }

    if (path === "/api/v1/identity/sessions") {
      if ((options?.ownerSessionStatus ?? 200) !== 200) {
        await route.fulfill({
          status: options?.ownerSessionStatus ?? 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "raw-owner-session-error-marker" } })
        });
        return;
      }

      await route.fulfill({
        json: {
          items: [
            {
              session_id: "current-owner-session",
              owner_id: "owner",
              actor_id: "owner",
              assurance: "multi_factor",
              status: "active",
              issued_at: "2026-09-30T21:02:42.963Z",
              expires_at: nearExpiry,
              last_seen_at: "2026-10-01T20:30:00.000Z",
              revoked_at: null,
              revoked_by: null,
              revoke_reason: null,
              actor_kind: "owner",
              current: true
            },
            {
              session_id: "secondary-owner-session",
              owner_id: "owner",
              actor_id: "owner",
              assurance: "single_factor",
              status: "active",
              issued_at: "2026-09-29T21:02:42.963Z",
              expires_at: laterExpiry,
              last_seen_at: "2026-10-01T18:00:00.000Z",
              revoked_at: null,
              revoked_by: null,
              revoke_reason: null,
              actor_kind: "owner",
              current: false
            },
            {
              session_id: "agent-session-must-not-count",
              owner_id: "owner",
              actor_id: "agent",
              assurance: "single_factor",
              status: "active",
              issued_at: "2026-09-29T21:02:42.963Z",
              expires_at: laterExpiry,
              last_seen_at: "2026-10-01T18:00:00.000Z",
              revoked_at: null,
              revoked_by: null,
              revoke_reason: null,
              actor_kind: "agent",
              current: false
            }
          ]
        }
      });
      return;
    }

    await route.continue();
  });
};

test("shows server-confirmed owner session readiness in Settings", async ({ page }) => {
  await installShellFixture(page);
  await page.goto("/?surface=settings");

  const status = page.getByTestId("owner-session-status");
  await expect(status).toContainText("Сессия активна");
  await expect(status).toContainText("Многофакторная проверка");
  await expect(page.getByText("Активных сессий владельца: 2")).toBeVisible();
  await expect(page.getByText(/Срок действия текущей сессии близок к завершению/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("current-owner-session");
  await expect(page.locator("body")).not.toContainText("agent-session-must-not-count");
});

test("fails closed when owner session status is unavailable", async ({ page }) => {
  await installShellFixture(page, { ownerSessionStatus: 503 });
  await page.goto("/?surface=settings");

  const status = page.getByTestId("owner-session-status");
  await expect(status).toContainText("Недоступно");
  await expect(status).toContainText("Текущая сессия не подтверждена");
  await expect(page.getByText(/Сервер не подтвердил состояние текущей сессии/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Компактная навигация" })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText("raw-owner-session-error-marker");
});
