import { expect, test, type Page, type Route } from "@playwright/test";
import { isWorkspaceWrite } from "./fixtures/navigation-writes";

async function scenario(
  page: Page,
  lostPublish: false | "after-start" | "before-start" = false,
  proof: {
    exitCode?: number | null;
    cleanupVerified?: boolean;
    status?: string;
    check_type?: "syntax" | "node-test";
  } = {},
  expectedReview: (review: number) => string = () => "export const value = 3;",
  repairCapability: boolean | number = false
) {
  let publications = 0;
  let checks = 0;
  let reviews = 0;
  let repairs = 0;
  let created = false;
  let run: Record<string, unknown> = {
    id: "run-1",
    version: 1,
    status: "proposed",
    ...(repairCapability
      ? {
          capabilities: { repair_once: typeof repairCapability === "number" ? repairCapability : 2 }
        }
      : {}),
    task: "Исправь неверный результат",
    base_branch: "main",
    base_sha: "a".repeat(40),
    proposal_hash: "p".repeat(64),
    proposal_snapshot_digest: "s".repeat(64),
    proposal_diff:
      "--- a/src/value.js\n+++ b/src/value.js\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
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
          client_request_id: expect.any(String),
          task: "Исправь неверный результат",
          base_branch: "main"
        });
        created = true;
        data = run;
      }
    } else if (url.pathname.endsWith("/invalidate-review")) {
      const input = route.request().postDataJSON();
      const parent =
        (run.draft as { plan: { review_hash: string } } | undefined)?.plan.review_hash ?? null;
      if (input.expected_review_hash !== parent) {
        await route.fulfill({ status: 409, json: { error: { code: "STALE_REVIEW" } } });
        return;
      }
      run = {
        ...run,
        status: run.draft ? "review" : "proposed",
        check: undefined,
        publication_token: undefined,
        proposal_check: undefined
      };
      data = run;
    } else if (url.pathname.endsWith("/preview-diff")) {
      const input = route.request().postDataJSON();
      expect(input.base_sha).toBe("a".repeat(40));
      expect(input.snapshot_digest).toBe("s".repeat(64));
      expect(input.proposal_hash).toBe(run.proposal_hash);
      expect(input.diff).toContain("@@ -1,9 +1,9 @@");
      data = {
        files: [
          {
            path: "src/value.js",
            before: "export const value = 1;",
            content: "export const value = 3;"
          }
        ],
        normalizedDiff: input.diff.replace("@@ -1,9 +1,9 @@", "@@ -1 +1 @@"),
        normalizations: [
          { path: "src/value.js", line: 3, before: "@@ -1,9 +1,9 @@", after: "@@ -1 +1 @@" }
        ],
        baseSha: "a".repeat(40),
        snapshotDigest: "s".repeat(64),
        resultDigest: "r".repeat(64)
      };
    } else if (url.pathname.endsWith("/review")) {
      const input = route.request().postDataJSON();
      const parent =
        (run.draft as { plan: { review_hash: string } } | undefined)?.plan.review_hash ?? null;
      if (input.expected_review_hash !== parent) {
        await route.fulfill({ status: 409, json: { error: { code: "STALE_REVIEW" } } });
        return;
      }
      reviews++;
      expect(input.proposal_hash).toBe(run.proposal_hash);
      expect(input.files).toEqual([{ path: "src/value.js", content: expectedReview(reviews) }]);
      run = {
        ...run,
        version: Number(run.version) + 1,
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
        version: Number(run.version) + 1,
        status: "checked",
        publication_token: "publication-token-1",
        check: {
          status: "passed",
          review_hash: hash,
          stdout: "syntax checked",
          exitCode: 0,
          cleanupVerified: true,
          journal: [{ event: "completed" }],
          ...proof
        }
      };
      data = run;
    } else if (url.pathname.endsWith("/repair")) {
      throw new Error("Versioned web must never dispatch the legacy paid repair route");
    } else if (url.pathname.endsWith("/repair-v2")) {
      const input = route.request().postDataJSON();
      if (input.expected_run_version !== run.version) {
        await route.fulfill({ status: 409, json: { error: { code: "STALE_CHECK" } } });
        return;
      }
      repairs++;
      expect(run.capabilities).toEqual({ repair_once: 2 });
      expect(repairs).toBe(1);
      const source = run.draft as { plan: { review_hash: string } };
      expect(route.request().postDataJSON()).toEqual({
        review_hash: source.plan.review_hash,
        expected_run_version: run.version,
        client_request_id: expect.stringMatching(/^[a-f0-9-]{36}$/u),
        approve: true
      });
      run = {
        ...run,
        status: "proposed",
        proposal_hash: "q".repeat(64),
        proposal: [
          {
            path: "src/value.js",
            before: "export const value = 1;",
            content: "export const value = 4;"
          }
        ],
        proposal_diff:
          "--- a/src/value.js\n+++ b/src/value.js\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 4;\n",
        repair_request: {
          review_hash: source.plan.review_hash,
          state: "proposed",
          source_snapshot_digest: "s".repeat(64),
          source_check: {
            ...(run.check as object),
            stdout: "syntax checked",
            stderr: "fixture failure"
          }
        },
        draft: undefined,
        check: undefined,
        publication_token: undefined
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
  return {
    publications: () => publications,
    checks: () => checks,
    repairs: () => repairs,
    snapshot: () => structuredClone(run),
    concurrentFailedCheck: () => {
      run = {
        ...run,
        version: Number(run.version) + 1,
        publication_token: undefined,
        check: {
          ...(run.check as object),
          check_type: "node-test",
          stderr: "another tab failed a different check"
        }
      };
    },
    concurrentReview: () => {
      const draft = run.draft as { plan: { review_hash: string; files: unknown[] } };
      run = {
        ...run,
        draft: {
          ...draft,
          plan: {
            ...draft.plan,
            review_hash: "remote-review",
            files: [{ path: "src/value.js", content: "export const value = 99;" }]
          }
        },
        publication_token: "remote-token"
      };
    }
  };
}

async function prepare(page: Page, navigate = true) {
  if (navigate) await page.goto("/code-agent");
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
  const terminal = page.getByRole("region", { name: "Вывод исполнителя" });
  expect(
    await terminal
      .getByRole("button", { name: "stdout", exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor)
  ).toBe("rgba(0, 0, 0, 0)");
  await terminal.getByRole("button", { name: "stderr", exact: true }).click();
  await expect(terminal).toContainText("Поток stderr пуст.");
  await expect(terminal.getByLabel("Стандартный вывод", { exact: true })).toHaveCount(0);
  await terminal.getByRole("button", { name: "stdout", exact: true }).click();
  await expect(terminal.getByLabel("Стандартный вывод", { exact: true })).toHaveText(
    "syntax checked"
  );
  await page.screenshot({ path: "../../qa/koswork-code-terminal.png", fullPage: true });
}
test("creates a Code project directly without starting a model task", async ({ page }) => {
  await scenario(page);
  let posts = 0;
  await page.route("**/api/v1/code-projects", async (route) => {
    const body = route.request().postDataJSON() as {
      client_project_id: string;
      title: string;
      approve_local_execution: boolean;
    };
    expect(body.approve_local_execution).toBe(true);
    posts++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        project: { id: body.client_project_id, title: body.title, status: "ACTIVE" }
      })
    });
  });
  await page.goto("/code-agent");
  await page.getByRole("button", { name: "Новый Code-проект", exact: true }).click();
  await expect(page.getByRole("option", { name: "Code-проект", exact: true })).toBeAttached();
  expect(posts).toBe(1);
  await expect(
    page.getByRole("button", { name: "Предложить исправление", exact: true })
  ).toBeDisabled();
});

