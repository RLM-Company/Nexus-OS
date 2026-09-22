import { expect, test } from "@playwright/test";

const storedSettings = (notificationsEnabled: boolean, allowPush = false) => ({
  version: 2,
  companion: {
    enabled: false,
    frequency: "balanced",
    max_proactive_per_day: 3,
    min_gap_minutes: 120,
    quiet_hours: { start: "22:00", end: "08:00", timezone: "UTC" },
    suppress_when_active: true,
    backoff_after_unanswered: 3,
    allow_push: allowPush,
    allow_telegram: false
  },
  communication: {
    tone: "natural",
    verbosity: "balanced",
    initiative: "balanced",
    natural_guardrail_enabled: true,
    avoid_canned_framing: true,
    prefer_concrete_examples: true,
    preserve_user_register: true
  },
  notifications_enabled: notificationsEnabled
});

test("clears a stale notification preference after browser permission is revoked", async ({
  page
}) => {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("cosmora:settings:v2", JSON.stringify(settings));
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "denied",
        requestPermission: async () => "denied"
      }
    });
  }, storedSettings(true, true));

  await page.goto("/settings");

  await expect(page.getByText("Заблокированы", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}") as {
          companion?: { allow_push?: unknown };
          notifications_enabled?: unknown;
        };
        return {
          notificationsEnabled: stored.notifications_enabled,
          allowPush: stored.companion?.allow_push
        };
      })
    )
    .toEqual({ notificationsEnabled: false, allowPush: false });
});

test("does not enable notifications merely because browser permission is already granted", async ({
  page
}) => {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("cosmora:settings:v2", JSON.stringify(settings));
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "granted",
        requestPermission: async () => "granted"
      }
    });
  }, storedSettings(false));

  await page.goto("/settings");

  await expect(page.getByText("Разрешены браузером", { exact: true })).toBeVisible();
  const persisted = await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}") as {
      notifications_enabled?: unknown;
    };
    return stored.notifications_enabled;
  });
  expect(persisted).toBe(false);
});

test("requires local notifications before proactive push consent can be enabled", async ({ page }) => {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("cosmora:settings:v2", JSON.stringify(settings));
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "granted",
        requestPermission: async () => "granted"
      }
    });
  }, storedSettings(false));

  await page.goto("/settings");

  const pushConsent = page.getByRole("checkbox", { name: "Разрешить proactive push" });
  await expect(pushConsent).toBeDisabled();

  await page.getByRole("button", { name: "Включить уведомления" }).click();
  await expect(pushConsent).toBeEnabled();
  await pushConsent.check();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}") as {
          companion?: { allow_push?: unknown };
          notifications_enabled?: unknown;
        };
        return {
          notificationsEnabled: stored.notifications_enabled,
          allowPush: stored.companion?.allow_push
        };
      })
    )
    .toEqual({ notificationsEnabled: true, allowPush: true });
});

