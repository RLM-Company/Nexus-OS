import { expect, test } from "@playwright/test";
test("ordinary chat keeps the retired web-search control hidden and does not search or generate on editing", async ({
  page
}) => {
  let searches = 0,
    modelRequests = 0;
  await page.route("**/api/v1/web-search**", async (route) => {
    if (route.request().method() === "POST") searches++;
    const body = route.request().url().endsWith("/status")
      ? { configured: true }
      : {
          query: "TypeScript documentation",
          searched_at: "2026-10-04T00:00:00Z",
          items: [
            {
              title: "TypeScript",
              url: "https://www.typescriptlang.org/docs/",
              snippet: "Official documentation"
            }
          ]
        };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/v1\/chats/.test(request.url())) modelRequests++;
  });
  await page.goto("/");
  await expect(page.getByLabel("Поиск", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Поисковый запрос", { exact: true })).toHaveCount(0);
  await page.getByLabel("Сообщение Kosmora", { exact: true }).fill("TypeScript documentation");
  await expect(page.getByRole("button", { name: "Поиск в чате", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  // Explicit source search/attachment is covered through Studio's actual entry point
  // in studio-search-sources.spec.ts; the removed composer control must not return.
  expect(searches).toBe(0);
  expect(modelRequests).toBe(0);
});