test("recovers a lost creation response using its request ID without a second generation POST", async ({
  page
}) => {
  await scenario(page);
  let posts = 0;
  let requestId = "";
  await page.route("**/code-agent", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts++;
    requestId = (route.request().postDataJSON() as { client_request_id: string }).client_request_id;
    await route.abort("failed");
  });
  await page.goto("/code-agent");
  await page.getByLabel("Задача", { exact: true }).fill("Исправь неверный результат");
  await page.getByRole("button", { name: "Предложить исправление", exact: true }).click();
  await expect(page.getByLabel("Просмотр изменений")).toContainText("export const value = 1;");
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(posts).toBe(1);
});

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
  await expect(publish).toBeDisabled();
  await page.getByRole("button", { name: "Сохранить выбранные изменения" }).click();
  await page
    .getByRole("checkbox", { name: "Разрешаю запуск выбранной проверки для этих изменений" })
    .check();
  await page.getByRole("button", { name: "Запустить проверку", exact: true }).click();
  await expect(page.getByLabel("Результат проверки")).toContainText("syntax checked");
  await page
    .getByRole("checkbox", { name: "Подтверждаю создание этой ветки", exact: false })
    .check();
  await publish.click();
  await expect(page.getByRole("link", { name: "Открыть созданный PR" })).toHaveAttribute(
    "href",
    "https://github.com/RLM-Company/Nexus-OS/pull/1000"
  );
  expect(state.publications()).toBe(1);
  expect(state.checks()).toBe(2);
});

