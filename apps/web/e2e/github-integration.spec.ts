import { expect, test, type Page } from "@playwright/test";

test("requires review approval before publishing the exact prepared GitHub draft", async ({
  page
}) => {
  let publications = 0;
  const publishedPrUrl = "https://github.com/RLM-Company/Nexus-OS/pull/1000";
  const draft = {
    id: "review-one",
    project_id: "github-project",
    status: "review",
    pr_url: null as string | null,
    plan: {
      repository: "RLM-Company/Nexus-OS",
      base_sha: "a".repeat(40),
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
      draft.pr_url = publishedPrUrl;
      body = draft;
    } else if (url.pathname.endsWith("/github-drafts"))
      body = route.request().method() === "POST" ? draft : { items: [] };
    else if (url.pathname === "/api/v1/projects")
      body = { items: [{ id: "github-project", title: "Код" }] };
    else if (url.pathname.endsWith("/status"))
      body = {
        configured: true,
        repository: "RLM-Company/Nexus-OS",
        default_branch: "main",
        workspace_scope: "1".repeat(64)
      };
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
  await page.getByRole("treeitem", { name: "app.ts", exact: true }).click();
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
    publishedPrUrl
  );
  expect(publications).toBe(1);
});

async function mockWorkspace(
  page: Page,
  options: { lostPublish?: boolean; manyFiles?: boolean } = {}
) {
  let publications = 0;
  const draft = {
    id: "saved",
    project_id: "github-project",
    status: "review",
    pr_url: null as string | null,
    plan: {
      repository: "RLM-Company/Nexus-OS",
      base_sha: "a".repeat(40),
      base_branch: "main",
      branch: "cosmora/change-saved",
      review_hash: "f".repeat(64),
      title: "Add empty file",
      files: [{ path: "src/empty.ts", before: null as string | null, content: "" }]
    }
  };
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith("/publish")) {
      publications++;
      if (options.lostPublish) {
        await route.abort("failed");
        return;
      }
      draft.status = "published";
      draft.pr_url = "https://github.com/RLM-Company/Nexus-OS/pull/1000";
      body = draft;
    } else if (url.pathname.endsWith("/reconcile")) {
      draft.status = "published";
      draft.pr_url = "https://github.com/RLM-Company/Nexus-OS/pull/1000";
      body = draft;
    } else if (url.pathname.endsWith("/github-drafts/saved")) {
      if (options.lostPublish) {
        await route.abort("failed");
        return;
      }
      body = draft;
    } else if (url.pathname.endsWith("/github-drafts")) {
      if (route.request().method() === "POST") {
        const input = route.request().postDataJSON() as { files: typeof draft.plan.files };
        expect(input.files).toEqual([{ path: "src/empty.ts", content: "" }]);
        body = draft;
      } else body = { items: options.lostPublish ? [draft] : [] };
    } else if (url.pathname === "/api/v1/projects")
      body = { items: [{ id: "github-project", title: "Код" }] };
    else if (url.pathname.endsWith("/status"))
      body = {
        configured: true,
        repository: "RLM-Company/Nexus-OS",
        default_branch: "main",
        workspace_scope: "1".repeat(64)
      };
    else if (url.pathname.endsWith("/branches"))
      body = { items: [{ name: "main", sha: "a".repeat(40) }], limited: false };
    else if (url.pathname.endsWith("/tree"))
      body = {
        sha: "a".repeat(40),
        truncated: false,
        items: Array.from({ length: options.manyFiles ? 501 : 2 }, (_, i) => ({
          path: i === 0 ? "app.ts" : `src/file-${i}.ts`,
          type: "blob",
          mode: "100644",
          sha: "c".repeat(40)
        }))
      };
    else body = { content: "const value = 1;" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
  return { publications: () => publications };
}

