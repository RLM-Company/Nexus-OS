import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

async function fixture(request: APIRequestContext) {
  const response = await request.post("/api/v1/projects", {
    data: { initial_message: "Artifact context", client_message_id: randomUUID() }
  });
  expect(response.ok()).toBe(true);
  const project = ((await response.json()) as { project: { id: string } }).project.id;
  return { project, base: `/api/v1/projects/${project}` };
}

test("stages reviewed Canvas evidence separately from saved project materials and recovers a lost save response", async ({
  page,
  request
}) => {
  const { project, base } = await fixture(request);
  const created = await request.post(base + "/canvas", {
    data: { title: "Evidence", format: "text", content: "<script>bad()</script>\r\nExact source" }
  });
  const id = ((await created.json()) as { artifact: { id: string } }).artifact.id;
  await page.goto(`/?project=${project}&view=context`);
  const panel = page.getByRole("tabpanel", { name: "Контекст проекта" });
  const picker = panel.getByRole("region", { name: "Сохранённые источники проекта" });
  await picker.getByLabel("Сохранённый источник").selectOption(`canvas:${id}`);
  await picker.getByRole("button", { name: "Подготовить снимок", exact: true }).click();
  await expect(picker.getByLabel("Текст снимка материала")).toContainText("Exact source");
  await expect(
    picker.getByLabel("Текст снимка материала").locator("script,img,iframe")
  ).toHaveCount(0);
  expect(
    ((await (await request.get(base + "/materials")).json()) as { version: number }).version
  ).toBe(0);
  await picker.getByRole("button", { name: "Добавить снимок в материалы", exact: true }).click();
  expect(
    ((await (await request.get(base + "/materials")).json()) as { version: number }).version
  ).toBe(0);
  let writes = 0;
  await page.route(`**${base}/materials`, async (route) => {
    if (route.request().method() === "PUT") {
      writes++;
      const accepted = await route.fetch();
      expect(accepted.ok()).toBe(true);
      await route.abort("connectionclosed");
    } else await route.continue();
  });
  await panel.getByRole("button", { name: "Сохранить материалы", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("подтверждена чтением");
  expect(writes).toBe(1);
  const saved = (await (await request.get(base + "/materials")).json()) as {
    version: number;
    attachments: { content: string }[];
  };
  expect(saved.version).toBe(1);
  expect(saved.attachments[0]!.content).toContain("Version: 1");
  await request.put(`${base}/canvas/${id}`, {
    data: { baseVersion: 1, title: "Evidence", format: "text", content: "replacement" }
  });
  await page.reload();
  const persisted = (await (await request.get(base + "/materials")).json()) as {
    attachments: { content: string }[];
  };
  expect(persisted.attachments[0]!.content).toBe(saved.attachments[0]!.content);
  expect(writes).toBe(1);
});

test("requires explicit text excerpts and table row/column projection without saving automatically", async ({
  page,
  request
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { project, base } = await fixture(request);
  const docResponse = await request.post(base + "/canvas", {
    data: { title: "Large", format: "text", content: "chosen line\n" + "x".repeat(9000) }
  });
  const id = ((await docResponse.json()) as { artifact: { id: string } }).artifact.id;
  const tableId = randomUUID();
  const table = await request.post(base + "/tables", {
    data: {
      client_id: tableId,
      title: "Saved table",
      content: JSON.stringify({
        schema: "kosmora.studio.data",
        version: 1,
        name: "input.csv",
        table: {
          delimiter: ",",
          headers: ["ID", "private", "count"],
          rows: [
            ["001", "excluded secret", "5"],
            ["002", "excluded secret", "8"]
          ]
        },
        settings: {
          types: ["text", "text", "number"],
          columns: [0, 1, 2],
          filters: [],
          sort: null,
          group: null,
          measure: 2,
          chart: { kind: "bar", x: 0, y: 2 }
        }
      })
    }
  });
  expect(table.ok()).toBe(true);
  await page.goto(`/?project=${project}&view=context`);
  const picker = page.getByRole("region", { name: "Сохранённые источники проекта" });
  await picker.getByLabel("Сохранённый источник").selectOption(`canvas:${id}`);
  await picker.getByRole("button", { name: "Подготовить снимок", exact: true }).click();
  await expect(picker.getByRole("alert")).toContainText("превышает лимит");
  await picker.getByLabel("Объём источника").selectOption("range");
  await picker.getByLabel("До строки источника").fill("1");
  await picker.getByRole("button", { name: "Подготовить снимок", exact: true }).click();
  await expect(picker.getByLabel("Текст снимка материала")).toContainText("chosen line");
  await expect(picker).toContainText("Частичный снимок");
  await picker.getByRole("button", { name: "Добавить снимок в материалы", exact: true }).click();
  await picker.getByLabel("Сохранённый источник").selectOption(`table:${tableId}`);
  await picker.getByLabel("До строки источника").fill("2");
  await picker.getByLabel("Столбцы источника").fill("1,3");
  await picker.getByRole("button", { name: "Подготовить снимок", exact: true }).click();
  await expect(picker.getByLabel("Текст снимка материала")).toContainText('"001","5"');
  await expect(picker.getByLabel("Текст снимка материала")).not.toContainText("excluded secret");
  expect(
    ((await (await request.get(base + "/materials")).json()) as { version: number }).version
  ).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