test("an old editor cannot overwrite or invalidate a newer saved review", async ({ page }) => {
  const state = await scenario(page, false, {}, (n) => `export const value = ${n === 1 ? 3 : 4};`);
  await prepare(page);
  state.concurrentReview();
  const before = state.snapshot();
  await page.getByLabel("+ Итоговое содержимое: src/value.js").fill("export const value = 4;");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Предложение или просмотр изменились"
  );
  await page.getByRole("button", { name: "Сохранить выбранные изменения" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Предложение или просмотр изменились"
  );
  await expect(page.getByLabel("+ Итоговое содержимое: src/value.js")).toHaveValue(
    "export const value = 4;"
  );
  expect(state.snapshot()).toEqual(before);
  expect(state.publications()).toBe(0);
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Загрузить сохранённые правки" }).click();
  await expect(page.getByLabel("+ Итоговое содержимое: src/value.js")).toHaveValue(
    "export const value = 4;"
  );
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Загрузить сохранённые правки" }).click();
  await expect(page.getByLabel("+ Итоговое содержимое: src/value.js")).toHaveValue(
    "export const value = 99;"
  );
  await page.getByLabel("+ Итоговое содержимое: src/value.js").fill("export const value = 4;");
  await page.getByRole("button", { name: "Сохранить выбранные изменения" }).click();
  await expect(page.getByText("Просмотр соответствует выбранным изменениям.")).toBeVisible();
  expect(state.snapshot().draft).toMatchObject({
    plan: { files: [{ path: "src/value.js", content: "export const value = 4;" }] }
  });
  expect(state.publications()).toBe(0);
});

test("explicit checkpoint restoration also discards unapplied raw diff without restoring old proof", async ({
  page
}) => {
  const state = await scenario(page);
  await prepare(page);
  await page.getByText("Редактировать минимальный diff", { exact: true }).click();
  const raw = page.getByLabel("Редактируемый unified diff");
  const original = await raw.inputValue();
  await raw.fill(original + "# unsaved raw draft\n");
  await expect.poll(() => state.snapshot().status).toBe("review");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Загрузить сохранённые правки" }).click();
  await expect(raw).toHaveValue(original + "# unsaved raw draft\n");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Загрузить сохранённые правки" }).click();
  await expect(raw).toHaveValue(original);
  await page.getByText("Редактировать минимальный diff", { exact: true }).click();
  await expect(raw).toBeVisible();
  expect(state.snapshot().check).toBeUndefined();
  expect(state.checks()).toBe(1);
  expect(state.publications()).toBe(0);
});

test("same-document Forward can be cancelled with exact edits retained, then explicitly confirmed", async ({
  page
}) => {
  const state = await scenario(page);
  await page.goto("/code-agent");
  await expect(page.getByRole("combobox", { name: "Проект", exact: true })).toHaveValue(
    "project-1"
  );
  const disconnected = (route: Route) =>
    route.fulfill({
      json: { configured: false, repository: "RLM-Company/Nexus-OS", default_branch: null }
    });
  await page.route("**/api/v1/github/status", disconnected);
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/github/status"
  );
  await page.getByRole("link", { name: "GitHub", exact: true }).click();
  await response;
  await expect(page).toHaveURL(/\/github$/);
  await page.unroute("**/api/v1/github/status", disconnected);
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/code-agent$/);
  await prepare(page, false);
  expect(await page.evaluate(() => "navigation" in window)).toBe(true);
  expect(
    await page.evaluate(() =>
      navigation.entries().some((entry) => entry.url?.endsWith("/github") && entry.sameDocument)
    )
  ).toBe(true);
  await page.route("**/api/v1/github/status", disconnected);
  await page.getByLabel("+ Итоговое содержимое: src/value.js").fill("export const value = 4;");
  await expect.poll(() => state.snapshot().status).toBe("review");
  let dialogs = 0;
  page.once("dialog", (dialog) => {
    dialogs++;
    void dialog.dismiss();
  });
  await page.evaluate(() => history.forward());
  await expect.poll(() => dialogs, { timeout: 5000 }).toBe(1);
  await expect(page).toHaveURL(/\/code-agent$/);
  await expect(page.getByLabel("+ Итоговое содержимое: src/value.js")).toHaveValue(
    "export const value = 4;"
  );
  await page.getByLabel("+ Итоговое содержимое: src/value.js").click();
  let accepted = 0;
  page.once("dialog", (dialog) => {
    accepted++;
    void dialog.accept();
  });
  await page.goForward();
  await expect.poll(() => accepted, { timeout: 5000 }).toBe(1);
  await expect(page).toHaveURL(/\/github$/);
  expect(state.publications()).toBe(0);
});

test("browser Back can be cancelled with edits visible, then explicitly confirmed without workspace writes", async ({
  page
}) => {
  await page.goto("/?surface=code");
  const link = page
    .locator(".coscode-space-tools")
    .getByRole("link", { name: "Репозиторий и изменения", exact: true });
  await expect(link).toHaveAttribute("href", "/code-agent");
  const state = await scenario(page);
  await link.click();
  await expect(page).toHaveURL(/\/code-agent$/);
  await prepare(page, false);
  expect(
    await page.evaluate(() =>
      navigation
        .entries()
        .some((entry) => entry.url && new URL(entry.url).pathname === "/" && entry.sameDocument)
    )
  ).toBe(true);
  const editor = page.getByLabel("+ Итоговое содержимое: src/value.js");
  await editor.fill("export const value = 4;");
  await editor.click();
  await expect.poll(() => state.snapshot().status).toBe("review");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (isWorkspaceWrite(request)) writes.push(request.url());
  });
  let declined = 0;
  page.once("dialog", (dialog) => {
    declined++;
    void dialog.dismiss();
  });
  await page.goBack({ waitUntil: "commit", timeout: 2000 }).catch(() => null);
  expect(declined).toBe(1);
  await expect(page).toHaveURL(/\/code-agent$/);
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue("export const value = 4;");
  await page.unroute("**/api/v1/**");
  await editor.click();
  let accepted = 0;
  page.once("dialog", (dialog) => {
    accepted++;
    void dialog.accept();
  });
  await page.goBack();
  expect(accepted).toBe(1);
  await expect(page).toHaveURL((url) => url.pathname === "/");
  expect(writes).toEqual([]);
  expect(state.publications()).toBe(0);
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

