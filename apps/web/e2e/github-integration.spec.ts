import { expect, test } from "@playwright/test";

test("requires review approval before publishing the exact prepared GitHub draft", async ({
  page
}) => {
  let publications = 0;
  const draft = {
    id: "review-one",
    project_id: "github-project",
    status: "review",
    pr_url: null as string | null,
    plan: {
      base_branch: "main",
      branch: "cosmora/change-review-one",
      review_hash: "f".repeat(64),
      title: "Fix value",
      files: [{ path: "app.ts", before: "const value = 1;", content: "const value = 2;" }]
    }
  };
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith("/publish")) {
      publications++;
      expect(route.request().postDataJSON()).toEqual({
        approve: true,
        review_hash: draft.plan.review_hash
      });
      draft.status = "published";
      draft.pr_url = "https://github.com/RLM-Company/Nexus-OS/pull/1000";
      body = draft;
    } else if (url.pathname.endsWith("/github-drafts"))
      body = route.request().method() === "POST" ? draft : { items: [] };
    else if (url.pathname === "/api/v1/projects")
      body = { items: [{ id: "github-project", title: "Код" }] };
    else if (url.pathname.endsWith("/status"))
      body = { configured: true, repository: "RLM-Company/Nexus-OS", default_branch: "main" };
    else if (url.pathname.endsWith("/branches"))
      body = { items: [{ name: "main", sha: "a".repeat(40) }] };
    else if (url.pathname.endsWith("/tree"))
      body = {
        sha: "a".repeat(40),
        items: [{ path: "app.ts", type: "blob", mode: "100644", sha: "c".repeat(40) }],
        truncated: false
      };
    else body = { content: "const value = 1;" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
  await page.goto("/github");
  await page.getByRole("button", { name: "app.ts", exact: true }).click();
  await page.getByLabel("Содержимое файла").fill("const value = 2;");
  await page.getByRole("button", { name: "Добавить изменение" }).click();
  await page.getByLabel("Проект для изменений").selectOption("github-project");
  await page.getByLabel("Описание изменения").fill("Fix value");
  await page.getByRole("button", { name: "Просмотреть перед отправкой" }).click();
  await expect(page.getByLabel("Проверка изменений")).toContainText("const value = 1;");
  const send = page.getByRole("button", { name: "Создать черновик PR в GitHub" });
  await expect(send).toBeDisabled();
  expect(publications).toBe(0);
  await page.getByRole("checkbox").check();
  await send.click();
  await expect(page.getByRole("link", { name: "Открыть созданный PR" })).toHaveAttribute(
    "href",
    draft.pr_url!
  );
  expect(publications).toBe(1);
});

test("live GitHub UI starts disconnected without fabricating repository data", async ({ page }) => {
  await page.goto("/github");
  await expect(page.getByRole("heading", { name: "GitHub ещё не подключён" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Файлы репозитория" })).toHaveCount(0);
});

test("reads code into a chat draft and does not start a model request", async ({ page }) => {
  await page.route("**/api/v1/github/**", async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith("/status")
      ? { configured: true, repository: "RLM-Company/Nexus-OS", default_branch: "main" }
      : url.pathname.endsWith("/branches")
        ? { items: [{ name: "main", sha: "a".repeat(40) }] }
        : url.pathname.endsWith("/tree")
          ? {
              sha: "a".repeat(40),
              items: [
                { path: "src/example.ts", type: "blob", mode: "100644", sha: "c".repeat(40) }
              ],
              truncated: false
            }
          : { content: "export const value = 42;" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
  let sends = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/v1\/chats/.test(request.url())) sends++;
  });
  await page.goto("/github");
  await page.getByRole("button", { name: "src/example.ts", exact: true }).click();
  await expect(page.getByLabel("Содержимое файла")).toHaveValue("export const value = 42;");
  await page.getByRole("button", { name: "Открыть файл в чате" }).click();
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue(/src\/example.ts/);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("example.ts");
  expect(sends).toBe(0);
});
