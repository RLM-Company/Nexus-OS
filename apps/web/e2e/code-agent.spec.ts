import { expect, test, type Page } from "@playwright/test";

async function scenario(page: Page, lostPublish: false | "after-start" | "before-start" = false) {
  let publications = 0;
  let checks = 0;
  let reviews = 0;
  let created = false;
  let run: Record<string, unknown> = {
    id: "run-1",
    status: "proposed",
    task: "Исправь неверный результат",
    base_branch: "main",
    base_sha: "a".repeat(40),
    proposal_hash: "p".repeat(64),
    proposal: [
      {
        path: "src/value.js",
        before: "export const value = 1;",
        content: "export const value = 2;"
      },
      { path: "src/unrelated.js", before: "// original", content: "// changed" }
    ],
    log: [{ at: "2026-10-08T00:00:00Z", event: "repository_read" }]
  };
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown;
    if (url.pathname === "/api/v1/projects")
      data = { items: [{ id: "project-1", title: "Проект" }] };
    else if (url.pathname === "/api/v1/github/status")
      data = { configured: true, repository: "RLM-Company/Nexus-OS", default_branch: "main" };
    else if (url.pathname.endsWith("/code-agent")) {
      if (route.request().method() === "GET") data = { items: created ? [run] : [] };
      else {
        expect(route.request().postDataJSON()).toEqual({
          task: "Исправь неверный результат",
          base_branch: "main"
        });
        created = true;
        data = run;
      }
    } else if (url.pathname.endsWith("/review")) {
      reviews++;
      const input = route.request().postDataJSON();
      expect(input.proposal_hash).toBe("p".repeat(64));
      expect(input.files).toEqual([{ path: "src/value.js", content: "export const value = 3;" }]);
      run = {
        ...run,
        status: "review",
        check: undefined,
        draft: {
          id: "draft-1",
          status: "review",
          plan: {
            review_hash: `review-${reviews}`,
            branch: "cosmora/change-draft-1",
            title: "Исправление результата",
            files: input.files
          }
        }
      };
      data = run;
    } else if (url.pathname.endsWith("/check")) {
      checks++;
      const hash = (run.draft as { plan: { review_hash: string } }).plan.review_hash;
      expect(route.request().postDataJSON()).toEqual({
        review_hash: hash,
        check: "syntax",
        approve: true
      });
      run = {
        ...run,
        status: "checked",
        publication_token: "publication-token-1",
        check: {
          status: "passed",
          review_hash: hash,
          stdout: "syntax checked",
          journal: [{ event: "completed" }]
        }
      };
      data = run;
    } else if (url.pathname.endsWith("/publish")) {
      publications++;
      const draft = run.draft as { plan: { review_hash: string } };
      expect(route.request().postDataJSON()).toEqual({
        review_hash: draft.plan.review_hash,
        publication_token: run.publication_token,
        approve: true
      });
      if (lostPublish && publications === 1) {
        if (lostPublish === "after-start") run = { ...run, status: "uncertain" };
        await route.abort("failed");
        return;
      }
      run = {
        ...run,
        status: "published",
        draft: {
          ...draft,
          status: "published",
          pr_url: "https://github.com/RLM-Company/Nexus-OS/pull/1000"
        }
      };
      data = run;
    } else if (url.pathname.endsWith("/reconcile")) {
      if (lostPublish === "before-start") {
        run = { ...run, status: "checked", publication_token: "publication-token-2" };
        data = run;
      } else {
        run = {
          ...run,
          status: "published",
          draft: {
            ...(run.draft as object),
            status: "published",
            pr_url: "https://github.com/RLM-Company/Nexus-OS/pull/1000"
          }
        };
        data = run;
      }
    } else data = run;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data)
    });
  });
  return { publications: () => publications, checks: () => checks };
}

async function prepare(page: Page) {
  await page.goto("/code-agent");
  await page.getByLabel("Задача", { exact: true }).fill("Исправь неверный результат");
  await page.getByRole("button", { name: "Предложить исправление" }).click();
  await expect(page.getByLabel("Просмотр изменений")).toContainText("export const value = 1;");
  await page.getByRole("checkbox", { name: "src/unrelated.js", exact: true }).uncheck();
  await page.getByLabel("+ Итоговое содержимое: src/value.js").fill("export const value = 3;");
  await page.getByRole("button", { name: "Сохранить выбранные изменения" }).click();
  const check = page.getByRole("button", { name: "Запустить проверку", exact: true });
  await expect(check).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Разрешаю запуск выбранной проверки для этих изменений" })
    .check();
  await check.click();
  await expect(page.getByLabel("Результат проверки")).toContainText("syntax checked");
}

test("selects and edits real server proposal, binds check to review and requires exact publication approval", async ({
  page
}) => {
  const state = await scenario(page);
  await prepare(page);
  const publish = page.getByRole("button", { name: "Создать черновик PR в GitHub" });
  await expect(publish).toBeDisabled();
  expect(state.publications()).toBe(0);
  await page.getByLabel("+ Итоговое содержимое: src/value.js").fill("export const value = 4;");
  await expect(
    page.getByRole("checkbox", { name: "Подтверждаю создание этой ветки", exact: false })
  ).toBeDisabled();
  await expect(publish).toBeDisabled();
  await page.getByLabel("+ Итоговое содержимое: src/value.js").fill("export const value = 3;");
  await page
    .getByRole("checkbox", { name: "Подтверждаю создание этой ветки", exact: false })
    .check();
  await publish.click();
  await expect(page.getByRole("link", { name: "Открыть созданный PR" })).toHaveAttribute(
    "href",
    "https://github.com/RLM-Company/Nexus-OS/pull/1000"
  );
  expect(state.publications()).toBe(1);
  expect(state.checks()).toBe(1);
});

test("does not retry lost publication and reconciles it explicitly", async ({ page }) => {
  const state = await scenario(page, "after-start");
  await prepare(page);
  await page
    .getByRole("checkbox", { name: "Подтверждаю создание этой ветки", exact: false })
    .check();
  await page.getByRole("button", { name: "Создать черновик PR в GitHub" }).click();
  await expect(page.getByRole("button", { name: "Создать черновик PR в GitHub" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Сверить результат с GitHub" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Создать черновик PR в GitHub" })).toBeDisabled();
  await page.getByRole("button", { name: "Сверить результат с GitHub" }).click();
  await expect(page.getByRole("link", { name: "Открыть созданный PR" })).toBeVisible();
  expect(state.publications()).toBe(1);
});

test("reconciles a request lost before publication, then uses rotated token only after new approval", async ({
  page
}) => {
  const state = await scenario(page, "before-start");
  await prepare(page);
  const approval = page.getByRole("checkbox", {
    name: "Подтверждаю создание этой ветки",
    exact: false
  });
  const publish = page.getByRole("button", { name: "Создать черновик PR в GitHub" });
  await approval.check();
  await publish.click();
  await page.getByRole("button", { name: "Сверить результат с GitHub" }).click();
  await expect(approval).not.toBeChecked();
  await expect(publish).toBeDisabled();
  expect(state.publications()).toBe(1);
  await approval.check();
  await publish.click();
  await expect(page.getByRole("link", { name: "Открыть созданный PR" })).toBeVisible();
  expect(state.publications()).toBe(2);
});