test("previews normalized editable diff on an exact snapshot before a fresh review", async ({
  page
}) => {
  const state = await scenario(page);
  await page.goto("/code-agent");
  await page.getByLabel("Задача", { exact: true }).fill("Исправь неверный результат");
  await page.getByRole("button", { name: "Предложить исправление" }).click();
  await page.getByText("Редактировать минимальный diff", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Редактируемый unified diff", exact: true })
    .fill(
      "--- a/src/value.js\n+++ b/src/value.js\n@@ -1,9 +1,9 @@\n-export const value = 1;\n+export const value = 3;\n"
    );
  await page
    .getByRole("button", { name: "Проверить diff и перенести в выбранные изменения" })
    .click();
  await expect(
    page.getByRole("group", { name: "Редактор unified diff", exact: true }).getByRole("status")
  ).toContainText("Diff применим. Исправлено заголовков: 1.");
  await expect(page.getByLabel("+ Итоговое содержимое: src/value.js")).toHaveValue(
    "export const value = 3;"
  );
  await expect(
    page.getByRole("checkbox", { name: "src/unrelated.js", exact: true })
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Сохранить выбранные изменения" }).click();
  await expect(page.getByRole("button", { name: "Создать черновик PR в GitHub" })).toBeDisabled();
  expect(state.checks()).toBe(0);
  expect(state.publications()).toBe(0);
});

for (const proof of [{ exitCode: 1 }, { exitCode: null }, { cleanupVerified: false }]) {
  test(`legacy contradictory proof never enables publication: ${JSON.stringify(proof)}`, async ({
    page
  }) => {
    const state = await scenario(page, false, proof);
    await prepare(page);
    await expect(page.getByLabel("Результат проверки")).toContainText(
      "Успех проверки не подтверждён"
    );
    await expect(
      page.getByRole("checkbox", { name: "Подтверждаю создание этой ветки", exact: false })
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "Создать черновик PR в GitHub" })).toBeDisabled();
    expect(state.publications()).toBe(0);
  });
}

test("dirty project changes and new tasks require an explicit discard; cancelling retains exact edits", async ({
  page
}) => {
  const state = await scenario(page);
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({
      json: {
        items: [
          { id: "project-1", title: "Первый" },
          { id: "project-2", title: "Второй" }
        ]
      }
    })
  );
  let creates = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.endsWith("/code-agent")) creates++;
  });
  await prepare(page);
  const editor = page.getByLabel("+ Итоговое содержимое: src/value.js");
  await editor.fill("export const value = 99;");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("combobox", { name: "Проект", exact: true }).selectOption("project-2");
  await expect(page.getByRole("combobox", { name: "Проект", exact: true })).toHaveValue(
    "project-1"
  );
  await expect(editor).toHaveValue("export const value = 99;");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Предложить исправление", exact: true }).click();
  expect(creates).toBe(1);
  await expect(editor).toHaveValue("export const value = 99;");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("combobox", { name: "Проект", exact: true }).selectOption("project-2");
  await expect(page.getByRole("combobox", { name: "Проект", exact: true })).toHaveValue(
    "project-2"
  );
  await expect(editor).toHaveValue("export const value = 3;");
  expect(state.publications()).toBe(0);
});

test("dirty history selection can be cancelled; confirmed discard opens only the selected saved task", async ({
  page
}) => {
  const state = await scenario(page);
  await prepare(page);
  const first = state.snapshot();
  const second = {
    ...first,
    id: "run-2",
    task: "Вторая задача",
    draft: undefined,
    check: undefined,
    publication_token: undefined
  };
  await page.route("**/api/v1/projects/*/code-agent", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { items: [first, second] } })
      : route.fallback()
  );
  await page.reload();
  const editor = page.getByLabel("+ Итоговое содержимое: src/value.js");
  await expect(editor).toHaveValue("export const value = 3;");
  await editor.fill("export const value = 99;");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("combobox", { name: "Сохранённые задачи" }).selectOption("run-2");
  await expect(page.getByRole("combobox", { name: "Сохранённые задачи" })).toHaveValue("run-1");
  await expect(editor).toHaveValue("export const value = 99;");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("combobox", { name: "Сохранённые задачи" }).selectOption("run-2");
  await expect(editor).toHaveValue("export const value = 2;");
  expect(state.publications()).toBe(0);
});

