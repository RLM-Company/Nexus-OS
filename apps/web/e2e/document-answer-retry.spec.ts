import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const apiOrigin = "http://127.0.0.1:3100";
const regionName = "Библиотека проекта";

async function project(request: APIRequestContext) {
  const response = await request.post(apiOrigin + "/api/v1/projects/empty", {
    data: { title: "Повтор анализа", client_project_id: randomUUID() }
  });
  expect(response.ok()).toBe(true);
  const id = ((await response.json()) as { project: { id: string } }).project.id;
  return { id, path: `/api/v1/projects/${id}/document-library` };
}

const coverage = {
  total_chunks: 3,
  analyzed_chunks: 1,
  failed_chunks: 1,
  phase: "synthesis",
  files: [
    {
      name: "contract.pdf",
      chunks: 2,
      analyzed_chunks: 1,
      failed_chunks: 1,
      is_pdf: true,
      total_pages: 2,
      indexed_pages: 1
    },
    {
      name: "notes.txt",
      chunks: 1,
      analyzed_chunks: 0,
      failed_chunks: 0,
      is_pdf: false,
      total_pages: null,
      indexed_pages: null
    }
  ]
};

const failedAnswer = (id: string) => ({
  id,
  question: "Что говорит договор?",
  answer: null,
  status: "failed",
  error_code: "INCOMPLETE_COVERAGE",
  coverage,
  citations: [],
  sources: []
});

const doneAnswer = (id: string) => ({
  id,
  question: "Что говорит договор?",
  answer: "Договор заканчивается в октябре 2027 [S1]",
  status: "done",
  error_code: null,
  coverage: { ...coverage, analyzed_chunks: 3, failed_chunks: 0, phase: "complete" },
  citations: ["S1"],
  sources: [
    {
      ref: "S1",
      name: "contract.pdf",
      page: 2,
      line_start: 10,
      line_end: 12,
      content: "Конец договора в октябре 2027"
    }
  ]
});

/** Status line lives in the saved-answers section; other UI also has role=status. */
const statusOf = (library: ReturnType<typeof pageLibrary>) =>
  library.getByRole("region", { name: "Сохранённые ответы модели" }).getByRole("status").first();

const pageLibrary = (page: Page) => page.getByRole("region", { name: regionName, exact: true });

async function open(page: Page, id: string, path: string, answers: () => unknown[]) {
  await page.route(`**${path}/answers`, (route) =>
    route.fulfill({ json: { answers: answers(), available: true } })
  );
  await page.goto(`/?project=${id}&surface=files`);
  return pageLibrary(page);
}

test("incomplete coverage -> retry -> fresh run -> report, with double-click guard", async ({
  page,
  request
}) => {
  const { id, path } = await project(request);
  const sourceId = randomUUID();
  const newId = randomUUID();
  let answers: unknown[] = [failedAnswer(sourceId)];
  let retryPosts = 0;
  const library = await open(page, id, path, () => answers);
  await page.route(`**${path}/answers/${sourceId}/retry`, async (route) => {
    retryPosts++;
    await new Promise((resolve) => setTimeout(resolve, 80));
    answers = [failedAnswer(sourceId), doneAnswer(newId)];
    await route.fulfill({ status: 202, json: doneAnswer(newId) });
  });
  await page.route(`**${path}/answers/${newId}`, (route) =>
    route.fulfill({ json: doneAnswer(newId) })
  );

  await expect(statusOf(library)).toContainText("INCOMPLETE_COVERAGE");
  const exportZip = library.getByRole("button", { name: "Скачать пакет отчёта ZIP" });
  await expect(exportZip).toBeDisabled();
  await expect(library.getByLabel("Покрытие анализа")).toContainText("Не обработано: 1");
  await expect(library.getByLabel("Покрытие анализа")).toContainText(
    "contract.pdf — 1 из 2 фрагментов, ошибок: 1"
  );
  const retry = library.getByRole("button", { name: "Повторить анализ", exact: true });
  await expect(retry).toBeEnabled();
  // Two rapid clicks in the same tick: dispatch directly so actionability
  // checks do not serialize them; the in-flight marker must collapse them.
  await Promise.all([retry.dispatchEvent("click"), retry.dispatchEvent("click")]);
  await expect.poll(() => retryPosts).toBe(1);
  await expect(statusOf(library)).toHaveText("Ответ сохранён", { timeout: 10_000 });
  await expect(library.getByLabel("Источники ответа")).toContainText("contract.pdf");
  await expect(library.getByLabel("Источники ответа")).toContainText("Страница 2");
  const downloadPromise = page.waitForEvent("download");
  await exportZip.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`kosmora-model-answer-${newId}.zip`);
  const files = unzipSync(await readFile(await download.path()));
  expect(Object.keys(files).sort()).toEqual([
    "report.csv",
    "report.docx",
    "report.pdf",
    "report.txt"
  ]);
  expect(strFromU8(files["report.txt"]!)).toContain("[S1]");
  expect(strFromU8(files["report.csv"]!)).toContain("contract.pdf");
  expect(strFromU8(files["report.pdf"]!.subarray(0, 5))).toBe("%PDF-");
  expect(unzipSync(files["report.docx"]!)["word/document.xml"]).toBeDefined();
});

