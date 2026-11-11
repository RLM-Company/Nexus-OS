import { createHash, randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type Route
} from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

const apiOrigin = "http://127.0.0.1:3100";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
// Inject loss only after the real API has committed. A forwarding failure must
// still release the browser route and fail the test; never retry the POST.
async function loseCommittedResponse(
  route: Route,
  verify?: (response: APIResponse) => Promise<void>
) {
  try {
    const source = new URL(route.request().url());
    const response = await route.fetch({
      url: apiOrigin + source.pathname + source.search,
      maxRetries: 0,
      maxRedirects: 0
    });
    expect(response.status()).toBe(201);
    await verify?.(response);
  } finally {
    await route.abort("failed");
  }
}

async function project(request: APIRequestContext, page: Page) {
  const response = await request.post(apiOrigin + "/api/v1/projects/empty", {
    data: { title: "Очередь документов", client_project_id: randomUUID() }
  });
  expect(response.ok()).toBe(true);
  const id = ((await response.json()) as { project: { id: string } }).project.id;
  await page.goto(`/?project=${id}&surface=files`);
  return {
    id,
    path: `/api/v1/projects/${id}/document-library`,
    library: page.getByRole("region", { name: "Библиотека проекта", exact: true })
  };
}
const file = (name: string, content: string) => ({
  name,
  mimeType: "text/plain",
  buffer: Buffer.from(content)
});

test("Studio creates a library project without a message or model request and survives a lost response", async ({
  page,
  request
}) => {
  const messages: string[] = [];
  let attempts = 0;
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      /\/messages$|\/api\/v1\/chats$|\/api\/v1\/projects$/.test(new URL(req.url()).pathname)
    )
      messages.push(req.url());
  });
  await page.route("**/api/v1/projects/empty", async (route) => {
    attempts++;
    await loseCommittedResponse(route);
  });
  await page.goto("/?surface=files");
  const library = page.getByRole("region", { name: "Библиотека проекта", exact: true });
  await library.getByLabel("Название проекта", { exact: true }).fill("Библиотека без AI");
  await library.getByRole("button", { name: "Создать библиотеку", exact: true }).click();
  await expect(page).toHaveURL(/project=[a-f0-9-]+.*surface=files/);
  await expect(library.getByRole("button", { name: "Добавить файлы", exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("project")!;
  const detail = (await (
    await request.get(`http://127.0.0.1:3100/api/v1/projects/${id}`)
  ).json()) as { project: { title: string; status: string }; messages: unknown[] };
  expect(detail.project).toMatchObject({ title: "Библиотека без AI", status: "DRAFT" });
  expect(detail.messages).toEqual([]);
  expect(messages).toEqual([]);
  expect(attempts).toBe(1);
  await page.reload();
  await expect(library.getByRole("button", { name: "Добавить файлы", exact: true })).toBeVisible();
});

test("one broken PDF doesn't stop the rest of a real indexed batch", async ({ page, request }) => {
  const { library, path } = await project(request, page);
  await library.locator('input[type="file"]').setInputFiles([
    file("первый.txt", "Бюджет составляет 100 рублей"),
    {
      name: "ошибка.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nnot-a-real-pdf")
    },
    file("последний.txt", "Срок выполнения — октябрь")
  ]);
  const queue = library.getByRole("region", { name: "Результаты загрузки" });
  await expect(queue.locator('li[data-upload-state="ready"]')).toHaveCount(2);
  await expect(queue.locator('li[data-upload-state="failed"]')).toHaveCount(1);
  await expect(queue).toContainText("Обработано 3 из 3");
  const persisted = await request.get("http://127.0.0.1:3100" + path);
  const data = (await persisted.json()) as { files: { name: string; status: string }[] };
  expect(data.files).toHaveLength(3);
  expect(data.files.find((item) => item.name === "ошибка.pdf")?.status).toBe("failed");
  await library.getByLabel("Вопрос к документам").fill("Бюджет");
  await library.getByRole("button", { name: "Найти источники", exact: true }).click();
  await expect(library).toContainText("100 рублей");
  await library
    .getByRole("group", { name: "Сохранённые документы" })
    .getByRole("checkbox")
    .first()
    .check();
  const downloaded = page.waitForEvent("download");
  await library.getByRole("button", { name: "Скачать оригиналы (1)", exact: true }).click();
  const archive = await downloaded;
  expect(archive.suggestedFilename()).toMatch(/\.zip$/);
  const entries = unzipSync(await readFile((await archive.path())!));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]!)) as {
    files: { path: string; name: string }[];
  };
  expect(manifest.files).toHaveLength(1);
  expect(manifest.files[0]!.name).toBe("последний.txt");
  expect(strFromU8(entries[manifest.files[0]!.path]!)).toBe("Срок выполнения — октябрь");
  await page.screenshot({ path: "../../qa/kosmora-document-upload-queue.png", fullPage: true });
});