test("declining native reload preserves the unsaved text without a new model or publish call", async ({
  page
}) => {
  const state = await scenario(page, false, {}, (n) =>
    n === 1 ? "export const value = 3;" : "export const value = 99;"
  );
  let creates = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.endsWith("/code-agent")) creates++;
  });
  await prepare(page);
  const editor = page.getByLabel("+ Итоговое содержимое: src/value.js");
  await editor.fill("export const value = 99;");
  const dialogPromise = page.waitForEvent("dialog");
  const reload = page.evaluate(() => window.location.reload());
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await reload;
  await expect(editor).toHaveValue("export const value = 99;");
  await page.getByRole("button", { name: "Сохранить выбранные изменения", exact: true }).click();
  await expect(page.getByText("Правки ещё не сохранены.", { exact: false })).toHaveCount(0);
  await page.reload();
  await expect(editor).toHaveValue("export const value = 99;");
  expect(creates).toBe(1);
  expect(state.publications()).toBe(0);
});

test("the Code page GitHub link respects a declined discard", async ({ page }) => {
  await scenario(page);
  await prepare(page);
  const editor = page.getByLabel("+ Итоговое содержимое: src/value.js");
  await editor.fill("export const value = 99;");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("link", { name: "GitHub", exact: true }).click();
  await expect(page).toHaveURL(/\/code-agent$/);
  await expect(editor).toHaveValue("export const value = 99;");
});

test("explicit review checkpoint survives normal reload without another generation or publication", async ({
  page
}) => {
  const state = await scenario(page, false, {}, (n) =>
    n === 1 ? "export const value = 3;" : "export const value = 99;"
  );
  let creates = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.endsWith("/code-agent")) creates++;
  });
  await prepare(page);
  const editor = page.getByLabel("+ Итоговое содержимое: src/value.js");
  await editor.fill("export const value = 99;");
  await page.getByRole("button", { name: "Сохранить выбранные изменения", exact: true }).click();
  await expect(page.getByText("Правки ещё не сохранены.", { exact: false })).toHaveCount(0);
  await page.reload();
  await expect(editor).toHaveValue("export const value = 99;");
  expect(creates).toBe(1);
  expect(state.publications()).toBe(0);
});

test("unapplied raw diff remains dirty after saving selected files and can be discarded explicitly", async ({
  page
}) => {
  const state = await scenario(page);
  await prepare(page);
  await page.getByText("Редактировать минимальный diff", { exact: true }).click();
  const raw = page.getByLabel("Редактируемый unified diff", { exact: true });
  await raw.fill("UNAPPLIED LOCAL PATCH");
  await page.getByRole("button", { name: "Сохранить выбранные изменения", exact: true }).click();
  await expect(page.getByText("Текст diff ещё не перенесён", { exact: false })).toBeVisible();
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("link", { name: "GitHub", exact: true }).click();
  await expect(raw).toHaveValue("UNAPPLIED LOCAL PATCH");
  await page.getByRole("button", { name: "Отменить правки diff", exact: true }).click();
  await expect(page.getByText("Текст diff ещё не перенесён", { exact: false })).toHaveCount(0);
  await expect(page.getByLabel("+ Итоговое содержимое: src/value.js")).toHaveValue(
    "export const value = 3;"
  );
  await expect(page.getByRole("button", { name: "Создать черновик PR в GitHub" })).toBeDisabled();
  expect(state.checks()).toBe(1);
  expect(state.publications()).toBe(0);
});

