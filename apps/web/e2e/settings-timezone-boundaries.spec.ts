import { expect, test } from "@playwright/test";

const overrideBrowserTimezone = async (
  page: import("@playwright/test").Page,
  timezone: string
): Promise<void> => {
  await page.addInitScript((mockTimezone) => {
    const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Object.defineProperty(Intl.DateTimeFormat.prototype, "resolvedOptions", {
      configurable: true,
      value() {
        return {
          ...originalResolvedOptions.call(this),
          timeZone: mockTimezone
        };
      }
    });
  }, timezone);
};

for (const timezone of ["", "x".repeat(65)]) {
  test(`falls back to UTC for invalid browser timezone length ${timezone.length}`, async ({
    page
  }) => {
    await overrideBrowserTimezone(page, timezone);
    await page.goto("/settings");

    await expect
      .poll(() =>
        page.evaluate(() => {
          const stored = JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}") as {
            companion?: { quiet_hours?: { timezone?: unknown } };
          };
          return stored.companion?.quiet_hours?.timezone;
        })
      )
      .toBe("UTC");
  });
}

test("preserves a browser timezone at the contract maximum length", async ({ page }) => {
  const timezone = "x".repeat(64);
  await overrideBrowserTimezone(page, timezone);
  await page.goto("/settings");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}") as {
          companion?: { quiet_hours?: { timezone?: unknown } };
        };
        return stored.companion?.quiet_hours?.timezone;
      })
    )
    .toBe(timezone);
});
