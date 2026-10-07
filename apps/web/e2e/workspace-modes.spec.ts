import { expect, test, type Page } from "@playwright/test";

const desktopMode = async (page: Page, mode: "Чат" | "Work" | "Code") => {
  await page.getByLabel("Режимы Kosmora", { exact: true }).click();
  await page
    .locator(".workspace-mode-menu")
    .getByRole("button", { name: new RegExp(`^${mode}(?:\\s|$)`) })
    .click();
  await expect(page.locator(".workspace-mode-menu")).not.toHaveAttribute("open");
};

test("brand mode disclosure supports keyboard closing and replaces duplicate navigation", async ({
  page
}) => {
  await page.goto("/");
  const trigger = page.getByLabel("Режимы Kosmora", { exact: true });
  const disclosure = page.locator(".workspace-mode-menu");
  await expect(trigger).toHaveAttribute("aria-controls", /.+/);
  await expect(
    page.locator(".sidebar-tools").getByRole("button", { name: /^(Work|Code)(?:\s|$)/ })
  ).toHaveCount(0);

  await trigger.focus();
  await trigger.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(disclosure.getByRole("button", { name: /^Чат(?:\s|$)/ })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(disclosure.getByRole("button", { name: /^Work(?:\s|$)/ })).toBeVisible();
  await expect(disclosure.getByRole("button", { name: /^Code(?:\s|$)/ })).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(disclosure).not.toHaveAttribute("open");
  await expect(trigger).toBeFocused();
});

test("switching Work and Code preserves an unsent chat draft and a shareable route", async ({
  page
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url());
  });
  await page.goto("/");
  const draft = "Подготовить презентацию Kosmora, сохранить этот черновик";
  await page.getByLabel("Сообщение Kosmora", { exact: true }).fill(draft);

  await desktopMode(page, "Work");
  await expect(page).toHaveURL(/(?:\?|&)surface=work(?:&|$)/);
  await expect(page.locator(".topbar h1")).toHaveText("Work");
  await desktopMode(page, "Code");
  await expect(page).toHaveURL(/(?:\?|&)surface=code(?:&|$)/);
  await page.reload();
  await expect(page.locator(".topbar h1")).toHaveText("Code");
  await desktopMode(page, "Чат");
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toHaveValue(draft);
  expect([null, "manager"]).toContain(new URL(page.url()).searchParams.get("surface"));
  expect(writes).toEqual([]);
});

test("mobile mode drawer returns to the existing chat draft", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const draft = "Мобильный черновик для презентации";
  await page.getByLabel("Сообщение Kosmora", { exact: true }).fill(draft);
  const nav = page.getByRole("navigation", { name: "Мобильная навигация" });
  const trigger = nav.getByRole("button", { name: "Режимы", exact: true });
  const drawer = page.getByRole("dialog", { name: "Ваше пространство" });

  for (const mode of ["Work", "Code", "Чат"] as const) {
    await trigger.click();
    await drawer
      .locator(".drawer-modes")
      .getByRole("button", { name: new RegExp(`^${mode}(?:\\s|$)`) })
      .click();
    await expect(drawer).toBeHidden();
  }
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toHaveValue(draft);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test("mode reload preserves the selected project and its unsent chat draft", async ({
  page,
  request
}) => {
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a local fixture project for restoring workspace modes.",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } }).project.id;
  await page.goto(`/?project=${encodeURIComponent(projectId)}&view=chat`);
  const composer = page.getByLabel("Сообщение менеджеру", { exact: true });
  await expect(composer).toBeEnabled();
  const draft = "Сохранить черновик в выбранном проекте после смены режимов";
  await composer.fill(draft);

  await desktopMode(page, "Work");
  expect(new URL(page.url()).searchParams.get("project")).toBe(projectId);
  await desktopMode(page, "Code");
  await expect(page.locator(".topbar h1")).toHaveText("Code");
  await page.reload();
  await expect(page.locator(".topbar h1")).toHaveText("Code");
  expect(new URL(page.url()).searchParams.get("project")).toBe(projectId);
  expect(new URL(page.url()).searchParams.get("surface")).toBe("code");

  await desktopMode(page, "Чат");
  await expect(composer).toHaveValue(draft);
  expect(new URL(page.url()).searchParams.get("project")).toBe(projectId);
  expect(new URL(page.url()).searchParams.get("view")).toBe("chat");
  expect(new URL(page.url()).searchParams.get("surface")).toBeNull();
});