test("an explicit saved-run link outside the latest twenty is fetched exactly without starting work", async ({
  page
}) => {
  const state = await scenario(page),
    template = state.snapshot();
  const id = "00000000-0000-4000-8000-000000000001";
  const linked = { ...template, id, task: "Точная старая задача" };
  let lookups = 0,
    posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST") posts++;
  });
  await page.route("**/api/v1/projects/*/code-agent", (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 20 }, (_, i) => ({
          ...template,
          id: `recent-${i}`,
          task: `Недавняя ${i}`
        }))
      }
    })
  );
  await page.route(`**/api/v1/projects/project-1/code-agent/${id}`, (route) => {
    lookups++;
    return route.fulfill({ json: linked });
  });
  await page.goto(`/code-agent?project=project-1&run=${id}`);
  await expect(
    page.getByRole("heading", { name: "Точная старая задача", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Сохранённые задачи" })).toHaveValue(id);
  expect(lookups).toBe(1);
  expect(posts).toBe(0);
  expect(state.publications()).toBe(0);
});

for (const missing of [true, false]) {
  test(`an unavailable or mismatched linked task cannot silently open the latest task: missing=${missing}`, async ({
    page
  }) => {
    const state = await scenario(page),
      template = state.snapshot();
    const id = "00000000-0000-4000-8000-000000000001";
    await page.route("**/api/v1/projects/*/code-agent", (route) =>
      route.fulfill({
        json: { items: [{ ...template, id: "recent", task: "Явно выбранная недавняя" }] }
      })
    );
    await page.route(`**/api/v1/projects/project-1/code-agent/${id}`, (route) =>
      route.fulfill({
        status: missing ? 404 : 200,
        json: missing ? { error: { code: "RUN_NOT_FOUND" } } : template
      })
    );
    await page.goto(`/code-agent?project=project-1&run=${id}`);
    await expect(page.getByRole("alert").first()).toContainText(
      missing ? "Запрошенная задача недоступна" : "Ответ не подтверждает запрошенную задачу"
    );
    await expect(page.getByRole("region", { name: "Состояние задачи" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Сохранённые задачи" })).toHaveValue("");
    await page.getByRole("combobox", { name: "Сохранённые задачи" }).selectOption("recent");
    await expect(
      page.getByRole("heading", { name: "Явно выбранная недавняя", exact: true })
    ).toBeVisible();
    expect(state.publications()).toBe(0);
  });
}

test("a late exact linked lookup cannot replace the selected project's task", async ({ page }) => {
  const state = await scenario(page),
    template = state.snapshot();
  const id = "00000000-0000-4000-8000-000000000001";
  let release!: () => void, arrived!: () => void, done!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const received = new Promise<void>((r) => {
    arrived = r;
  });
  const finished = new Promise<void>((r) => {
    done = r;
  });
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({
      json: {
        items: [
          { id: "project-1", title: "Первый" },
          { id: "project-2", title: "Второй" }
        ]
      }
    })
  );
  await page.route("**/api/v1/projects/*/code-agent", (route) =>
    route.fulfill({
      json: { items: [{ ...template, id: "new-task", task: "Текущая задача второго проекта" }] }
    })
  );
  await page.route(`**/api/v1/projects/project-1/code-agent/${id}`, async (route) => {
    arrived();
    try {
      await gate;
      await route.fulfill({ json: { ...template, id, task: "Старый поздний ответ" } });
    } finally {
      done();
    }
  });
  try {
    await page.goto(`/code-agent?project=project-1&run=${id}`);
    await received;
    await page.getByRole("combobox", { name: "Проект", exact: true }).selectOption("project-2");
    await expect(
      page.getByRole("heading", { name: "Текущая задача второго проекта", exact: true })
    ).toBeVisible();
  } finally {
    release();
  }
  await finished;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole("combobox", { name: "Проект", exact: true })).toHaveValue(
    "project-2"
  );
  await expect(
    page.getByRole("heading", { name: "Старый поздний ответ", exact: true })
  ).toHaveCount(0);
});

for (const delayedStage of ["preview-diff", "invalidate-review"]) {
  test(`leaving a patch editor fences its late ${delayedStage} without applying files to another task`, async ({
    page
  }) => {
    const state = await scenario(page),
      template = state.snapshot();
    const second = {
      ...template,
      id: "run-2",
      task: "Вторая задача",
      proposal: [
        {
          path: "src/value.js",
          before: "export const value = 70;",
          content: "export const value = 77;"
        }
      ]
    };
    let release!: () => void,
      arrived!: () => void,
      done!: () => void,
      previews = 0;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const received = new Promise<void>((r) => {
      arrived = r;
    });
    const finished = new Promise<void>((r) => {
      done = r;
    });
    await page.route("**/api/v1/projects/*/code-agent", (route) =>
      route.fulfill({ json: { items: [template, second] } })
    );
    await page.route(`**/code-agent/run-1/${delayedStage}`, async (route) => {
      const body = route.request().postDataJSON() as { diff: string };
      arrived();
      try {
        await gate;
        await route.fulfill({
          json:
            delayedStage === "invalidate-review"
              ? template
              : {
                  files: [
                    {
                      path: "src/value.js",
                      before: "export const value = 1;",
                      content: "export const value = 3;"
                    }
                  ],
                  normalizedDiff: body.diff,
                  normalizations: [],
                  snapshotDigest: "s".repeat(64),
                  resultDigest: "r".repeat(64),
                  baseSha: "a".repeat(40)
                }
        });
      } finally {
        done();
      }
    });
    page.on("request", (r) => {
      if (r.url().endsWith("/preview-diff")) previews++;
    });
    try {
      await page.goto("/code-agent");
      await page.getByText("Редактировать минимальный diff", { exact: true }).click();
      const raw = page.getByLabel("Редактируемый unified diff", { exact: true });
      await raw.fill((await raw.inputValue()).replace("value = 2", "value = 3"));
      await page
        .getByRole("button", {
          name: "Проверить diff и перенести в выбранные изменения",
          exact: true
        })
        .click();
      await received;
      page.once("dialog", (d) => d.accept());
      await page.getByRole("combobox", { name: "Сохранённые задачи" }).selectOption("run-2");
      await expect(page.getByLabel("+ Итоговое содержимое: src/value.js")).toHaveValue(
        "export const value = 77;"
      );
    } finally {
      release();
    }
    await finished;
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    );
    await expect(page.getByLabel("+ Итоговое содержимое: src/value.js")).toHaveValue(
      "export const value = 77;"
    );
    expect(previews).toBe(delayedStage === "preview-diff" ? 1 : 0);
    expect(state.publications()).toBe(0);
  });
}

test("an unavailable project from a link cannot fall back to another owned project's task", async ({
  page
}) => {
  const state = await scenario(page);
  let runReads = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("/code-agent")) runReads++;
  });
  await page.goto(
    "/code-agent?project=unavailable-project&run=00000000-0000-4000-8000-000000000001"
  );
  await expect(page.getByRole("alert").first()).toContainText(
    "Запрошенный проект недоступен владельцу"
  );
  await expect(page.getByRole("combobox", { name: "Проект", exact: true })).toHaveValue("");
  await expect(page.getByRole("region", { name: "Состояние задачи" })).toHaveCount(0);
  expect(runReads).toBe(1); // The document itself; no scoped Code API request was made.
  expect(state.publications()).toBe(0);
});

