import { expect, test } from "@playwright/test";
test("searches on request and attaches sources without submitting a model message", async ({
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
  expect(searches).toBe(0);
  await page.getByText("Поиск в интернете", { exact: true }).click();
  await page.getByLabel("Поисковый запрос").fill("TypeScript documentation");
  await page.getByRole("button", { name: "Найти источники" }).click();
  await expect(page.getByRole("link", { name: "TypeScript", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Приложить источники к сообщению" }).click();
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "web-sources.md"
  );
  expect(searches).toBe(1);
  expect(modelRequests).toBe(0);
});
