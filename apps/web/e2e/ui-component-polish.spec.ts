import { expect, test } from "@playwright/test";

test("GitHub import opens the prepared chat even when Code was saved", async ({ page }) => {
  const importId = "11111111-1111-4111-8111-111111111111";
  await page.addInitScript((id) => {
    localStorage.setItem("cosmora:workspace-surface", "code");
    sessionStorage.setItem(
      `cosmora:github-import:${id}`,
      JSON.stringify({
        attachment: { name: "router.ts", content: "export const route = true;" },
        prompt: "Проверь router.ts из GitHub"
      })
    );
  }, importId);
  await page.goto(`/?github_import=${importId}`);
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue("Проверь router.ts из GitHub");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("router.ts");
  await expect(page.getByRole("heading", { name: "Code", exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/github_import/);
});

test("file drop uses the bounded paperclip workflow without dispatch and survives reload", async ({
  page
}) => {
  let sent = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/v1\/(?:chats|projects)/.test(request.url())) sent++;
  });
  await page.goto("/");
  await expect(page.getByLabel("Сообщение Kosmora")).toBeEnabled();
  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["Демонстрация вложения"], "drop.txt", { type: "text/plain" }));
    return transfer;
  });
  await page.locator("form.composer").dispatchEvent("dragover", { dataTransfer: data });
  await expect(page.locator("form.composer")).toHaveAttribute("data-file-drag", "true");
  await page.locator("form.composer").dispatchEvent("drop", { dataTransfer: data });
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("drop.txt");
  await expect(page.locator("form.composer")).not.toHaveAttribute("data-file-drag");
  await page.reload();
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("drop.txt");
  expect(sent).toBe(0);
});

test("IME Enter does not send a partially composed message", async ({ page }) => {
  let sent = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/v1\/(?:chats|projects)/.test(request.url())) sent++;
  });
  await page.goto("/");
  const composer = page.getByLabel("Сообщение Kosmora");
  await composer.fill("中文 сообщение");
  await composer.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(composer).toHaveValue("中文 сообщение");
  expect(sent).toBe(0);
});