test("explicit bounded repair requires approval, shows a new diff and requires a fresh review", async ({
  page
}) => {
  const state = await scenario(
    page,
    false,
    { status: "failed", exitCode: 1, check_type: "syntax" },
    (n) => `export const value = ${n === 1 ? 3 : 4};`,
    true
  );
  await prepare(page);
  const repair = page.getByRole("button", {
    name: "Исправить по результату проверки",
    exact: true
  });
  await expect(repair).toBeDisabled();
  expect(state.repairs()).toBe(0);
  await page
    .getByRole("checkbox", { name: "Разрешаю одну дополнительную модельную попытку", exact: false })
    .check();
  await repair.click();
  await expect(page.getByLabel("Попытка исправления", { exact: true })).toContainText(
    "Новый diff подготовлен"
  );
  await expect(page.getByLabel("+ Итоговое содержимое: src/value.js")).toHaveValue(
    "export const value = 4;"
  );
  await expect(page.getByLabel("Проверка и публикация")).toHaveCount(0);
  await expect(repair).toHaveCount(0);
  await page.getByRole("button", { name: "Сохранить выбранные изменения" }).click();
  await expect(page.getByRole("button", { name: "Создать черновик PR в GitHub" })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel("Попытка исправления", { exact: true })).toContainText(
    "Попытка исправления использована"
  );
  await expect(repair).toHaveCount(0);
  expect(state.repairs()).toBe(1);
  expect(state.publications()).toBe(0);
  expect(state.checks()).toBe(1);
});

test("a server without repair capability never receives the new command", async ({ page }) => {
  const state = await scenario(page, false, {
    status: "failed",
    exitCode: 1,
    check_type: "syntax"
  });
  await prepare(page);
  await expect(
    page.getByRole("button", { name: "Исправить по результату проверки", exact: true })
  ).toHaveCount(0);
  expect(state.repairs()).toBe(0);
  expect(state.publications()).toBe(0);
});

test("an old failed-check approval conflicts until the owner reloads and approves the new result", async ({
  page
}) => {
  const state = await scenario(
    page,
    false,
    { status: "failed", exitCode: 1, check_type: "syntax" },
    () => "export const value = 3;",
    true
  );
  await prepare(page);
  const approve = page.getByRole("checkbox", {
    name: "Разрешаю одну дополнительную модельную попытку",
    exact: false
  });
  const repair = page.getByRole("button", {
    name: "Исправить по результату проверки",
    exact: true
  });
  await approve.check();
  state.concurrentFailedCheck();
  const before = state.snapshot();
  await repair.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Результат проверки изменился"
  );
  expect(state.snapshot()).toEqual(before);
  expect(state.repairs()).toBe(0);
  expect(state.publications()).toBe(0);
  await page.getByRole("button", { name: "Загрузить сохранённые правки", exact: true }).click();
  await expect(
    page.getByLabel("Исправление по результату проверки", { exact: true })
  ).toContainText("node --test");
  await expect(approve).not.toBeChecked();
  await expect(repair).toBeDisabled();
  await approve.check();
  await repair.click();
  await expect(page.getByLabel("+ Итоговое содержимое: src/value.js")).toHaveValue(
    "export const value = 4;"
  );
  expect(state.repairs()).toBe(1);
  expect(state.publications()).toBe(0);
});

test("legacy repair v1 capability never sends a versioned v2 command", async ({ page }) => {
  const state = await scenario(
    page,
    false,
    { status: "failed", exitCode: 1, check_type: "syntax" },
    () => "export const value = 3;",
    1
  );
  await prepare(page);
  await expect(
    page.getByRole("button", { name: "Исправить по результату проверки", exact: true })
  ).toHaveCount(0);
  expect(state.repairs()).toBe(0);
});

