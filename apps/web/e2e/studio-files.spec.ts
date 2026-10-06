import { expect, test } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";

function pdfFixture(pages: number): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 5} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  const stream = "BT /F1 12 Tf 20 80 Td (Cosmora document page) Tj ET";
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  for (let i = 0; i < pages; i++)
    objects.push(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>"
    );
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

test("finds and transfers a selected part of a large Unicode document without a model call", async ({
  page
}) => {
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") posts++;
  });
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({ json: { process_stop: { active: true } } })
  );
  await page.goto("/?surface=files");
  await expect(page.getByRole("heading", { name: "Анализ крупных файлов" })).toBeVisible();
  const content =
    "# Начало\n" +
    "Большой документ с данными. 😀\n".repeat(3_000) +
    "\n# Итоги\nУникальная рекомендация Cosmora\n";
  await page.getByLabel("Крупный документ").setInputFiles({
    name: "research.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(content)
  });
  await expect(page.getByRole("heading", { name: "research.md" })).toBeVisible();
  await expect(page.getByLabel("Часть документа").locator("option")).not.toHaveCount(1);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать текст" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("research.md.txt");
  await page.getByLabel("Поиск по файлу").fill("Уникальная рекомендация");
  await expect(page.getByRole("status")).toHaveText("Найдено совпадений: 1");
  await page.getByRole("button", { name: /Часть \d+.*Уникальная рекомендация/s }).click();
  await expect(page.getByLabel("Содержимое документа").locator("pre")).toContainText(
    "Уникальная рекомендация"
  );
  await page.getByLabel("Что разобрать?").fill("Проверь рекомендацию");
  await page.getByRole("button", { name: "Разобрать эту часть в чате" }).click();
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue(/Проверь рекомендацию/);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "document-part-"
  );
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled();
  await expect(page.locator(".composer")).not.toContainText(
    /Shift|приостановлены|Провайдер настроен/
  );
  expect(posts).toBe(0);
});

test("extracts a PDF over the chat page limit and a large real DOCX", async ({ page }) => {
  await page.goto("/?surface=files");
  const input = page.getByLabel("Крупный документ");
  await input.setInputFiles({
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: pdfFixture(25)
  });
  await expect(page.getByRole("heading", { name: "report.pdf" })).toBeVisible();
  await expect(page.getByLabel("Содержимое документа").locator("pre")).toContainText(
    "Cosmora document page"
  );
  const text = "Требования к проекту Cosmora. ".repeat(1_000);
  const zip = zipSync({
    "word/document.xml": strToU8(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    )
  });
  await input.setInputFiles({
    name: "requirements.docx",
    mimeType: "application/zip",
    buffer: Buffer.from(zip)
  });
  await expect(page.getByRole("heading", { name: "requirements.docx" })).toBeVisible();
  await expect(page.getByLabel("Часть документа").locator("option")).not.toHaveCount(1);
});

test("rejects oversized text, compressed expansion and binary files with no truncation", async ({
  page
}) => {
  await page.goto("/?surface=files");
  const input = page.getByLabel("Крупный документ");
  await input.setInputFiles({
    name: "large.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(2_000_001, "x")
  });
  await expect(page.getByLabel("Загрузка документа").getByRole("alert")).toContainText(
    "2 000 000 символов"
  );
  const zip = zipSync({ "word/document.xml": strToU8("x".repeat(8_000_001)) });
  await input.setInputFiles({
    name: "bomb.docx",
    mimeType: "application/zip",
    buffer: Buffer.from(zip)
  });
  await expect(page.getByLabel("Загрузка документа").getByRole("alert")).toContainText(
    "после распаковки"
  );
  await input.setInputFiles({
    name: "binary.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0, 2, 3, 4])
  });
  await expect(page.getByLabel("Загрузка документа").getByRole("alert")).toContainText(
    "двоичные данные"
  );
  await expect(page.getByLabel("Содержимое документа")).toHaveCount(0);
});

test("keeps file analysis usable on mobile and restores the Studio section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?surface=files");
  await page.getByLabel("Крупный документ").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Мобильная проверка\n".repeat(800))
  });
  await expect(page.getByRole("button", { name: "Разобрать эту часть в чате" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Анализ крупных файлов" })).toBeVisible();
  await expect(page.getByLabel("Содержимое документа")).toHaveCount(0);
});

test("parses quoted multiline CSV, filters columns and prepares bounded rows", async ({ page }) => {
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") posts++;
  });
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({ json: { process_stop: { active: true } } })
  );
  await page.goto("/?surface=files");
  const csv = [
    "name;note;score;empty",
    'Alice;"line one\nline two";10;',
    'Боб;"quoted ; delimiter";20,5;',
    'Zoë;"says ""hello""";bad;value'
  ].join("\r\n");
  await page
    .getByLabel("Крупный документ")
    .setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByRole("heading", { name: "people.csv" })).toBeVisible();
  await expect(
    page.getByLabel("Таблица CSV").getByRole("cell", { name: /line one/ })
  ).toContainText("line two");
  await expect(page.getByText("3", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Поиск / фильтр по выбранным столбцам").fill("боб");
  await expect(page.getByRole("status")).toHaveText("После фильтра: 1 из 3 записей");
  await expect(page.getByLabel("Таблица CSV")).toContainText("quoted ; delimiter");
  await page.getByLabel("Числовая статистика").selectOption({ label: "score" });
  await expect(page.getByText("Среднее", { exact: true }).locator("..")).toContainText("20,5");
  await page.getByLabel("Что разобрать?").fill("Сравни выбранные строки");
  await page.getByRole("button", { name: "Подготовить выборку в чате" }).click();
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue(/1 из 1 строк текущего фильтра/);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "csv-selection.csv"
  );
  expect(posts).toBe(0);
});