test("cancel stops queued files and a saved original retries without another upload", async ({
  page,
  request
}) => {
  const { library, path } = await project(request, page);
  let uploads = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === path) uploads++;
  });
  await page.route(`**${path}/*/index`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue().catch(() => undefined);
  });
  await library
    .locator('input[type="file"]')
    .setInputFiles([
      file("сохранённый.txt", "Бюджет 200"),
      file("не-начинался.txt", "Не отправлять")
    ]);
  const queue = library.getByRole("region", { name: "Результаты загрузки" });
  await expect(queue.locator('li[data-upload-state="indexing"]')).toHaveCount(1);
  await library.getByRole("button", { name: "Отменить загрузку", exact: true }).click();
  await expect(queue.locator('li[data-upload-state="cancelled"]')).toHaveCount(2);
  await expect(library.getByRole("button", { name: "Добавить файлы", exact: true })).toBeEnabled();
  expect(uploads).toBe(1);
  const documents = library.getByRole("group", { name: "Сохранённые документы" });
  await documents.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(queue.locator('li[data-upload-state="ready"]')).toHaveCount(1);
  expect(uploads).toBe(1);
  const data = (await (await request.get("http://127.0.0.1:3100" + path)).json()) as {
    files: { name: string; status: string }[];
  };
  expect(data.files).toHaveLength(1);
  expect(data.files[0]).toMatchObject({ name: "сохранённый.txt", status: "ready" });
});

test("a lost POST response is reported and recovered from the real stored original", async ({
  page,
  request
}) => {
  const input = JSON.parse(
    await readFile(
      resolve(process.cwd(), "../../docs/handoff/fixtures/koswork-upload-recovery/input.json"),
      "utf8"
    )
  ) as { files: Array<{ name: string; content: string }> };
  const { library, path, id } = await project(request, page);
  let uploads = 0;
  let storedId = "";
  let committedDownloadHash = "";
  const modelPosts: string[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      /\/api\/v1\/(?:chats(?:\/[^/]+\/messages)?|projects(?:\/[^/]+\/(?:messages|work))?)$/.test(
        new URL(req.url()).pathname
      )
    )
      modelPosts.push(new URL(req.url()).pathname);
  });
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    uploads++;
    if (uploads === 1) {
      await loseCommittedResponse(route, async (response) => {
        const saved = (await response.json()) as { id: string; name: string; bytes: number };
        storedId = saved.id;
        expect(saved.name).toBe(input.files[0]!.name);
        const original = await request.get(apiOrigin + path + `/${storedId}/download`);
        expect(original.status()).toBe(200);
        const bytes = await original.body();
        expect(bytes).toEqual(Buffer.from(input.files[0]!.content));
        expect(saved.bytes).toBe(bytes.length);
        committedDownloadHash = sha256(bytes);
      });
    } else await route.continue();
  });
  await library
    .locator('input[type="file"]')
    .setInputFiles(input.files.map((item) => file(item.name, item.content)));
  const queue = library.getByRole("region", { name: "Результаты загрузки" });
  await expect(queue.locator('li[data-upload-state="uncertain"]')).toHaveCount(1);
  await expect(queue.locator('li[data-upload-state="ready"]')).toHaveCount(1);
  await expect(queue).toContainText("Проверьте библиотеку перед повторной загрузкой");
  await expect(library.getByRole("button", { name: "Добавить файлы", exact: true })).toBeEnabled();
  expect(uploads).toBe(2);
  const before = (await (await request.get(apiOrigin + path)).json()) as {
    files: Array<{ id: string; name: string; status: string }>;
  };
  expect(before.files).toHaveLength(2);
  expect(before.files.find((item) => item.id === storedId)).toMatchObject({
    name: input.files[0]!.name,
    status: "processing"
  });
  const documents = library.getByRole("group", { name: "Сохранённые документы" });
  await documents.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(queue.locator('li[data-upload-state="ready"]')).toHaveCount(1);
  expect(uploads).toBe(2);
  const data = (await (await request.get(apiOrigin + path)).json()) as {
    files: Array<{ id: string; name: string; status: string; characters: number; chunks: number }>;
  };
  expect(data.files).toHaveLength(2);
  expect(data.files.every((item) => item.status === "ready")).toBe(true);
  expect(data.files.map((item) => item.id).sort()).toEqual(
    before.files.map((item) => item.id).sort()
  );
  const outputs = [];
  for (const item of data.files) {
    expect(item.characters).toBeGreaterThan(0);
    expect(item.chunks).toBeGreaterThan(0);
    const original = await request.get(apiOrigin + path + `/${item.id}/download`);
    expect(original.status()).toBe(200);
    const bytes = await original.body();
    expect(bytes).toEqual(
      Buffer.from(input.files.find((source) => source.name === item.name)!.content)
    );
    const outputPath = test.info().outputPath(item.name);
    await writeFile(outputPath, bytes);
    await test.info().attach(item.name, { path: outputPath, contentType: "text/plain" });
    outputs.push({
      id: item.id,
      name: item.name,
      status: item.status,
      characters: item.characters,
      chunks: item.chunks,
      bytes: bytes.length,
      sha256: sha256(bytes)
    });
  }
  const detail = (await (await request.get(apiOrigin + `/api/v1/projects/${id}`)).json()) as {
    messages: unknown[];
  };
  expect(detail.messages).toEqual([]);
  expect(modelPosts).toEqual([]);
  const report = {
    real_model_called: false,
    fixture_injection: "verified backend commit followed by dropped browser response",
    browser_upload_posts: uploads,
    browser_model_posts: modelPosts,
    project_messages: detail.messages.length,
    stored_before_response_loss: { id: storedId, sha256: committedDownloadHash },
    original_ids_reused: true,
    files: outputs
  };
  const reportPath = test.info().outputPath("upload-recovery.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await test.info().attach("actual stored original recovery", {
    path: reportPath,
    contentType: "application/json"
  });
  if (process.env.KOSWORK_UPLOAD_REPORT_DIR) {
    await mkdir(process.env.KOSWORK_UPLOAD_REPORT_DIR, { recursive: true });
    await writeFile(
      resolve(process.env.KOSWORK_UPLOAD_REPORT_DIR, "result.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" }
    );
  }
});
