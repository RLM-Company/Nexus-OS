import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const regionName = "Библиотека проекта";

function project() {
  const id = randomUUID();
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

/** Routes must be installed BEFORE navigation so the initial answers GET is stubbed. */
async function open(page: Page, path: string, answers: () => unknown[]) {
  await page.route(`**${path}/answers`, (route) =>
    route.fulfill({ json: { answers: answers(), available: true } })
  );
  await page.goto(`/?project=${path.split("/")[3]}&surface=files`);
  return page.getByRole("region", { name: regionName, exact: true });
}

test("incomplete coverage -> retry -> fresh run -> report, with double-click guard", async ({
  page
}) => {
  const { id, path } = project();
  const sourceId = randomUUID();
  const newId = randomUUID();
  let answers: unknown[] = [failedAnswer(sourceId)];
  let retryPosts = 0;
  const library = await open(page, path, () => answers);
  await page.route(`**${path}/answers/${sourceId}/retry`, async (route) => {
    retryPosts++;
    await new Promise((resolve) => setTimeout(resolve, 40));
    answers = [failedAnswer(sourceId), doneAnswer(newId)];
    await route.fulfill({ status: 202, json: doneAnswer(newId) });
  });
  await page.route(`**${path}/answers/${newId}`, (route) =>
    route.fulfill({ json: doneAnswer(newId) })
  );

  await expect(library.getByRole("status")).toContainText("INCOMPLETE_COVERAGE");
  await expect(library.getByLabel("Покрытие анализа")).toContainText("Не обработано: 1");
  await expect(library.getByLabel("Покрытие анализа")).toContainText(
    "contract.pdf — 1 из 2 фрагментов, ошибок: 1"
  );
  const retry = library.getByRole("button", { name: "Повторить анализ", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await retry.click({ force: true });
  await expect.poll(() => retryPosts).toBe(1);
  await expect(library.getByRole("status")).toHaveText("Ответ сохранён", { timeout: 10_000 });
  await expect(library.getByLabel("Источники ответа")).toContainText("contract.pdf, стр. 2");
});

test("lost retry response reconciles history instead of re-dispatching after reload", async ({
  page
}) => {
  const { path } = project();
  const sourceId = randomUUID();
  const newId = randomUUID();
  let answers: unknown[] = [failedAnswer(sourceId)];
  let retryPosts = 0;
  const library = await open(page, path, () => answers);
  await page.route(`**${path}/answers/${sourceId}/retry`, async (route) => {
    retryPosts++;
    answers = [failedAnswer(sourceId), doneAnswer(newId)];
    await route.abort("failed");
  });
  await page.route(`**${path}/answers/${newId}`, (route) =>
    route.fulfill({ json: doneAnswer(newId) })
  );

  await library.getByRole("button", { name: "Повторить анализ", exact: true }).click();
  await expect(library.getByRole("status")).toHaveText("Ответ сохранён");
  await page.reload();
  await expect(library.getByRole("status")).toHaveText("Ответ сохранён");
  expect(retryPosts).toBe(1);
});

test("cancelled deep run can be retried explicitly", async ({ page }) => {
  const { path } = project();
  const sourceId = randomUUID();
  const newId = randomUUID();
  let answers: unknown[] = [
    { ...failedAnswer(sourceId), status: "cancelled", error_code: "CANCELLED" }
  ];
  const library = await open(page, path, () => answers);
  await page.route(`**${path}/answers/${sourceId}/retry`, async (route) => {
    answers = [{ ...failedAnswer(sourceId), status: "cancelled" }, doneAnswer(newId)];
    await route.fulfill({ status: 202, json: doneAnswer(newId) });
  });
  await page.route(`**${path}/answers/${newId}`, (route) =>
    route.fulfill({ json: doneAnswer(newId) })
  );

  await expect(library.getByRole("status")).toHaveText("Запрос отменён");
  await library.getByRole("button", { name: "Повторить анализ", exact: true }).click();
  await expect(library.getByRole("status")).toHaveText("Ответ сохранён");
});
