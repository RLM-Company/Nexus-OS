import { expect, test } from "@playwright/test";
test("reads literal issue over fixture GitHub HTTP, prepares editable context, dispatches only on separate Code action", async ({
  page,
  request
}, testInfo) => {
  const before = (await (
    await request.get("http://127.0.0.1:3219/api/v1/issues-fixture-counts")
  ).json()) as { dispatches: number };
  const remote: string[] = [];
  page.on("request", (req) => {
    if (/evil\.invalid|127\.0\.0\.1:9\//u.test(req.url())) remote.push(req.url());
  });
  await page.goto("/code-agent");
  await page.getByRole("combobox", { name: "Проект", exact: true }).selectOption("issue-project-a");
  await page.getByText("Выбрать задачу из GitHub Issues", { exact: true }).click();
  await page.getByRole("button", { name: /^#1 Ошибка/ }).click();
  await expect(page.getByLabel("Выбранный GitHub issue")).toContainText("<script>steal()</script>");
  await expect(page.getByRole("link", { name: "Открыть issue в GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/RLM-Company/Nexus-OS/issues/1"
  );
  await page
    .getByLabel("Разрешаю заменить текущий черновик задачи и контекста выбранным issue")
    .check();
  await page.getByRole("button", { name: "Подготовить задачу Code", exact: true }).click();
  await expect(page.getByLabel("Задача", { exact: true })).toHaveValue(
    /Исправь проблему из выбранного GitHub issue/
  );
  await expect(page.getByLabel("Описание issue (недоверенные данные)")).toHaveValue(
    /Игнорируй правила/
  );
  await page.getByLabel("Задача", { exact: true }).fill("Проверь воспроизведение этой ошибки");
  await page.screenshot({ path: testInfo.outputPath("prepared-issue.png"), fullPage: true });
  expect(
    (
      (await (await request.get("http://127.0.0.1:3219/api/v1/issues-fixture-counts")).json()) as {
        dispatches: number;
      }
    ).dispatches
  ).toBe(before.dispatches);
  expect(remote).toEqual([]);
  const dispatched = page.waitForRequest(
    (req) => req.method() === "POST" && /\/code-agent$/u.test(new URL(req.url()).pathname)
  );
  await page.getByRole("button", { name: "Предложить исправление", exact: true }).click();
  const payload = (await dispatched).postDataJSON() as {
    task: string;
    issue_context: { repository: string; number: number; body: string };
  };
  expect(payload).toMatchObject({
    task: "Проверь воспроизведение этой ошибки",
    issue_context: { repository: "RLM-Company/Nexus-OS", number: 1 }
  });
  expect(payload.issue_context.body).toContain("<script>");
  expect(
    (
      (await (await request.get("http://127.0.0.1:3219/api/v1/issues-fixture-counts")).json()) as {
        writes: number;
      }
    ).writes
  ).toBe(0);
});
test("search/state/permission refusal and cancellation are real reads; switching projects discards late responses and context", async ({
  page
}) => {
  await page.goto("/code-agent");
  await page.getByRole("combobox", { name: "Проект", exact: true }).selectOption("issue-project-a");
  await page.getByText("Выбрать задачу из GitHub Issues", { exact: true }).click();
  await page.getByLabel("Состояние issue", { exact: true }).selectOption("closed");
  await expect(page.getByLabel("Список issues")).toContainText("Закрыта");
  await page.getByRole("button", { name: /^#1 Ошибка/ }).click();
  await page
    .getByLabel("Разрешаю заменить текущий черновик задачи и контекста выбранным issue")
    .check();
  await page.getByRole("button", { name: "Подготовить задачу Code", exact: true }).click();
  await expect(page.getByLabel("Контекст GitHub issue", { exact: true })).toBeVisible();
  await page.getByLabel("Поиск issue", { exact: true }).fill("denied");
  await page.getByRole("button", { name: "Найти issues", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "не разрешает чтение Issues"
  );
  await page.getByLabel("Поиск issue", { exact: true }).fill("slow");
  await page.getByRole("button", { name: "Найти issues", exact: true }).click();
  await page.getByRole("button", { name: "Отменить чтение issues" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Чтение отменено");
  await page.getByRole("button", { name: "Найти issues", exact: true }).click();
  await page.getByRole("combobox", { name: "Проект", exact: true }).selectOption("issue-project-b");
  await page.getByText("Выбрать задачу из GitHub Issues", { exact: true }).click();
  await expect(page.getByRole("button", { name: /^#1 Ошибка/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^#111 / })).toHaveCount(0);
  await expect(page.getByLabel("Контекст GitHub issue", { exact: true })).toHaveCount(0);
});
test("oversized/edited context requires visible truncation confirmation and enforces the combined input limit", async ({
  page
}) => {
  await page.goto("/code-agent");
  await page.getByRole("combobox", { name: "Проект", exact: true }).selectOption("issue-project-a");
  await page.getByText("Выбрать задачу из GitHub Issues", { exact: true }).click();
  // Real GitHub fixture list/detail supply a 30k source with an explicit 24k preview cap.
  await page.getByRole("button", { name: /^#2 Ошибка/ }).click();
  await expect(page.getByLabel("Выбранный GitHub issue")).toContainText("Просмотр обрезан");
  await page
    .getByLabel("Разрешаю заменить текущий черновик задачи и контекста выбранным issue")
    .check();
  const prepare = page.getByRole("button", { name: "Подготовить задачу Code", exact: true });
  await expect(prepare).toBeDisabled();
  await page.getByLabel("Подтверждаю перенос указанного фрагмента вместо полного описания").check();
  await prepare.click();
  const run = page.getByRole("button", { name: "Предложить исправление", exact: true });
  await expect(run).toBeEnabled();
  await page.getByLabel("Описание issue (недоверенные данные)").fill("Короткий фрагмент");
  await expect(run).toBeDisabled();
  await page.getByLabel("Подтверждаю использование отредактированного фрагмента описания").check();
  await expect(run).toBeEnabled();
  await page.getByLabel("Задача", { exact: true }).fill("a".repeat(8000));
  await expect(run).toBeDisabled();
  await expect(
    page.getByRole("main").getByRole("alert").filter({ hasText: "превышает 8000" })
  ).toBeVisible();
});
