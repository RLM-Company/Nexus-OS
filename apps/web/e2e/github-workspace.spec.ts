import { expect, test, type Page } from "@playwright/test";
import { workspaceKey } from "../src/app/github/github-workspace";
const base = "a".repeat(40),
  changedBase = "e".repeat(40),
  scope = "1".repeat(64),
  appBlob = "c".repeat(40),
  otherBlob = "d".repeat(40),
  changedBlob = "f".repeat(40);
type Plan = {
  repository: string;
  base_branch: string;
  base_sha: string;
  branch: string;
  review_hash: string;
  title: string;
  files: Array<{ path: string; before: string | null; content: string }>;
};
type Draft = { id: string; project_id: string; status: string; pr_url: string | null; plan: Plan };
async function fixture(page: Page) {
  const state = {
    head: base,
    scope,
    repository: "RLM-Company/Nexus-OS",
    denied: false,
    rateLimited: false,
    losePublication: false,
    loseRead: false,
    knownPr: false,
    publications: 0,
    preparations: [] as Array<{
      base_sha: string;
      files: Array<{ path: string; content: string }>;
    }>,
    refs: [] as string[]
  };
  const drafts = new Map<string, Draft>();
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown;
    let status = 200;
    if (path === "/api/v1/github/status") {
      if (state.denied) {
        status = 403;
        body = { error: { code: "GITHUB_ACCESS_DENIED" } };
      } else
        body = {
          configured: true,
          repository: state.repository,
          default_branch: "main",
          workspace_scope: state.scope
        };
    } else if (path === "/api/v1/github/branches") {
      const pageNumber = Number(url.searchParams.get("page") ?? 1);
      if (pageNumber === 2 && state.rateLimited) {
        status = 429;
        body = { error: { code: "GITHUB_RATE_LIMITED" } };
      } else
        body = {
          items:
            pageNumber === 1
              ? [
                  { name: "main", sha: state.head },
                  { name: "dev", sha: base }
                ]
              : [{ name: "feature/after-100", sha: state.head }],
          page: pageNumber,
          next_page: pageNumber === 1 ? 2 : null,
          limited: false
        };
    } else if (path === "/api/v1/github/tree") {
      state.refs.push(url.searchParams.get("ref")!);
      body = {
        sha: state.head,
        truncated: false,
        items: [
          {
            path: "app.ts",
            type: "blob",
            mode: "100644",
            sha: state.head === base ? appBlob : changedBlob
          },
          { path: "other.ts", type: "blob", mode: "100644", sha: otherBlob }
        ]
      };
    } else if (path === "/api/v1/github/file") {
      body = {
        content:
          url.searchParams.get("sha") === changedBlob
            ? "remote value"
            : url.searchParams.get("sha") === otherBlob
              ? "original other"
              : "original app"
      };
    } else if (path === "/api/v1/projects")
      body = { items: [{ id: "project", title: "Code project" }] };
    else if (path.endsWith("/github-drafts")) {
      if (route.request().method() === "GET") body = { items: [...drafts.values()] };
      else {
        const input = route.request().postDataJSON() as {
          base_sha: string;
          base_branch: string;
          title: string;
          workspace_scope: string;
          files: Array<{ path: string; content: string }>;
        };
        state.preparations.push(input);
        if (input.base_sha !== state.head) {
          status = 409;
          body = { error: { code: "GITHUB_BASE_CHANGED" } };
        } else {
          expect(input.workspace_scope).toBe(state.scope);
          const id = `draft-${state.preparations.length}`;
          const draft: Draft = {
            id,
            project_id: "project",
            status: "review",
            pr_url: null,
            plan: {
              repository: state.repository,
              base_branch: input.base_branch,
              base_sha: input.base_sha,
              branch: `cosmora/change-${id}`,
              review_hash: String(state.preparations.length).repeat(64),
              title: input.title,
              files: input.files.map((item) => ({
                ...item,
                before:
                  item.path === "app.ts"
                    ? state.head === base
                      ? "original app"
                      : "remote value"
                    : item.path === "other.ts"
                      ? "original other"
                      : null
              }))
            }
          };
          drafts.set(id, draft);
          body = draft;
        }
      }
    } else if (path.includes("/github-drafts/")) {
      const parts = path.split("/");
      const id = parts[parts.indexOf("github-drafts") + 1]!;
      const draft = drafts.get(id)!;
      if (path.endsWith("/publish")) {
        state.publications++;
        expect(route.request().postDataJSON()).toEqual({
          approve: true,
          review_hash: draft.plan.review_hash
        });
        if (state.losePublication) {
          await route.abort("failed");
          return;
        }
        draft.status = "published";
        draft.pr_url = "https://github.com/RLM-Company/Nexus-OS/pull/1000";
        body = draft;
      } else if (path.endsWith("/reconcile")) {
        if (state.knownPr) {
          draft.status = "published";
          draft.pr_url = "https://github.com/RLM-Company/Nexus-OS/pull/1000";
        }
        body = draft;
      } else {
        if (state.loseRead) {
          await route.abort("failed");
          return;
        }
        body = draft;
      }
    } else body = { items: [] };
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return state;
}
async function edit(page: Page, path: string, content: string) {
  await page
    .getByRole("navigation", { name: "Файлы репозитория" })
    .getByRole("treeitem", { name: path, exact: true })
    .click();
  await page.getByLabel("Содержимое файла").fill(content);
  await page.getByRole("button", { name: "Добавить изменение" }).click();
}
async function create(page: Page, path: string, content: string) {
  await page.getByRole("button", { name: "Новый файл", exact: true }).click();
  await page.getByLabel("Путь нового файла").fill(path);
  await page.getByLabel("Содержимое файла").fill(content);
  await page.getByRole("button", { name: "Добавить изменение" }).click();
}
async function review(page: Page, title = "Several files") {
  await page.getByLabel("Проект для изменений").selectOption("project");
  await page.getByLabel("Описание изменения").fill(title);
  await page.getByRole("button", { name: "Просмотреть перед отправкой" }).click();
  await expect(page.getByLabel("Проверка изменений")).toBeVisible();
}
async function saved(page: Page, field: string, value: unknown) {
  await expect
    .poll(() =>
      page.evaluate(({ key, field }) => JSON.parse(sessionStorage.getItem(key) ?? "{}")[field], {
        key: workspaceKey,
        field
      })
    )
    .toEqual(value);
}
test("reviews a complete multi-file set, removes a file and invalidates approval on another edit", async ({
  page
}) => {
  const state = await fixture(page);
  await page.goto("/github");
  await edit(page, "app.ts", "my app");
  await edit(page, "other.ts", "my other");
  await create(page, "src/one.ts", "one");
  await create(page, "src/empty.ts", "");
  await page
    .getByRole("button", { name: "other.ts", exact: true })
    .last()
    .locator("..")
    .getByRole("button", { name: "Убрать", exact: true })
    .click();
  await review(page);
  expect(state.preparations[0]!.files).toEqual([
    { path: "app.ts", content: "my app" },
    { path: "src/one.ts", content: "one" },
    { path: "src/empty.ts", content: "" }
  ]);
  const preview = page.getByLabel("Проверка изменений");
  await expect(preview.locator("details")).toHaveCount(3);
  await expect(preview).toContainText(base);
  await page.getByRole("checkbox").check();
  await page.getByLabel("Содержимое файла").fill("now nonempty");
  await expect(page.getByLabel("Проверка изменений")).toHaveCount(0);
  await page.getByRole("button", { name: "Добавить изменение" }).click();
  await page.getByRole("button", { name: "Просмотреть перед отправкой" }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Создать черновик PR в GitHub" }).click();
  await expect(page.getByRole("link", { name: "Открыть созданный PR" })).toBeVisible();
  expect(state.publications).toBe(1);
  await saved(page, "changes", []);
  await page.reload();
  await expect(page.getByRole("link", { name: "Открыть созданный PR" })).toBeVisible();
  expect(state.publications).toBe(1);
});
test("restores staged and unstaged files, original base, project and title after reload without restoring approval", async ({
  page
}) => {
  const state = await fixture(page);
  await page.goto("/github");
  await edit(page, "app.ts", "staged");
  await page.getByLabel("Проект для изменений").selectOption("project");
  await page.getByLabel("Описание изменения").fill("Reload material");
  await page.getByRole("button", { name: "Новый файл", exact: true }).click();
  await page.getByLabel("Путь нового файла").fill("src/новый.ts");
  await page.getByLabel("Содержимое файла").fill("unstaged text");
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(key) ?? "{}").file?.content,
        workspaceKey
      )
    )
    .toBe("unstaged text");
  await page.reload();
  await expect(page.getByLabel("Содержимое файла")).toHaveValue("unstaged text");
  await expect(page.getByLabel("Путь нового файла")).toHaveValue("src/новый.ts");
  await expect(page.getByLabel("Проект для изменений")).toHaveValue("project");
  await expect(page.getByLabel("Описание изменения")).toHaveValue("Reload material");
  await saved(page, "base_sha", base);
  expect(state.preparations).toHaveLength(0);
  expect(state.publications).toBe(0);
  await page.getByRole("button", { name: "Добавить изменение" }).click();
  await page.getByRole("button", { name: "Просмотреть перед отправкой" }).click();
  await page.getByRole("checkbox").check();
  await saved(page, "draft_id", "draft-1");
  await page.getByRole("button", { name: "Обновить подключение" }).click();
  await expect(page.getByLabel("Проверка изменений")).toBeVisible();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  await page.reload();
  await expect(page.getByLabel("Проверка изменений")).toBeVisible();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  expect(state.publications).toBe(0);
});
for (const changed of ["scope", "repository"] as const)
  test(`does not mix recovered text after ${changed} changes`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto("/github");
    await edit(page, "app.ts", "private old text");
    await saved(page, "changes", [
      { path: "app.ts", content: "private old text", before: "original app" }
    ]);
    if (changed === "scope") state.scope = "2".repeat(64);
    else state.repository = "Other/Repo";
    await page.reload();
    await expect(page.getByText(/Сохранённые правки относятся к другому/)).toBeVisible();
    await expect(page.getByLabel("Содержимое файла")).toHaveCount(0);
    await saved(page, "changes", []);
    expect(state.preparations).toHaveLength(0);
  });
