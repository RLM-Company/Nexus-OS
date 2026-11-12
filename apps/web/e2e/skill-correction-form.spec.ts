import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const api = "http://127.0.0.1:3100";

test("correction form is inert until the owner explicitly confirms", async ({ page, request }) => {
  await page.goto("/skills");
  const form = page.getByRole("region", { name: "Подтверждение исправления" });
  await expect(form).toBeVisible();

  const text = `Отвечай тезисами ${randomUUID().slice(0, 8)}`;
  await form.getByLabel("Что исправить").fill(text);
  await form.getByRole("button", { name: "Предложить правило" }).click();

  const preview = form.getByLabel("Черновик правила");
  await expect(preview).toContainText("не сохранено");
  await expect(preview).toContainText(text);

  // Inert: the propose step must not create any Skill.
  const before = await request.get(`${api}/api/v1/owner-skills`);
  const beforeItems = (await before.json()) as { items: unknown[] };
  const countBefore = beforeItems.items.length;

  await preview.getByRole("button", { name: "Подтвердить и сохранить" }).click();
  await expect(form.getByRole("status")).toContainText("подтверждено");

  const after = await request.get(`${api}/api/v1/owner-skills`);
  const afterItems = (await after.json()) as { items: { name: string }[] };
  expect(afterItems.items.length).toBe(countBefore + 1);
  expect(afterItems.items.some((item) => item.name === "Правка владельца")).toBe(true);
});
