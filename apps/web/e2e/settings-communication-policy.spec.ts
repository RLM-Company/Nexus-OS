import { expect, test } from "@playwright/test";

test("persists all owner communication policy toggles", async ({ page }) => {
  await page.goto("/settings");

  const avoidCanned = page.getByRole("checkbox", { name: "Без шаблонных вступлений" });
  const concreteExamples = page.getByRole("checkbox", {
    name: "Предпочитать конкретные примеры"
  });
  const preserveRegister = page.getByRole("checkbox", { name: "Сохранять мой стиль общения" });

  await expect(avoidCanned).toBeChecked();
  await expect(concreteExamples).toBeChecked();
  await expect(preserveRegister).toBeChecked();

  await avoidCanned.uncheck();
  await concreteExamples.uncheck();
  await preserveRegister.uncheck();

  await page.reload();

  await expect(avoidCanned).not.toBeChecked();
  await expect(concreteExamples).not.toBeChecked();
  await expect(preserveRegister).not.toBeChecked();

  const stored = await page.evaluate(() => {
    const envelope = JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}") as {
      communication?: {
        avoid_canned_framing?: unknown;
        prefer_concrete_examples?: unknown;
        preserve_user_register?: unknown;
      };
    };
    return envelope.communication;
  });

  expect(stored).toMatchObject({
    avoid_canned_framing: false,
    prefer_concrete_examples: false,
    preserve_user_register: false
  });
});
