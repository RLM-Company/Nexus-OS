import { test, expect, type Page } from "@playwright/test";

const state = "s".repeat(43),
  proof = "p".repeat(43),
  key = "kosmora.drive.connection.v1";
const endpoint = "/api/v1/storage/drive";
const view = (connected = false, configured = true) => ({
  configured,
  state: configured ? (connected ? "connected" : "disconnected") : "unavailable",
  can_disconnect: connected,
  can_retry: false,
  archive_count: 0,
  pending_count: 0
});
async function fixture(page: Page, configured = true) {
  let connected = false,
    finishes = 0;
  const bodies: unknown[] = [];
  await page.route("**/api/v1/storage/drive**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let result: object = view(connected, configured);
    if (path.endsWith("/connect"))
      result = {
        state,
        proof,
        authorization_url: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
        expires_at: Date.now() + 600000
      };
    if (path.endsWith("/finish")) {
      finishes++;
      const body = request.postDataJSON() as { denied?: boolean };
      bodies.push(body);
      connected = !body.denied;
      result = { ...view(connected), result: body.denied ? "cancelled" : "connected" };
    }
    if (path.endsWith("/disconnect")) {
      connected = false;
      result = view();
    }
    await route.fulfill({ json: result });
  });
  return { finishes: () => finishes, bodies };
}

test("Drive consent returns to the same tab, completes once, and disconnects", async ({
  page
}, testInfo) => {
  const api = await fixture(page);
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Google consent fixture</h1>" })
  );
  await page.goto("/personal-settings#drive-storage");
  await page.getByRole("button", { name: "Подключить Google Drive", exact: true }).click();
  await page.waitForURL("https://accounts.google.com/**");
  await page.goto(`/personal-settings#drive_state=${state}&drive_code=fixture-code`);
  const panel = page.locator("#drive-storage");
  await expect(panel.getByText("Google Drive подключён.", { exact: true })).toBeVisible();
  expect(api.finishes()).toBe(1);
  expect(api.bodies).toEqual([{ state, proof, code: "fixture-code" }]);
  await expect(page).toHaveURL(/#drive-storage$/);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
  await panel.screenshot({ path: testInfo.outputPath("drive-settings.png") });
  await panel.getByRole("button", { name: "Отключить Google Drive" }).click();
  await expect(
    panel.getByText("Подключение отключено. Копии на вашем Drive сохранены.")
  ).toBeVisible();
});

test("a copied callback in another tab cannot finish without that tab's proof", async ({
  context
}) => {
  const page = await context.newPage(),
    api = await fixture(page);
  await page.goto(`/personal-settings#drive_state=${state}&drive_code=fixture-code`);
  await expect(page.locator("#drive-storage").getByRole("alert")).toContainText(
    "Начните вход в Google заново в этой вкладке"
  );
  expect(api.finishes()).toBe(0);
  await expect(page).toHaveURL(/#drive-storage$/);
});

test("Google denial is shown without connecting and consumes the proof", async ({ page }) => {
  const api = await fixture(page);
  await page.addInitScript(
    ({ key, state, proof }) => sessionStorage.setItem(key, JSON.stringify({ state, proof })),
    { key, state, proof }
  );
  await page.goto(`/personal-settings#drive_state=${state}&drive_error=denied`);
  await expect(page.locator("#drive-storage").getByText("Подключение отменено.")).toBeVisible();
  expect(api.finishes()).toBe(1);
  expect(api.bodies).toEqual([{ state, proof, denied: true }]);
});

test("unconfigured Drive is shown honestly without an active connect action", async ({ page }) => {
  await fixture(page, false);
  await page.goto("/personal-settings#drive-storage");
  const panel = page.locator("#drive-storage");
  await expect(panel.getByText("Подключение пока недоступно", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Подключить Google Drive", exact: true })
  ).toHaveCount(0);
});
