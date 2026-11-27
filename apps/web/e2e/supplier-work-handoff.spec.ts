import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("hands off a chat message and reopens the verified, accepted supplier comparison", async ({
  browser,
  page,
  request
}) => {
  test.setTimeout(60000);
  const projectTitle = "Закупка " + crypto.randomUUID();
  const created = await request.post("/api/v1/projects/empty", {
    data: { title: projectTitle, client_project_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const base = "/api/v1/projects/" + project.id;
  const instructions = "Срок указывать отдельно, доплаты проверить.";
  expect(
    (
      await request.put(base + "/materials", {
        data: { version: 0, instructions, attachments: [] }
      })
    ).status()
  ).toBe(200);
  expect(
    (
      await request.put(base + "/autonomy-profile", {
        data: { base_level: "A2", overrides: [], expected_version: 1 }
      })
    ).status()
  ).toBe(200);

  const requirement = { itemId: "00123", label: "Крепёж", quantity: 10, unit: "шт" };
  const spec = JSON.stringify({ requirements: [requirement] });
  const offer = (supplier: string, quantity: number, unitPrice: number) => ({
    supplier,
    currency: "RUB",
    deliveryDays: 4,
    additionalCosts: [],
    lines: [{ itemId: requirement.itemId, quantity, unit: "шт", unitPrice }]
  });
  const offers = JSON.stringify({ offers: [offer("Альфа", 10, 1970), offer("Бета", 8, 1800)] });
  const question = "Сверь предложения поставщиков и выдели расхождения.";
  await page.goto("/?mode=kosmora");
  await page.getByLabel("Текстовые файлы и код").setInputFiles([
    { name: "requirements.json", mimeType: "application/json", buffer: Buffer.from(spec) },
    { name: "offers.json", mimeType: "application/json", buffer: Buffer.from(offers) },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Не переносить в расчёт.") }
  ]);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "offers.json"
  );
  await page.getByLabel("Сообщение Kosmora").fill(question);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();

  await page.getByRole("button", { name: "Сравнить поставщиков в Koswork", exact: true }).click();
  const preview = page.getByRole("region", { name: "Передача в Koswork" });
  await preview.getByRole("combobox", { name: "Проект" }).selectOption(project.id);
  await expect(preview.getByText(question, { exact: true })).toBeVisible();
  await expect(preview.getByRole("checkbox", { name: "requirements.json" })).toBeChecked();
  await expect(preview.getByRole("checkbox", { name: "offers.json" })).toBeChecked();
  await expect(preview.getByText(/Вложения вне расчёта.*notes.txt/)).toBeVisible();
  await expect(preview.getByText(instructions, { exact: true })).toBeVisible();

  const updatedInstructions = instructions + " Уточнить количество крепежа.";
  expect(
    (
      await request.put(base + "/materials", {
        data: { version: 1, instructions: updatedInstructions, attachments: [] }
      })
    ).status()
  ).toBe(200);
  await preview.getByRole("button", { name: "Создать задачу сравнения" }).click();
  await expect(preview.getByRole("alert")).toContainText("Материалы проекта изменились.");
  await expect(preview.getByText(updatedInstructions, { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "Создать задачу сравнения" }).click();

  await expect(page).toHaveURL(/[?&]work=[^&]+/);
  const permalink = page.url();
  const workId = new URL(permalink).searchParams.get("work")!;
  const workUrl = base + "/work/" + workId;
  const section = page.getByRole("region", { name: "Сдача сравнения поставщиков" });
  await expect(section).toContainText("Выполненные проверки");
  const sources = section.getByRole("region", { name: "Источники запуска" });
  await expect(sources).toContainText("requirements.json");
  await expect(sources).toContainText("offers.json");
  await expect(sources).not.toContainText("notes.txt");
  await expect(section).toContainText("К этому результату правила не применялись.");
  await expect(section).toContainText("Бета · 00123 · недокомплект");
  await expect(section).toContainText(createHash("sha256").update(spec).digest("hex"));
  await expect(section).toContainText(createHash("sha256").update(offers).digest("hex"));
  await expect(section).not.toContainText("notes.txt");
  const original = await section
    .getByRole("link", { name: "Исходное сообщение Kosmora" })
    .getAttribute("href");
  expect(original).toMatch(/[?&]message=[^&]+/);
  await section.getByText("Сообщение и инструкции на момент запуска").click();
  await expect(section).toContainText(updatedInstructions);

  const downloadEvent = page.waitForEvent("download");
  await section.getByRole("link", { name: "supplier-comparison.csv", exact: true }).click();
  const downloaded = await downloadEvent;
  expect(downloaded.suggestedFilename()).toBe("supplier-comparison.csv");
  const bytes = await readFile((await downloaded.path())!);
  expect(bytes.toString()).toContain("19700");
  expect(bytes.toString()).toContain("00123");
  const evidence = await request.get(workUrl + "/files/supplier-evidence.json");
  expect(evidence.status()).toBe(200);
  expect(await evidence.json()).toMatchObject({
    format: "kosmora.supplier-comparison-evidence.v1",
    disputes: [{ supplier: "Бета", item_id: "00123", reason: "недокомплект" }]
  });
  await page.getByRole("button", { name: "Принять результат", exact: true }).click();
  const acceptance = page.getByRole("status").filter({ hasText: /Результат принят владельцем/ });
  await expect(acceptance).toBeVisible();
  const receipt = await acceptance.textContent();
  await page.reload();
  await expect(page).toHaveURL(permalink);
  await expect(acceptance).toHaveText(receipt!);
  await expect(section).toContainText("Бета · 00123 · недокомплект");
  const sameBytes = await request.get(workUrl + "/files/supplier-comparison.csv");
  expect(await sameBytes.body()).toEqual(bytes);

  const rules = section
    .locator("details")
    .filter({ has: page.getByText("Правила следующих сравнений", { exact: true }) });
  await rules.locator("summary").click();
  await rules
    .getByLabel("Исправление для следующей задачи")
    .fill("Всегда показывай доставку отдельной строкой");
  await rules.getByRole("button", { name: "Предложить правило" }).click();
  await expect(rules.locator("blockquote")).toContainText(
    "Всегда показывай доставку отдельной строкой"
  );
  await rules.getByRole("button", { name: "Подтвердить правило" }).click();
  await expect(rules).toContainText("Доставка отдельной строкой · версия 1 · включено");

  const nextTab = await browser.newPage();
  try {
    await nextTab.goto(new URL(original!, permalink).toString());
    await nextTab
      .getByRole("button", { name: "Сравнить поставщиков в Koswork", exact: true })
      .click();
    const nextPreview = nextTab.getByRole("region", { name: "Передача в Koswork" });
    await nextPreview.getByRole("combobox", { name: "Проект" }).selectOption(project.id);
    await nextPreview.getByRole("button", { name: "Создать задачу сравнения" }).click();
    const nextResult = nextTab.getByRole("region", { name: "Сдача сравнения поставщиков" });
    await expect(nextResult).toContainText("Применённые правила");
    await expect(nextResult).toContainText("Доставка отдельной строкой · версия 1");
    const newReport = nextResult.getByRole("link", {
      name: "supplier-comparison.csv",
      exact: true
    });
    const newCsv = await request.get((await newReport.getAttribute("href"))!);
    expect(await newCsv.text()).toContain("Доставка,Альфа,RUB,4");
    expect(bytes.toString()).not.toContain("Доставка,Альфа,RUB,4");
    expect(
      await nextTab.getByRole("link", { name: "Постоянная ссылка на задачу" }).getAttribute("href")
    ).not.toContain(workId);
    expect(await (await request.get(workUrl + "/files/supplier-comparison.csv")).body()).toEqual(
      bytes
    );
    const nextRules = nextResult.locator("details").filter({
      has: nextTab.getByText("Правила следующих сравнений", { exact: true })
    });
    await nextRules.locator("summary").click();
    await nextRules.getByRole("button", { name: "Отключить правило" }).click();
    await expect(nextRules).toContainText("Доставка отдельной строкой · версия 2 · отключено");
    await nextTab.goto(new URL(original!, permalink).toString());
    await nextTab.getByRole("button", { name: "Сравнить поставщиков в Koswork" }).click();
    await nextPreview.getByRole("combobox", { name: "Проект" }).selectOption(project.id);
    await nextPreview.getByRole("button", { name: "Создать задачу сравнения" }).click();
    await expect(nextResult).toContainText("К этому результату правила не применялись.");
    expect(await (await request.get((await newReport.getAttribute("href"))!)).body()).toEqual(
      bytes
    );
  } finally {
    await nextTab.close();
  }

  const independentTab = await browser.newPage();
  try {
    await independentTab.goto(permalink);
    await expect(
      independentTab.getByRole("status").filter({ hasText: /Результат принят владельцем/ })
    ).toHaveText(receipt!);
    await independentTab.getByRole("link", { name: "Исходное сообщение Kosmora" }).click();
    const sourceId = new URL(original!, permalink).searchParams.get("message");
    await expect(independentTab.locator("#chat-message-" + sourceId)).toBeFocused();
    await expect(independentTab.locator("#chat-message-" + sourceId)).toContainText(question);
  } finally {
    await independentTab.close();
  }
});

test("resumes an incomplete comparison in the same task after reload and a lost answer response", async ({
  page,
  request
}) => {
  test.setTimeout(60000);
  const created = await request.post("/api/v1/projects/empty", {
    data: { title: "Уточнение " + crypto.randomUUID(), client_project_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const base = "/api/v1/projects/" + project.id;
  expect(
    (
      await request.put(base + "/autonomy-profile", {
        data: { base_level: "A2", overrides: [], expected_version: 1 }
      })
    ).status()
  ).toBe(200);
  const requirement = { itemId: "00123", label: "Крепёж", quantity: 10, unit: "шт" };
  const offer = (supplier: string, unitPrice: number) => ({
    supplier,
    currency: "RUB",
    deliveryDays: 4,
    additionalCosts: [],
    lines: [{ itemId: requirement.itemId, quantity: 10, unit: "шт", unitPrice }]
  });
  const initial = JSON.stringify({ requirements: [requirement], offers: [offer("Альфа", 1970)] });
  const answer = JSON.stringify({ offers: [offer("Бета", 1800)] });
  await page.goto("/?mode=kosmora");
  await page.getByLabel("Сообщение Kosmora").fill(initial);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page.getByRole("button", { name: "Сравнить поставщиков в Koswork" }).click();
  const preview = page.getByRole("region", { name: "Передача в Koswork" });
  await preview.getByRole("combobox", { name: "Проект" }).selectOption(project.id);
  await preview.getByRole("button", { name: "Создать задачу сравнения" }).click();

  const clarification = page.getByRole("form", { name: "Уточнение сравнения поставщиков" });
  await expect(clarification).toContainText("дополнительное предложение");
  const permalink = page.url();
  const workId = new URL(permalink).searchParams.get("work");
  expect(workId).toBeTruthy();
  const workUrl = base + "/work/" + workId;
  const before = await (await request.get(workUrl)).json();
  expect(before.status).toBe("blocked");
  expect((await request.get(workUrl + "/files/supplier-comparison.csv")).status()).toBe(404);
  await page.reload();
  await expect(clarification).toBeVisible();
  await expect(page).toHaveURL(permalink);

  const submit = clarification.getByRole("button", { name: "Продолжить сравнение" });
  const editor = clarification.getByLabel("Недостающие данные JSON");
  await editor.fill('{"offers":[]}');
  await submit.click();
  await expect(
    page.getByText("Добавьте недостающие данные в JSON.", { exact: false })
  ).toBeVisible();
  await expect(editor).toHaveValue('{"offers":[]}');
  const stale = await request.post(workUrl + "/supplier-answer", {
    data: { expected_version: before.version + 1, answer }
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toEqual({ error: "STALE_EXECUTION" });

  let posts = 0;
  let responseStatus = 0;
  await page.route("**/supplier-answer", async (route) => {
    posts++;
    responseStatus = (await route.fetch()).status();
    await route.abort();
  });
  await editor.fill(answer);
  await submit.click();
  const section = page.getByRole("region", { name: "Сдача сравнения поставщиков" });
  await expect(section.getByRole("link", { name: "supplier-comparison.csv" })).toBeVisible();
  expect(posts).toBe(1);
  expect(responseStatus).toBe(200);

  const final = await (await request.get(workUrl)).json();
  expect(final).toMatchObject({
    id: workId,
    request: { goal: initial },
    supplier_handoff: before.supplier_handoff,
    supplier_clarification: { question: before.supplier_clarification.question, answer }
  });
  const input = await (await request.get(workUrl + "/files/supplier-input.json")).json();
  expect(input).toEqual({
    requirements: [requirement],
    offers: [offer("Альфа", 1970), offer("Бета", 1800)]
  });
  const duplicate = await request.post(workUrl + "/supplier-answer", {
    data: { expected_version: before.version, answer }
  });
  expect((await duplicate.json()).version).toBe(final.version);
  await expect(page).toHaveURL(permalink);
  await expect(section).toContainText("Уточнение владельца");
});
