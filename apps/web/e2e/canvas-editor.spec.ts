import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { CanvasArtifact, CanvasRevision, CanvasSource } from "@cosmora/contracts";

type Full = { artifact: CanvasArtifact; revision: CanvasRevision };
const apiPath = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/canvas`;
async function createProject(request: APIRequestContext) {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Canvas integration fixture", client_message_id: randomUUID() }
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { project: { id: string } }).project.id;
}
async function openCanvas(page: Page, projectId: string) {
  await page.goto(`/?project=${encodeURIComponent(projectId)}&view=chat`);
  await page.getByRole("button", { name: "Открыть Canvas", exact: true }).click();
  const canvas = page.getByRole("region", { name: "Редактор Canvas", exact: true });
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toBeEnabled();
  return canvas;
}

test("Canvas opens local documents as drafts and round-trips edited DOCX", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  const canvas = await openCanvas(page, projectId);
  await canvas.getByLabel("Название", { exact: true }).fill("Черновик");
  await canvas.getByLabel("Содержимое", { exact: true }).fill("Сохранить мой отдельный черновик");
  await canvas
    .getByLabel("Открыть документ", { exact: true })
    .setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from([0xff]) });
  await expect(canvas.getByRole("alert")).toContainText("Сначала сохраните текущий черновик");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт создан");
  await canvas
    .getByLabel("Открыть документ", { exact: true })
    .setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from([0xff]) });
  await expect(canvas.getByRole("alert")).toContainText("UTF-8");
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue(
    "Сохранить мой отдельный черновик"
  );
  await canvas.getByLabel("Открыть документ", { exact: true }).setInputFiles({
    name: "Бриф.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Бриф\nИсходный текст")
  });
  await expect(canvas.getByRole("status")).toContainText("Файл открыт в новом черновике");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт создан");
  const edited = "Редакция владельца & <данные>\nВторая строка на русском";
  await canvas.getByLabel("Содержимое", { exact: true }).fill(edited);
  const downloading = page.waitForEvent("download");
  await canvas.getByRole("button", { name: "Скачать DOCX", exact: true }).click();
  const bytes = await readFile(await (await downloading).path());
  const xml = strFromU8(unzipSync(bytes)["word/document.xml"]!);
  expect(xml).toContain("Редакция владельца &amp; &lt;данные&gt;");
  expect(xml).toContain("Вторая строка на русском");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Сохранена новая версия");
  await canvas.getByLabel("Открыть документ", { exact: true }).setInputFiles({
    name: "Редакция.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: bytes
  });
  await expect(canvas.getByRole("status")).toContainText("Файл открыт в новом черновике");
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue(edited);
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт создан");
  await canvas.getByLabel("Содержимое", { exact: true }).fill(edited + "\nГотово к передаче");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Сохранена новая версия");
  await page.reload();
  await page.getByRole("button", { name: "Открыть Canvas", exact: true }).click();
  await canvas.getByRole("button", { name: /Редакция.*v2/ }).click();
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue(
    edited + "\nГотово к передаче"
  );
});

test("Canvas persists real versions, preserves a stale draft, restores a new revision and exports/deletes", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  const base = apiPath(projectId);
  const canvas = await openCanvas(page, projectId);
  await canvas.getByLabel("Название", { exact: true }).fill("Versioned note");
  await canvas.getByLabel("Содержимое", { exact: true }).fill("first revision");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт создан");
  const list = (await (await request.get(base)).json()) as { items: CanvasArtifact[] };
  const id = list.items.find((item) => item.title === "Versioned note")!.id;
  const external = await request.put(`${base}/${id}`, {
    data: { title: "Versioned note", format: "markdown", content: "other writer", baseVersion: 1 }
  });
  expect(external.ok()).toBe(true);
  await canvas.getByLabel("Содержимое", { exact: true }).fill("my protected draft");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByText("Конфликт версий: на сервере v2", { exact: true })).toBeVisible();
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue("my protected draft");
  await canvas.getByRole("button", { name: "Сохранить как копию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Копия создана");
  const copies = (await (await request.get(base)).json()) as { items: CanvasArtifact[] };
  expect(copies.items).toHaveLength(2);
  expect(((await (await request.get(`${base}/${id}`)).json()) as Full).revision.content).toBe(
    "other writer"
  );
  await canvas
    .getByRole("navigation", { name: "Артефакты проекта" })
    .getByRole("button", { name: /Versioned note.*v2/ })
    .click();
  const revisionOne = canvas.getByRole("listitem").filter({ hasText: /v1 ·/ });
  await revisionOne.getByRole("button", { name: "Восстановить новой версией" }).click();
  await expect(
    canvas.getByRole("region", { name: "Проверка изменений Canvas", exact: true })
  ).toContainText("other writer");
  expect(((await (await request.get(`${base}/${id}`)).json()) as Full).artifact.version).toBe(2);
  await canvas.getByRole("button", { name: "Подтвердить восстановление v1", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Старая версия восстановлена как новая");
  const restored = (await (await request.get(`${base}/${id}`)).json()) as Full;
  expect(restored.artifact.version).toBe(3);
  expect(restored.revision.content).toBe("first revision");
  const history = (await (await request.get(`${base}/${id}/revisions`)).json()) as {
    items: CanvasRevision[];
  };
  expect(history.items.map((item) => item.version)).toEqual([3, 2, 1]);
  const downloaded = page.waitForEvent("download");
  await canvas.getByRole("button", { name: "Скачать", exact: true }).click();
  const file = await downloaded;
  expect(await readFile(await file.path(), "utf8")).toBe("first revision");
  await canvas.getByLabel("Содержимое", { exact: true }).fill("unsaved local edit");
  const oldDownload = page.waitForEvent("download");
  await canvas.getByRole("link", { name: "Скачать v2", exact: true }).click();
  expect(await readFile(await (await oldDownload).path(), "utf8")).toBe("other writer");
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue("unsaved local edit");
  page.once("dialog", (dialog) => dialog.accept());
  await canvas.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт удалён");
  expect((await request.get(`${base}/${id}`)).status()).toBe(404);
});

test("Canvas compares saved versions and protects reviewed conflict resolution from a newer writer", async ({
  page,
  request
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const projectId = await createProject(request);
  const base = apiPath(projectId);
  const created = await request.post(base, {
    data: { title: "Review", format: "text", content: "first\n" }
  });
  const id = ((await created.json()) as Full).artifact.id;
  const canvas = await openCanvas(page, projectId);
  await canvas.getByRole("button", { name: /Review.*v1/ }).click();
  await canvas.getByLabel("Содержимое", { exact: true }).fill("my draft\n");
  const write = (baseVersion: number, content: string) =>
    request.put(`${base}/${id}`, {
      data: { title: "Review", format: "text", baseVersion, content }
    });
  expect((await write(1, "second writer\n")).ok()).toBe(true);
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByText("Конфликт версий: на сервере v2", { exact: true })).toBeVisible();
  await expect(
    canvas.getByRole("button", { name: "Подтвердить новую версию", exact: true })
  ).toHaveCount(0);
  await canvas.getByRole("button", { name: "Сравнить с серверной версией", exact: true }).click();
  const review = canvas.getByRole("region", { name: "Проверка изменений Canvas", exact: true });
  await expect(review).toContainText("second writer");
  await expect(review).toContainText("my draft");
  await canvas.getByLabel("Содержимое", { exact: true }).fill("edited after review\n");
  await expect(
    review.getByRole("button", { name: "Подтвердить новую версию", exact: true })
  ).toBeDisabled();
  await canvas.getByRole("button", { name: "Сравнить с серверной версией", exact: true }).click();
  await expect(review).toContainText("edited after review");
  expect((await write(2, "third writer\n")).ok()).toBe(true);
  await review.getByRole("button", { name: "Подтвердить новую версию", exact: true }).click();
  await expect(canvas.getByText("Конфликт версий: на сервере v3", { exact: true })).toBeVisible();
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue(
    "edited after review\n"
  );
  expect(((await (await request.get(`${base}/${id}`)).json()) as Full).revision.content).toBe(
    "third writer\n"
  );
  await canvas.getByRole("button", { name: "Сравнить с серверной версией", exact: true }).click();
  await expect(review).toContainText("third writer");
  await review.getByRole("button", { name: "Подтвердить новую версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Сохранена новая версия");
  expect(((await (await request.get(`${base}/${id}`)).json()) as Full).artifact.version).toBe(4);
  await canvas.getByLabel("Версия до", { exact: true }).selectOption("1");
  await canvas.getByLabel("Версия после", { exact: true }).selectOption("2");
  await canvas.getByRole("button", { name: "Сравнить версии", exact: true }).click();
  await expect(review).toContainText("first");
  await expect(review).toContainText("second writer");
  expect(((await (await request.get(`${base}/${id}`)).json()) as Full).artifact.version).toBe(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test("Canvas rejects a stale reviewed restore and preserves new server history", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  const base = apiPath(projectId);
  const created = await request.post(base, {
    data: { title: "Restore", format: "markdown", content: "original" }
  });
  const id = ((await created.json()) as Full).artifact.id;
  const update = (baseVersion: number, content: string) =>
    request.put(`${base}/${id}`, {
      data: { title: "Restore", format: "markdown", baseVersion, content }
    });
  expect((await update(1, "current")).ok()).toBe(true);
  const canvas = await openCanvas(page, projectId);
  await canvas.getByRole("button", { name: /Restore.*v2/ }).click();
  await canvas
    .getByRole("listitem")
    .filter({ hasText: /v1 ·/ })
    .getByRole("button", { name: "Восстановить новой версией" })
    .click();
  await expect(canvas.getByRole("region", { name: "Сравнение текста", exact: true })).toContainText(
    "original"
  );
  expect((await update(2, "newer server version")).ok()).toBe(true);
  await canvas.getByRole("button", { name: "Подтвердить восстановление v1", exact: true }).click();
  await expect(canvas.getByText("Конфликт версий: на сервере v3", { exact: true })).toBeVisible();
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue("current");
  const current = (await (await request.get(`${base}/${id}`)).json()) as Full;
  expect(current.artifact.version).toBe(3);
  expect(current.revision.content).toBe("newer server version");
});

test("Canvas HTML/Markdown resources stay inert and owner/project drafts survive reload in their scope", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  const otherProjectId = await createProject(request);
  const base = apiPath(projectId);
  const content =
    '<script>window.__canvasExecuted = true</script><img src="https://canvas-invalid.test/track">';
  const created = await request.post(base, {
    data: { title: "Inert HTML", format: "html", content }
  });
  expect(created.ok()).toBe(true);
  const canvas = await openCanvas(page, projectId);
  const resources: string[] = [];
  await page.route("https://canvas-invalid.test/**", async (route) => {
    resources.push(route.request().url());
    await route.abort();
  });
  await canvas.getByRole("button", { name: /Inert HTML.*v1/ }).click();
  const preview = canvas.getByLabel("Безопасный предпросмотр");
  await expect(preview).toContainText(content);
  await expect(preview.locator("script,img,iframe,a[href]")).toHaveCount(0);
  expect(await page.evaluate(() => "__canvasExecuted" in window)).toBe(false);
  await canvas.getByRole("combobox", { name: "Формат", exact: true }).selectOption("markdown");
  await canvas
    .getByLabel("Содержимое", { exact: true })
    .fill(
      "# Private draft\n\n[link](https://canvas-invalid.test/link)\n\n![image](https://canvas-invalid.test/image)"
    );
  await expect(preview.getByRole("heading", { name: "Private draft" })).toBeVisible();
  await expect(preview.locator("script,img,iframe,a[href]")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Открыть Canvas", exact: true }).click();
  await canvas.getByRole("button", { name: /Inert HTML.*v1/ }).click();
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue(/Private draft/);
  await openCanvas(page, otherProjectId);
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue("");
  expect(resources).toEqual([]);
});

test("Canvas import copies a completed source while retaining an unsaved new draft", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  const base = apiPath(projectId);
  type Candidate = { title: string; source: CanvasSource };
  await expect
    .poll(async () => {
      const listing = (await (await request.get(`${base}/sources`)).json()) as {
        items: Candidate[];
      };
      return listing.items.some((item) => item.source.kind === "project_chat");
    })
    .toBe(true);
  const sources = (await (await request.get(`${base}/sources`)).json()) as { items: Candidate[] };
  const sourceIndex = sources.items.findIndex((item) => item.source.kind === "project_chat");
  const canvas = await openCanvas(page, projectId);
  await canvas.getByLabel("Содержимое", { exact: true }).fill("Keep my unsaved new draft");
  await canvas.getByLabel("Импорт из Work и чатов").selectOption(String(sourceIndex));
  page.once("dialog", (dialog) => dialog.accept());
  await canvas.getByRole("button", { name: "Импортировать копию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText(
    "Импортирована независимая редакторская копия"
  );
  const items = (await (await request.get(base)).json()) as { items: CanvasArtifact[] };
  expect(items.items).toHaveLength(1);
  const imported = (await (await request.get(`${base}/${items.items[0]!.id}`)).json()) as Full;
  expect(imported.revision.source.kind).toBe("project_chat");
  await canvas.getByRole("button", { name: "+ Новый", exact: true }).click();
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue(
    "Keep my unsaved new draft"
  );
});

test("Canvas opens a local UTF-8 file without saving and protects an unsaved draft", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  const base = apiPath(projectId);
  const canvas = await openCanvas(page, projectId);
  const original = "\ufeff<script>window.fileImportExecuted = true</script>\r\nТочный файл 🍋";
  await canvas.getByLabel("Открыть документ", { exact: true }).setInputFiles({
    name: "source.html",
    mimeType: "text/html",
    buffer: Buffer.from(original)
  });
  await expect(canvas.getByRole("status")).toContainText("Файл открыт в новом черновике");
  expect(
    ((await (await request.get(base)).json()) as { items: CanvasArtifact[] }).items
  ).toHaveLength(0);
  await expect(canvas.getByLabel("Название", { exact: true })).toHaveValue("source.html");
  await expect(
    canvas.getByLabel("Безопасный предпросмотр").locator("script,img,iframe")
  ).toHaveCount(0);
  expect(await page.evaluate(() => "fileImportExecuted" in window)).toBe(false);
  await canvas.getByLabel("Открыть документ", { exact: true }).setInputFiles({
    name: "other.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("replacement")
  });
  await expect(canvas.getByRole("alert")).toContainText("Сначала сохраните текущий черновик");
  await expect(canvas.getByLabel("Название", { exact: true })).toHaveValue("source.html");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт создан");
  const items = ((await (await request.get(base)).json()) as { items: CanvasArtifact[] }).items;
  expect(items).toHaveLength(1);
  const saved = (await (await request.get(`${base}/${items[0]!.id}`)).json()) as Full;
  expect(Buffer.from(saved.revision.content)).toEqual(Buffer.from(original));
  await canvas
    .getByLabel("Открыть документ", { exact: true })
    .setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from([0xff, 0xfe]) });
  await expect(canvas.getByRole("alert")).toContainText("UTF-8");
  await expect(canvas.getByLabel("Название", { exact: true })).toHaveValue("source.html");
  expect(
    ((await (await request.get(base)).json()) as { items: CanvasArtifact[] }).items
  ).toHaveLength(1);
});

test("Canvas confirms lost create/update responses by reading without extra mutations", async ({
  page,
  request
}) => {
  const projectId = await createProject(request),
    base = apiPath(projectId);
  const canvas = await openCanvas(page, projectId);
  let creates = 0,
    updates = 0;
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() === "POST") {
      creates++;
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort("connectionclosed");
    } else await route.continue();
  });
  await canvas.getByLabel("Название", { exact: true }).fill("Recovered");
  await canvas.getByLabel("Содержимое", { exact: true }).fill("first");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт создан");
  const items = ((await (await request.get(base)).json()) as { items: CanvasArtifact[] }).items;
  expect(items).toHaveLength(1);
  expect(creates).toBe(1);
  await page.route(`**${base}/${items[0]!.id}`, async (route) => {
    if (route.request().method() === "PUT") {
      updates++;
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort("connectionclosed");
    } else await route.continue();
  });
  await canvas.getByLabel("Содержимое", { exact: true }).fill("second");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Сохранена новая версия");
  expect(updates).toBe(1);
  expect(
    ((await (await request.get(`${base}/${items[0]!.id}`)).json()) as Full).artifact.version
  ).toBe(2);
});

test("Canvas retains an unresolved creation ID over reload and a user retry creates no duplicate", async ({
  page,
  request
}) => {
  const projectId = await createProject(request),
    base = apiPath(projectId);
  const canvas = await openCanvas(page, projectId);
  let requestId = "",
    blockRead = true;
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() === "POST") {
      const data = route.request().postDataJSON() as { client_request_id: string };
      if (!requestId) requestId = data.client_request_id;
      expect(data.client_request_id).toBe(requestId);
      const accepted = await route.fetch();
      expect(accepted.ok()).toBe(true);
      if (blockRead) await route.abort("connectionclosed");
      else await route.fulfill({ response: accepted });
    } else await route.continue();
  });
  await page.route(`**${base}/*`, async (route) => {
    if (
      blockRead &&
      route.request().method() === "GET" &&
      route.request().url().endsWith(requestId)
    )
      await route.abort("connectionclosed");
    else await route.continue();
  });
  await canvas.getByLabel("Название", { exact: true }).fill("Uncertain");
  await canvas.getByLabel("Содержимое", { exact: true }).fill("protected draft");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("alert")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Открыть Canvas", exact: true }).click();
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue("protected draft");
  blockRead = false;
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт создан");
  expect(
    ((await (await request.get(base)).json()) as { items: CanvasArtifact[] }).items
  ).toHaveLength(1);
});

test("Canvas retries a lost copy using the same ID and never overwrites the original", async ({
  page,
  request
}) => {
  const projectId = await createProject(request),
    base = apiPath(projectId);
  const source = (await (
    await request.post(base, {
      data: { title: "Original", format: "text", content: "original v1" }
    })
  ).json()) as Full;
  const canvas = await openCanvas(page, projectId);
  await canvas.getByRole("button", { name: /Original.*v1/ }).click();
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue("original v1");
  await canvas.getByLabel("Содержимое", { exact: true }).fill("my independent copy");
  await request.put(`${base}/${source.artifact.id}`, {
    data: { title: "Original", format: "text", content: "other writer", baseVersion: 1 }
  });
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("alert").filter({ hasText: "Конфликт версий:" })).toContainText(
    "Конфликт версий"
  );
  let copyId = "",
    allowRead = false;
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const payload = route.request().postDataJSON() as { client_request_id: string };
    if (!copyId) copyId = payload.client_request_id;
    expect(payload.client_request_id).toBe(copyId);
    const accepted = await route.fetch();
    expect(accepted.ok()).toBe(true);
    if (allowRead) await route.fulfill({ response: accepted });
    else await route.abort("connectionclosed");
  });
  await page.route(`**${base}/*`, async (route) => {
    if (!allowRead && route.request().method() === "GET" && route.request().url().endsWith(copyId))
      await route.abort("connectionclosed");
    else await route.continue();
  });
  await canvas.getByRole("button", { name: "Сохранить как копию", exact: true }).click();
  await expect(
    canvas.getByRole("button", { name: "Сохранить как копию", exact: true })
  ).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "Открыть Canvas", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await canvas.getByRole("button", { name: /Original.*v2/ }).click();
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue("my independent copy");
  allowRead = true;
  await canvas.getByRole("button", { name: "Сохранить как копию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Копия создана");
  const original = (await (await request.get(`${base}/${source.artifact.id}`)).json()) as Full;
  expect(original.artifact.version).toBe(2);
  expect(original.revision.content).toBe("other writer");
  const copy = (await (await request.get(`${base}/${copyId}`)).json()) as Full;
  expect(copy.artifact.version).toBe(1);
  expect(copy.revision.content).toBe("my independent copy");
  expect(
    ((await (await request.get(base)).json()) as { items: CanvasArtifact[] }).items
  ).toHaveLength(2);
});
