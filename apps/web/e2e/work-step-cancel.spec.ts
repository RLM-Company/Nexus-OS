import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { WorkDag } from "@cosmora/contracts";

async function fixture(request: APIRequestContext) {
  const response = await request.post("/api/v1/projects/empty", {
    data: {
      title: "Step cancellation " + randomUUID().slice(0, 8),
      client_project_id: randomUUID()
    }
  });
  expect(response.status()).toBe(201);
  const id = ((await response.json()) as { project: { id: string } }).project.id;
  const base = `/api/v1/projects/${id}/work-dags`;
  const created = await request.post(base, {
    data: {
      client_request_id: randomUUID(),
      title: "Отмена одного шага",
      nodes: [
        { id: "a", title: "Бриф", goal: "Создать бриф", depends_on: [] },
        { id: "b", title: "Документ", goal: "Использовать бриф", depends_on: ["a"] },
        { id: "c", title: "Отдельный файл", goal: "Создать независимый файл", depends_on: [] }
      ]
    }
  });
  expect(created.status()).toBe(201);
  return { id, base, graph: (await created.json()) as WorkDag };
}

test("reviews one-step cancellation and recovers a lost response with no repeated POST", async ({
  page,
  request
}) => {
  const { id, base, graph } = await fixture(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?project=${id}&view=plan&plan=${graph.id}`);
  const panel = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await panel.getByRole("button", { name: "Отменить этот шаг…", exact: true }).first().click();
  const confirmation = panel.getByRole("group", { name: "Подтверждение отмены шага", exact: true });
  await expect(confirmation).toContainText("Отменить «Бриф»?");
  await confirmation.getByRole("button", { name: "Оставить шаг", exact: true }).click();
  expect(((await (await request.get(`${base}/${graph.id}`)).json()) as WorkDag).version).toBe(
    graph.version
  );
  let writes = 0;
  await page.route("**/work-dags/*/control", async (route) => {
    writes++;
    await route.fetch();
    await route.fulfill({ status: 504, json: { error: "Lost acknowledgement" } });
  });
  await panel.getByRole("button", { name: "Отменить этот шаг…", exact: true }).first().click();
  await confirmation.getByRole("button", { name: "Подтвердить отмену шага", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(
    panel.getByText("Шаг отменён владельцем; автозапуск этого плана остановлен", { exact: true })
  ).toBeVisible();
  expect(writes).toBe(1);
  const saved = (await (await request.get(`${base}/${graph.id}`)).json()) as WorkDag;
  expect(saved.nodes.map((n) => n.status)).toEqual(["cancelled", "blocked", "pending"]);
  expect(saved.nodes.every((n) => !n.attempts.length)).toBe(true);
  const downloadEvent = page.waitForEvent("download");
  await panel.getByRole("link", { name: "Скачать отчёт и файлы (ZIP)", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("work-results.zip");
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const bytes = await readFile(downloadedPath!);
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  expect(bytes.includes(Buffer.from('"complete": false'))).toBe(true);
  expect(bytes.includes(Buffer.from('"status": "cancelled"'))).toBe(true);
  await panel
    .getByRole("button", { name: "Редактировать не запущенные шаги", exact: true })
    .click();
  await expect(panel.getByRole("group", { name: "Шаг 1 · отменён", exact: true })).toBeDisabled();
  await expect(panel.getByRole("group", { name: "Шаг 2", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true
  );
});

test("does not cancel a changed step using an old confirmation", async ({ page, request }) => {
  const { id, base, graph } = await fixture(request);
  await page.goto(`/?project=${id}&view=plan&plan=${graph.id}`);
  const panel = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await panel.getByRole("button", { name: "Отменить этот шаг…", exact: true }).first().click();
  await page.route("**/work-dags/*/control", async (route) => {
    const updated = await request.put(`${base}/${graph.id}/title`, {
      data: { expected_version: graph.version, title: "Changed from another tab" }
    });
    expect(updated.ok()).toBe(true);
    await route.continue();
  });
  await panel.getByRole("button", { name: "Подтвердить отмену шага", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("План изменился");
  await expect(
    panel.getByRole("group", { name: "Подтверждение отмены шага", exact: true })
  ).toBeVisible();
  const saved = (await (await request.get(`${base}/${graph.id}`)).json()) as WorkDag;
  expect(saved.nodes[0]?.status).toBe("pending");
  expect(saved.title).toBe("Changed from another tab");
});
