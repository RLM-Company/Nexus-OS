import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { StudioStoryboard } from "@cosmora/contracts";

test("saves, accepts, revises and downloads a text storyboard through Studio and the real API", async ({
  page
}) => {
  await page.goto("/?surface=video");
  const board = page.getByRole("region", { name: "Раскадровка" });
  const description = page.getByRole("textbox", { name: "Описание сцены" });
  await expect(page.getByRole("button", { name: "Сгенерировать видео" })).toBeDisabled();
  await description.fill("Камера приближается к станции");
  let writes = 0;
  await page.route("**/api/v1/media/storyboard", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    if (writes !== 1) return route.continue();
    const stored = await route.fetch();
    expect(stored.status()).toBe(200);
    await route.abort("failed");
  });
  const add = board.getByRole("button", { name: "Добавить сцену" });
  await add.click();
  await expect(board.getByRole("status")).toHaveText("Раскадровка сохранена.");
  expect(writes).toBe(1);
  await board.getByRole("button", { name: "Сцена 1", exact: true }).click();
  await board.getByRole("button", { name: "Принять версию 1" }).click();
  await expect(board.getByText("принята версия 1", { exact: false })).toBeVisible();
  await description.fill("Второй план");
  await add.click();
  await board.getByRole("button", { name: "Сцена 2", exact: true }).click();
  await description.fill("Второй план после правки");
  await page.getByRole("combobox", { name: "Длительность" }).selectOption("10");
  await board.getByRole("button", { name: "Сохранить новую версию сцены" }).click();
  await expect(board.getByText("Версия 2 · 10 с")).toBeVisible();
  await page.reload();
  await expect(board.getByText("принята версия 1", { exact: false })).toBeVisible();
  const download = page.waitForEvent("download");
  await board.getByRole("link", { name: "Скачать раскадровку JSON" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("kosmora-storyboard.json");
  const result = JSON.parse(await readFile(await file.path(), "utf8")) as StudioStoryboard;
  expect(result.format).toBe("kosmora.storyboard.v1");
  expect(result.scenes[0]?.accepted_version).toBe(1);
  expect(result.scenes[0]?.revisions[0]?.description).toBe("Камера приближается к станции");
  expect(result.scenes[1]?.revisions.map(({ duration_seconds }) => duration_seconds)).toEqual([
    5, 10
  ]);
});