for (const variant of ["versioned", "legacy", "higher durable version"] as const) {
  test(`Code polling never rewinds a newer response: ${variant}`, async ({ page }, info) => {
    const state = await scenario(page);
    const initial: Record<string, unknown> = {
      ...state.snapshot(),
      status: "running",
      summary: "Initial snapshot"
    };
    if (variant === "legacy") delete initial.version;
    const olderRequest = {
      ...initial,
      ...(variant === "legacy" ? {} : { version: variant === "higher durable version" ? 5 : 2 }),
      summary: "Delayed first response"
    };
    const laterRequest = {
      ...initial,
      ...(variant === "legacy" ? {} : { version: variant === "higher durable version" ? 4 : 3 }),
      summary: "Second response already displayed"
    };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const mutations: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") mutations.push(new URL(request.url()).pathname);
    });
    await page.route("**/api/v1/projects/project-1/code-agent", (route) =>
      route.fulfill({ json: { items: [initial] } })
    );
    await page.route("**/api/v1/projects/project-1/code-agent/run-1", async (route) => {
      if (++reads === 1) {
        await held;
        await route.fulfill({ json: olderRequest });
      } else await route.fulfill({ json: laterRequest });
    });
    try {
      await page.goto("/code-agent");
      await expect(page.getByText(laterRequest.summary, { exact: true })).toBeVisible();
      const delayed = page.waitForResponse(
        async (response) =>
          response.url().endsWith("/code-agent/run-1") &&
          ((await response.json()) as { summary: string }).summary === olderRequest.summary
      );
      release();
      await (await delayed).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      const expected =
        variant === "higher durable version" ? olderRequest.summary : laterRequest.summary;
      const result = {
        variant,
        reads,
        mutations,
        displayed: await page
          .getByRole("region", { name: "Состояние задачи" })
          .locator("p")
          .allTextContents(),
        expected,
        real_model_called: false
      };
      const { writeFileSync } = await import("node:fs");
      const path = info.outputPath("snapshot-order-readback.json");
      writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
      await info.attach("snapshot-order-readback", { path, contentType: "application/json" });
      expect(result.displayed).toContain(expected);
      expect(mutations).toEqual([]);
    } finally {
      release();
    }
  });
}

test("Code manual refresh cannot replace a newer durable version with an older snapshot", async ({
  page
}, info) => {
  const state = await scenario(page);
  const fresh = { ...state.snapshot(), version: 8, summary: "Durable version 8" };
  const stale = { ...fresh, version: 7, summary: "Stale version 7" };
  await page.route("**/api/v1/projects/project-1/code-agent", (route) =>
    route.fulfill({ json: { items: [fresh] } })
  );
  await page.route("**/api/v1/projects/project-1/code-agent/run-1", (route) =>
    route.fulfill({ json: stale })
  );
  await page.goto("/code-agent");
  await expect(page.getByText(fresh.summary, { exact: true })).toBeVisible();
  const response = page.waitForResponse((reply) => reply.url().endsWith("/code-agent/run-1"));
  await page.getByRole("button", { name: "Обновить состояние", exact: true }).click();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  const result = {
    expected: fresh.summary,
    displayed: await page
      .getByRole("region", { name: "Состояние задачи" })
      .locator("p")
      .allTextContents(),
    real_model_called: false
  };
  const { writeFileSync } = await import("node:fs");
  const path = info.outputPath("manual-refresh-readback.json");
  writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
  await info.attach("manual-refresh-readback", { path, contentType: "application/json" });
  await expect(page.getByText(fresh.summary, { exact: true })).toBeVisible({ timeout: 1000 });
  await expect(
    page.getByRole("alert").filter({ hasText: "Получено устаревшее состояние задачи" })
  ).toContainText("устаревшее состояние");
});

test("Code keeps a late access refusal visible without rewinding the accepted snapshot", async ({
  page
}, info) => {
  const state = await scenario(page);
  const initial = {
    ...state.snapshot(),
    status: "running",
    version: 1,
    summary: "Initial access snapshot"
  };
  const fresh = { ...initial, version: 3, summary: "Last authorized snapshot" };
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") mutations.push(new URL(request.url()).pathname);
  });
  await page.route("**/api/v1/projects/project-1/code-agent", (route) =>
    route.fulfill({ json: { items: [initial] } })
  );
  await page.route("**/api/v1/projects/project-1/code-agent/run-1", async (route) => {
    if (++reads === 1) {
      await held;
      await route.fulfill({
        status: 403,
        json: { error: { code: "FORBIDDEN", message: "Доступ к задаче отозван." } }
      });
    } else await route.fulfill({ json: fresh });
  });
  try {
    await page.goto("/code-agent");
    await expect(page.getByText(fresh.summary, { exact: true })).toBeVisible();
    const refused = page.waitForResponse(
      (response) => response.url().endsWith("/code-agent/run-1") && response.status() === 403
    );
    release();
    await (await refused).finished();
    await expect(
      page.getByRole("alert").filter({ hasText: "Доступ к задаче отозван." })
    ).toBeVisible();
    await expect(page.getByText(fresh.summary, { exact: true })).toBeVisible();
    const result = {
      expected: fresh.summary,
      displayed: await page
        .getByRole("region", { name: "Состояние задачи" })
        .locator("p")
        .allTextContents(),
      access_refusal_visible: true,
      mutations,
      real_model_called: false
    };
    const { writeFileSync } = await import("node:fs");
    const path = info.outputPath("access-refusal-readback.json");
    writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
    await info.attach("access-refusal-readback", { path, contentType: "application/json" });
    expect(mutations).toEqual([]);
  } finally {
    release();
  }
});
