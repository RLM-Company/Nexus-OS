import { expect, test } from "@playwright/test";

test(
  "deduplicates rapid Agent Studio catalog submits before React re-renders",
  async ({ page }) => {
  let functionPosts = 0;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (
      request.method() === "POST" &&
      url.pathname === "/api/v1/projects/submit-lock-fixture/agent-studio/functions"
    ) {
      functionPosts += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({})
      });
      return;
    }

    if (request.method() === "GET" && url.pathname.includes("/agent-studio/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] })
    });
  });

  await page.goto("/agent-studio?project=submit-lock-fixture");
  await expect(page.getByText("Versioned catalog")).toBeVisible();

  await page.locator("#function-name").fill("Race-safe function");
  await page.locator("#function-description").fill("Prevents duplicate browser submissions.");
  await page.locator("#function-result-contract").fill("Return one immutable result.");

  const functionForm = page.locator("form").filter({ has: page.locator("#function-name") });
  await functionForm.evaluate((form) => {
    const htmlForm = form as HTMLFormElement;
    htmlForm.requestSubmit();
    htmlForm.requestSubmit();
  });

  await expect(page.getByText("Функция создана как immutable v1.")).toBeVisible();
  expect(functionPosts).toBe(1);
  }
);
