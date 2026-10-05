import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function createProject(request: APIRequestContext, title = "Project materials recovery") {
  const response = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: { initial_message: title, client_message_id: crypto.randomUUID() }
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { project: { id: string } }).project.id;
}

const panel = (page: Page) => page.getByRole("tabpanel", { name: "Контекст проекта" });
const save = (page: Page) =>
  panel(page).getByRole("button", { name: "Сохранить материалы", exact: true });
const reload = (page: Page) =>
  panel(page).getByRole("button", { name: "Загрузить сохранённую версию", exact: true });

test("recovers a stalled initial materials read without leaving the editor locked", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  const path = `**/api/v1/projects/${projectId}/materials`;
  await page.route(path, () => undefined);
  await page.goto(`/?project=${projectId}&view=context`);
  await expect(panel(page).getByRole("alert")).toContainText("Не удалось загрузить", {
    timeout: 9_000
  });
  await expect(save(page)).toBeDisabled();
  await expect(reload(page)).toBeEnabled();
  await page.unroute(path);
  await reload(page).click();
  await expect(page.getByLabel("Требования к проекту")).toBeEnabled();
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
});

test("requires confirmation before replacing an unsaved materials draft and preserves it on read failure", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  await page.goto(`/?project=${projectId}&view=context`);
  await page.getByLabel("Требования к проекту").fill("Keep my local requirements");
  await panel(page)
    .getByLabel("Текстовые файлы и код")
    .setInputFiles({
      name: "draft.md",
      mimeType: "text/plain",
      buffer: Buffer.from("Keep my local file")
    });
  await expect(panel(page).getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "draft.md"
  );
  await reload(page).click();
  await expect(panel(page).getByRole("group", { name: "Замена черновика" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Оставить черновик", exact: true }).click();
  await expect(page.getByLabel("Требования к проекту")).toHaveValue("Keep my local requirements");
  await page.route(`**/api/v1/projects/${projectId}/materials`, (route) =>
    route.fulfill({ status: 503, json: { error: "private-internal-error-marker" } })
  );
  await reload(page).click();
  await panel(page).getByRole("button", { name: "Заменить черновик", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("Не удалось загрузить");
  await expect(page.getByLabel("Требования к проекту")).toHaveValue("Keep my local requirements");
  await expect(panel(page).getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "draft.md"
  );
  await expect(save(page)).toBeEnabled();
  await expect(panel(page)).not.toContainText("private-internal-error-marker");
  await page.unroute(`**/api/v1/projects/${projectId}/materials`);
  await reload(page).click();
  await panel(page).getByRole("button", { name: "Заменить черновик", exact: true }).click();
  await expect(page.getByLabel("Требования к проекту")).toHaveValue("");
  await expect(panel(page).getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
});

test("reconciles a timed-out accepted save by reading without replaying the write", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  const path = `**/api/v1/projects/${projectId}/materials`;
  let writes = 0;
  await page.route(path, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    const accepted = await route.fetch();
    expect(accepted.ok()).toBe(true);
    // Persist on the real fixture API, but deliberately lose the browser response.
  });
  await page.goto(`/?project=${projectId}&view=context`);
  await page.getByLabel("Требования к проекту").fill("Accepted but response lost");
  await save(page).click();
  await expect(panel(page).getByRole("alert")).toContainText("Не удалось подтвердить сохранение", {
    timeout: 9_000
  });
  await expect(page.getByLabel("Требования к проекту")).toHaveValue("Accepted but response lost");
  await expect(save(page)).toBeDisabled();
  await expect(reload(page)).toBeEnabled();
  expect(writes).toBe(1);
  await reload(page).click();
  await panel(page).getByRole("button", { name: "Заменить черновик", exact: true }).click();
  await expect(save(page)).toBeEnabled();
  await expect(page.getByLabel("Требования к проекту")).toHaveValue("Accepted but response lost");
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  expect(writes).toBe(1);
});

test("rejects malformed or cross-project material reads before enabling edits", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  const base = {
    project_id: projectId,
    version: 0,
    instructions: "",
    attachments: [],
    updated_at: new Date().toISOString()
  };
  const invalid = [
    null,
    { ...base, project_id: "another-project", instructions: "foreign-material-marker" },
    { ...base, version: -1 },
    { ...base, version: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, attachments: [null] },
    { ...base, attachments: [{ name: "broken.txt", content: 123 }] },
    { ...base, instructions: "a".repeat(4001) },
    { ...base, attachments: [{ name: "large.txt", content: "a".repeat(8001) }] },
    {
      ...base,
      instructions: "я".repeat(4000),
      attachments: [1, 2].map((n) => ({ name: `${n}.txt`, content: "я".repeat(5000) }))
    },
    { ...base, updated_at: "invalid-date" }
  ];
  let index = 0;
  await page.route(`**/api/v1/projects/${projectId}/materials`, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(invalid[index]) })
  );
  await page.goto(`/?project=${projectId}&view=context`);
  for (index = 0; index < invalid.length; index++) {
    if (index) await reload(page).click();
    await expect(panel(page).getByRole("alert")).toContainText("Не удалось загрузить");
    await expect(save(page)).toBeDisabled();
    await expect(page.getByLabel("Требования к проекту")).toHaveValue("");
    await expect(panel(page)).not.toContainText("foreign-material-marker");
  }
});