test("finds Unicode text across a part boundary and highlights the destination", async ({
  page
}) => {
  await page.goto("/?surface=files");
  const prefix = "x".repeat(4498);
  const content = prefix + "Cafe\u0301 Москва конец";
  await page
    .getByLabel("Крупный документ")
    .setInputFiles({ name: "boundary.txt", mimeType: "text/plain", buffer: Buffer.from(content) });
  await page.getByLabel("Поиск по файлу").fill("CAFÉ МОСКВА");
  await expect(page.getByRole("status")).toHaveText("Найдено совпадений: 1");
  await page
    .getByRole("button", { name: /Части 1–2/ })
    .first()
    .click();
  await expect(page.locator("#studio-document-preview mark")).toHaveCount(1);
  await page.getByRole("button", { name: "Следующее совпадение" }).click();
  await expect(page.getByLabel("Часть документа")).toHaveValue("0");
});

test("handles about 200k short CSV rows without spreading the row array", async ({ page }) => {
  await page.goto("/?surface=files");
  const records = 200_000;
  const csv =
    "id,value\n" + Array.from({ length: records }, (_, index) => `${index % 10},x`).join("\n");
  expect(csv.length).toBeLessThan(2_000_000);

  await page.getByLabel("Крупный документ").setInputFiles({
    name: "many-short-rows.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv)
  });

  await expect(page.getByRole("heading", { name: "many-short-rows.csv" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    /После фильтра: 200\s?000 из 200\s?000 записей/
  );
  await expect(page.getByLabel("Загрузка документа").getByRole("alert")).toHaveCount(0);
});

test("preserves empty CSV records, reports numeric coverage and rejects malformed quotes", async ({
  page
}) => {
  await page.goto("/?surface=files");
  const input = page.getByLabel("Крупный документ");
  await input.setInputFiles({
    name: "coverage.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name;score;note\r\nAlice;10;ok\r\n;;\r\nБоб;20,5;ok\r\nZoë;bad;ok")
  });
  await expect(page.getByRole("heading", { name: "coverage.csv" })).toBeVisible();
  await expect(page.getByText("4", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Числовая статистика").selectOption({ label: "score" });
  await expect(page.getByText("15,25")).toBeVisible();
  await expect(page.getByText("Нечисловых").locator("..")).toContainText("1");
  await expect(page.getByText(/проверено 4 из 4 строк/i)).toBeVisible();

  await input.setInputFiles({
    name: "malformed.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('name,note\nAlice,"ok"oops')
  });
  await expect(page.getByLabel("Загрузка документа").getByRole("alert")).toContainText(
    "после закрывающей кавычки"
  );
  await expect(page.getByRole("heading", { name: "malformed.csv" })).toHaveCount(0);
});

test("replacing a pending large read cannot restore a stale document or stale error", async ({
  page
}) => {
  await page.goto("/?surface=files");
  const input = page.getByLabel("Крупный документ");
  const oversizedText = Buffer.from("x".repeat(2_000_001));
  await input.setInputFiles({ name: "old.txt", mimeType: "text/plain", buffer: oversizedText });
  await input.setInputFiles({
    name: "new.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Новый документ должен остаться активным.")
  });
  await expect(page.getByRole("heading", { name: "new.txt" })).toBeVisible();
  await expect(page.getByLabel("Содержимое документа")).toContainText(
    "Новый документ должен остаться активным."
  );
  await expect(page.getByRole("heading", { name: "old.txt" })).toHaveCount(0);
  await expect(page.getByLabel("Загрузка документа").getByRole("alert")).toHaveCount(0);
});

test("moves the active highlight between multiple matches in the same part", async ({ page }) => {
  await page.goto("/?surface=files");
  await page.getByLabel("Крупный документ").setInputFiles({
    name: "matches.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Цель один. Несколько слов между. ЦЕЛЬ два.")
  });
  await page.getByLabel("Поиск по файлу").fill("цель");
  await expect(page.getByRole("status")).toHaveText("Найдено совпадений: 2");
  await expect(page.locator("#studio-active-search-match")).toHaveText("Цель");
  await page.getByRole("button", { name: "Следующее совпадение" }).click();
  await expect(page.locator("#studio-active-search-match")).toHaveText("ЦЕЛЬ");
});