test("lost retry response requires a fresh explicit action after reconciliation", async ({
  page,
  request
}) => {
  const { id, path } = await project(request);
  const sourceId = randomUUID();
  const newId = randomUUID();
  let answers: unknown[] = [failedAnswer(sourceId)];
  let retryPosts = 0;
  const library = await open(page, id, path, () => answers);
  await page.route(`**${path}/answers/${sourceId}/retry`, async (route) => {
    retryPosts++;
    // The server committed, but the browser never receives the acknowledgement.
    answers = [failedAnswer(sourceId), doneAnswer(newId)];
    await route.abort("failed");
  });
  // The client keeps the stable attempt id and resolves that exact run on reload.
  await page.route(`**${path}/answers/retry/*`, (route) =>
    route.fulfill({ json: doneAnswer(newId) })
  );
  await page.route(`**${path}/answers/${newId}`, (route) =>
    route.fulfill({ json: doneAnswer(newId) })
  );

  await library.getByRole("button", { name: "Повторить анализ", exact: true }).click();
  await expect(statusOf(library)).toContainText("INCOMPLETE_COVERAGE");
  await expect(library.getByText(/Исход запроса неизвестен/)).toBeVisible();
  expect(retryPosts).toBe(1); // no blind re-dispatch after the lost response
  await page.reload();
  await expect(statusOf(library)).toContainText("INCOMPLETE_COVERAGE");
  // A fresh explicit click reconciles history and attaches the already-created run.
  await library.getByRole("button", { name: "Сверить и повторить анализ", exact: true }).click();
  await expect(statusOf(library)).toHaveText("Ответ сохранён");
  expect(retryPosts).toBe(1); // reconciliation did not create a second paid run
});

test("cancelled deep run can be retried explicitly", async ({ page, request }) => {
  const { id, path } = await project(request);
  const sourceId = randomUUID();
  const newId = randomUUID();
  let answers: unknown[] = [
    { ...failedAnswer(sourceId), status: "cancelled", error_code: "CANCELLED" }
  ];
  const library = await open(page, id, path, () => answers);
  await page.route(`**${path}/answers/${sourceId}/retry`, async (route) => {
    answers = [{ ...failedAnswer(sourceId), status: "cancelled" }, doneAnswer(newId)];
    await route.fulfill({ status: 202, json: doneAnswer(newId) });
  });
  await page.route(`**${path}/answers/${newId}`, (route) =>
    route.fulfill({ json: doneAnswer(newId) })
  );

  await expect(statusOf(library)).toHaveText("Запрос отменён");
  const history = library.getByRole("combobox", { name: "Сохранённые ответы" });
  await expect(history).toContainText("cancelled"); // old diagnostic stays in history
  await library.getByRole("button", { name: "Повторить анализ", exact: true }).click();
  await expect(statusOf(library)).toHaveText("Ответ сохранён");
  await expect
    .poll(() => answers.filter((item) => (item as { id?: string }).id === sourceId).length)
    .toBe(1);
});