for (const mismatch of ["project", "version", "instructions", "attachments"] as const) {
  test(`does not confirm a save with mismatched ${mismatch}`, async ({ page, request }) => {
    const projectId = await createProject(request);
    await page.route(`**/api/v1/projects/${projectId}/materials`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const sent = route.request().postDataJSON() as {
        version: number;
        instructions: string;
        attachments: unknown[];
      };
      await route.fulfill({
        json: {
          project_id: mismatch === "project" ? "another-project" : projectId,
          version: sent.version + (mismatch === "version" ? 0 : 1),
          instructions: mismatch === "instructions" ? "unexpected-server-edit" : sent.instructions,
          attachments:
            mismatch === "attachments"
              ? [{ name: "extra.txt", content: "unexpected-file" }]
              : sent.attachments,
          updated_at: new Date().toISOString()
        }
      });
    });
    await page.goto(`/?project=${projectId}&view=context`);
    await page.getByLabel("Требования к проекту").fill("My materials draft");
    await save(page).click();
    await expect(panel(page).getByRole("alert")).toContainText("Не удалось подтвердить сохранение");
    await expect(
      panel(page).getByRole("status").filter({ hasText: "Материалы сохранены" })
    ).toHaveCount(0);
    await expect(page.getByLabel("Требования к проекту")).toHaveValue("My materials draft");
    await expect(save(page)).toBeDisabled();
    await expect(reload(page)).toBeEnabled();
    await expect(panel(page)).not.toContainText("unexpected-server-edit");
    await expect(panel(page)).not.toContainText("unexpected-file");
  });
}

test("leaving a stalled save cannot overwrite the next project's material editor", async ({
  page,
  request
}) => {
  const first = await createProject(request);
  const secondTitle = `Materials target ${crypto.randomUUID()}`;
  const second = await createProject(request, secondTitle);
  await request.put(`http://127.0.0.1:3100/api/v1/projects/${second}/materials`, {
    data: { version: 0, instructions: "Second project requirements", attachments: [] }
  });
  let finish: (() => Promise<void>) | undefined;
  await page.route(`**/api/v1/projects/${first}/materials`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const response = await route.fetch();
    finish = async () => {
      await route.fulfill({ response }).catch(() => undefined);
    };
  });
  await page.goto(`/?project=${first}&view=context`);
  await page.getByLabel("Требования к проекту").fill("First project local draft");
  await save(page).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  // Use the sidebar to switch within the same mounted application.
  await page
    .locator(".sidebar .project-item")
    .filter({ has: page.locator("strong", { hasText: secondTitle }) })
    .click();
  await page.getByRole("tab", { name: "Контекст", exact: true }).click();
  await expect(page.getByLabel("Требования к проекту")).toHaveValue("Second project requirements");
  await finish!();
  await expect(page.getByLabel("Требования к проекту")).toHaveValue("Second project requirements");
  await expect(
    panel(page).getByRole("status").filter({ hasText: "Материалы сохранены" })
  ).toHaveCount(0);
});