test("protects unstaged text and allows empty new files to be reviewed", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/github");
  await expect(page.getByLabel("Разрешённый репозиторий")).toHaveValue("RLM-Company/Nexus-OS");
  await page.getByRole("treeitem", { name: "app.ts", exact: true }).click();
  await page.getByLabel("Содержимое файла").fill("unsaved text");
  await expect(page.getByRole("treeitem", { name: "src/file-1.ts", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Ветка репозитория")).toBeDisabled();
  await page.getByRole("button", { name: "Обновить подключение" }).click();
  await expect(page.getByLabel("Содержимое файла")).toHaveValue("unsaved text");
  await expect(page.getByRole("button", { name: "Новый файл", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Отменить правки в редакторе" }).click();
  await expect(page.getByLabel("Содержимое файла")).toHaveValue("const value = 1;");
  await page.getByRole("button", { name: "Новый файл", exact: true }).click();
  await page.getByLabel("Путь нового файла").fill("app.ts");
  await expect(page.getByRole("button", { name: "Добавить изменение" })).toBeDisabled();
  await page.getByLabel("Путь нового файла").fill("src/empty.ts");
  await page.getByRole("button", { name: "Добавить изменение" }).click();
  await page.getByLabel("Проект для изменений").selectOption("github-project");
  await page.getByLabel("Описание изменения").fill("Add empty file");
  await page.getByRole("button", { name: "Просмотреть перед отправкой" }).click();
  await expect(page.getByLabel("Проверка изменений")).toContainText("Новый файл");
  await expect(page.getByRole("button", { name: "Создать черновик PR в GitHub" })).toBeDisabled();
});

test("blocks a second publication when both the POST response and recovery read are lost", async ({
  page
}) => {
  const workspace = await mockWorkspace(page, { lostPublish: true });
  await page.goto("/github");
  await page.getByLabel("Проект для изменений").selectOption("github-project");
  await page.getByLabel("Сохранённые изменения").selectOption("saved");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Создать черновик PR в GitHub" }).click();
  await expect(page.getByRole("button", { name: "Создать черновик PR в GitHub" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Результат отправки требует проверки");
  expect(workspace.publications()).toBe(1);
  await page.getByLabel("Сохранённые изменения").selectOption("");
  await page.getByLabel("Сохранённые изменения").selectOption("saved");
  await expect(page.getByRole("button", { name: "Создать черновик PR в GitHub" })).toHaveCount(0);
  await page.getByRole("button", { name: "Проверить результат в GitHub" }).click();
  await expect(page.getByRole("link", { name: "Открыть созданный PR" })).toBeVisible();
  expect(workspace.publications()).toBe(1);
});

test("reveals files past the first 500 and reports a GitHub read refusal", async ({ page }) => {
  await mockWorkspace(page, { manyFiles: true });
  await page.goto("/github");
  const files = page.getByRole("navigation", { name: "Файлы репозитория" });
  await expect(files.getByRole("treeitem", { name: "src/file-500.ts", exact: true })).toHaveCount(
    0
  );
  await files.getByRole("button", { name: "Показать ещё файлы (1)" }).click();
  await expect(files.getByRole("treeitem", { name: "src/file-500.ts", exact: true })).toBeVisible();
  await page.route("**/api/v1/github/file?*", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "GITHUB_ACCESS_DENIED" } })
    })
  );
  await files.getByRole("treeitem", { name: "src/file-500.ts", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("GitHub отказал в доступе");
  await expect(page.getByLabel("Содержимое файла")).toHaveCount(0);
});

test("Code opens the real repository workspace", async ({ page }) => {
  await page.goto("/?surface=code");
  await expect(page.getByRole("link", { name: "Открыть GitHub" })).toHaveAttribute(
    "href",
    "/github"
  );
  await page.getByRole("link", { name: "Открыть GitHub" }).click();
  await expect(page.getByRole("heading", { name: "GitHub ещё не подключён" })).toBeVisible();
});
test("keeps the live editor and reviewed diff within a mobile viewport", async ({ page }) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/github");
  await page.getByRole("button", { name: "Новый файл", exact: true }).click();
  await page.getByLabel("Путь нового файла").fill("src/empty.ts");
  await page.getByRole("button", { name: "Добавить изменение" }).click();
  await page.getByLabel("Проект для изменений").selectOption("github-project");
  await page.getByLabel("Описание изменения").fill("Add empty file");
  await page.getByRole("button", { name: "Просмотреть перед отправкой" }).click();
  await expect(page.getByLabel("Проверка изменений")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({ path: "test-results/github-workspace-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.screenshot({ path: "test-results/github-workspace-desktop.png", fullPage: true });
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
      ? {
          configured: true,
          repository: "RLM-Company/Nexus-OS",
          default_branch: "main",
          workspace_scope: "1".repeat(64)
        }
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
  await page.getByRole("treeitem", { name: "src/example.ts", exact: true }).click();
  await expect(page.getByLabel("Содержимое файла")).toHaveValue("export const value = 42;");
  await page.getByRole("button", { name: "Открыть файл в чате" }).click();
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue(/src\/example.ts/);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("example.ts");
  expect(sends).toBe(0);
});