test("keeps material during denied access and recovers it when the same binding returns", async ({
  page
}) => {
  const state = await fixture(page);
  await page.goto("/github");
  await edit(page, "app.ts", "preserved during denial");
  await saved(page, "changes", [
    { path: "app.ts", content: "preserved during denial", before: "original app" }
  ]);
  state.denied = true;
  await page.reload();
  await expect(page.locator("main").getByRole("alert")).toContainText("GitHub отказал");
  await expect(page.getByLabel("Содержимое файла")).toHaveCount(0);
  state.denied = false;
  await page.getByRole("button", { name: "Обновить подключение" }).click();
  await expect(page.getByLabel("Содержимое файла")).toHaveValue("preserved during denial");
  expect(state.publications).toBe(0);
});
test("keeps the original base across reload and requires an explicit conflict decision before a fresh review", async ({
  page
}) => {
  const state = await fixture(page);
  await page.goto("/github");
  await edit(page, "app.ts", "my conflicting text");
  await saved(page, "changes", [
    { path: "app.ts", content: "my conflicting text", before: "original app" }
  ]);
  state.head = changedBase;
  await page.reload();
  await expect(page.getByText(/Исходная база изменилась/)).toBeVisible();
  await saved(page, "base_sha", base);
  await expect(page.getByLabel("Содержимое файла")).toHaveValue("my conflicting text");
  await page.getByRole("button", { name: "Проверить новую базу" }).click();
  const conflicts = page.getByLabel("Конфликты новой базы");
  await expect(conflicts).toContainText("remote value");
  await expect(conflicts).toContainText("my conflicting text");
  await page.getByRole("button", { name: "Оставить мой текст: app.ts" }).click();
  await saved(page, "base_sha", changedBase);
  await review(page, "Resolve base");
  expect(state.preparations[0]!.base_sha).toBe(changedBase);
  await expect(page.getByLabel("Проверка изменений")).toContainText("remote value");
  expect(state.publications).toBe(0);
});
test("retries rate-limited branch pages without losing the selected branch or material", async ({
  page
}) => {
  const state = await fixture(page);
  await page.goto("/github");
  await edit(page, "app.ts", "kept");
  state.rateLimited = true;
  await page.getByRole("button", { name: "Следующие ветки" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Лимит запросов");
  await expect(page.getByLabel("Ветка репозитория")).toHaveValue("main");
  await expect(page.getByLabel("Содержимое файла")).toHaveValue("kept");
  state.rateLimited = false;
  await page.getByRole("button", { name: "Следующие ветки" }).click();
  await expect(page.getByText("Страница веток 2")).toBeVisible();
  await page.getByRole("button", { name: "Очистить набор файлов" }).click();
  await page.getByLabel("Ветка репозитория").selectOption("feature/after-100");
  await expect.poll(() => state.refs.at(-1)).toBe("feature/after-100");
  await page.getByRole("button", { name: "Предыдущие ветки" }).click();
  await expect(page.getByLabel("Ветка репозитория")).toHaveValue("feature/after-100");
});
test("retains a read-only publication lock over reload even if a recovery read still reports review", async ({
  page
}) => {
  const state = await fixture(page);
  await page.goto("/github");
  await edit(page, "app.ts", "publish once");
  await review(page);
  state.losePublication = true;
  state.loseRead = true;
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Создать черновик PR в GitHub" }).click();
  await saved(page, "publication", "uncertain");
  state.loseRead = false;
  await page.reload();
  await expect(page.getByRole("button", { name: "Создать черновик PR в GitHub" })).toHaveCount(0);
  await page.getByRole("button", { name: "Проверить результат в GitHub" }).click();
  await expect(page.getByRole("button", { name: "Создать черновик PR в GitHub" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Просмотреть перед отправкой" })).toBeDisabled();
  expect(state.publications).toBe(1);
  state.knownPr = true;
  await page.getByRole("button", { name: "Проверить результат в GitHub" }).click();
  await expect(page.getByRole("link", { name: "Открыть созданный PR" })).toBeVisible();
  expect(state.publications).toBe(1);
});
test("reports unavailable tab storage, keeps current text and blocks an untracked publication", async ({
  page
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new Error("quota");
    };
  });
  const state = await fixture(page);
  await page.goto("/github");
  await edit(page, "app.ts", "still in editor");
  await review(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Создать черновик PR в GitHub" }).click();
  await expect(page.getByText(/Отправка не начата: не удалось сохранить/)).toBeVisible();
  await expect(page.getByLabel("Содержимое файла")).toHaveValue("still in editor");
  expect(state.publications).toBe(0);
  state.denied = true;
  await page.getByRole("button", { name: "Обновить подключение" }).click();
  await expect(page.getByLabel("Содержимое файла")).toHaveCount(0);
  state.denied = false;
  await page.getByRole("button", { name: "Обновить подключение" }).click();
  await expect(page.getByLabel("Содержимое файла")).toHaveValue("still in editor");
});
test("rejects duplicate new paths and a multi-file byte overflow before creating a review", async ({
  page
}) => {
  const state = await fixture(page);
  await page.goto("/github");
  await create(page, "src/one.ts", "one");
  await page.getByRole("button", { name: "Новый файл", exact: true }).click();
  await page.getByLabel("Путь нового файла").fill("src/one.ts");
  await page.getByLabel("Содержимое файла").fill("different");
  await expect(page.getByRole("button", { name: "Добавить изменение" })).toBeDisabled();
  await expect(page.getByText("Пути файлов должны быть уникальными.")).toBeVisible();
  await page.getByRole("button", { name: "Отменить правки в редакторе" }).click();
  await page.getByRole("button", { name: "Очистить набор файлов" }).click();
  for (let i = 0; i < 3; i++) await create(page, `src/${i}.ts`, "a".repeat(40001));
  await page.getByRole("button", { name: "Новый файл", exact: true }).click();
  await page.getByLabel("Путь нового файла").fill("src/large.ts");
  await page.getByLabel("Содержимое файла").fill("a".repeat(40001));
  await expect(page.getByRole("button", { name: "Добавить изменение" })).toBeDisabled();
  await expect(page.getByText("Общий объём изменений превышает 160 КБ.")).toBeVisible();
  expect(state.preparations).toHaveLength(0);
});
test("fits multi-file review with long paths into the mobile screen", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/github");
  await edit(page, "app.ts", "mobile app");
  await create(page, `src/${"long-name".repeat(20)}.ts`, "mobile new");
  await review(page, "Mobile multi-file review");
  await expect(page.getByLabel("Проверка изменений").locator("details")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({
    path: "test-results/github-workspace-stage2-mobile.png",
    fullPage: true
  });
});
