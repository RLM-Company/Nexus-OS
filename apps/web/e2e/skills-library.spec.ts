import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const base = "/api/v1/owner-skills";
const editor = (page: Page) => page.getByRole("region", { name: "Редактор Skill", exact: true });
const draft = (name = `Skill ${randomUUID()}`) => ({
  name,
  summary: "Конспект истории",
  instructions: "Точная инструкция 😀\r\n<literal>"
});
async function seed(request: APIRequestContext) {
  const value = draft();
  const response = await request.post(base, { data: value });
  expect(response.status()).toBe(201);
  return { draft: value, id: ((await response.json()) as { id: string }).id };
}
async function open(page: Page, name: string) {
  await page.goto("/skills");
  await page
    .getByRole("complementary", { name: "Мои Skills" })
    .getByRole("button", { name: `${name} Версия 1`, exact: true })
    .click();
  await expect(editor(page).getByRole("textbox", { name: "Название", exact: true })).toHaveValue(
    name
  );
}
test("file selection previews and verifies locally, then imports once after explicit review", async ({
  page
}) => {
  await page.goto("/skills");
  const value = draft();
  const pack = {
    format: "kosmora.skill.v1",
    ...value,
    execution: "disabled",
    permissions: [],
    sha256: createHash("sha256")
      .update(JSON.stringify([value.name, value.summary, value.instructions]))
      .digest("hex")
  };
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(`${base}/import`)) writes++;
  });
  const file = page.getByLabel("Выберите пакет Skill");
  await file.setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...pack, instructions: "changed" }))
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText("SHA-256");
  expect(writes).toBe(0);
  await file.setInputFiles({
    name: "skill.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pack))
  });
  const submit = page.getByRole("button", { name: "Импортировать новую копию", exact: true });
  await expect(submit).toBeDisabled();
  expect(writes).toBe(0);
  await page.getByLabel("Проверил текст импортируемой инструкции").check();
  await submit.click();
  await expect(editor(page).getByRole("textbox", { name: "Название", exact: true })).toHaveValue(
    value.name
  );
  expect(writes).toBe(1);
});
test("copy preserves draft text, saves a new identity and leaves source unchanged", async ({
  page,
  request
}) => {
  const source = await seed(request);
  await open(page, source.draft.name);
  await editor(page)
    .getByRole("textbox", { name: "Инструкция", exact: true })
    .fill("Новый черновик");
  await editor(page)
    .getByRole("button", { name: "Копировать в новый черновик", exact: true })
    .click();
  await expect(editor(page).getByRole("textbox", { name: "Инструкция", exact: true })).toHaveValue(
    "Новый черновик"
  );
  const created = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith(base)
  );
  await editor(page).getByRole("button", { name: "Сохранить версию", exact: true }).click();
  const copy = (await (await created).json()) as { id: string };
  expect(copy.id).not.toBe(source.id);
  const unchanged = (await (await request.get(`${base}/${source.id}`)).json()) as {
    versions: { instructions: string }[];
  };
  expect(unchanged.versions[0]!.instructions).toBe(source.draft.instructions);
  await page.getByRole("textbox", { name: "Поиск Skills", exact: true }).fill("НЕСУЩЕСТВУЮЩЕЕ");
  await expect(
    page.getByRole("complementary", { name: "Мои Skills" }).getByText(/^0 из/)
  ).toBeVisible();
});
test("restoration review is invalidated by edits; lost response is read back without second restore", async ({
  page,
  request
}) => {
  const source = await seed(request);
  await open(page, source.draft.name);
  await editor(page).getByRole("textbox", { name: "Инструкция", exact: true }).fill("Версия два");
  await editor(page).getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(
    editor(page).getByRole("button", { name: "Сохранить версию", exact: true })
  ).toBeDisabled();
  await editor(page).getByRole("button", { name: "Посмотреть версию 1", exact: true }).click();
  await page.getByLabel("Проверил изменения Skill").check();
  await editor(page).getByRole("textbox", { name: "Инструкция", exact: true }).fill("Ещё правка");
  const restore = page.getByRole("button", { name: "Восстановить версию 1", exact: true });
  await expect(restore).toBeDisabled();
  await page.getByLabel("Проверил изменения Skill").check();
  let restores = 0;
  await page.route(`**${base}/${source.id}/restore`, async (route) => {
    restores++;
    expect((await route.fetch()).status()).toBe(200);
    await route.abort("failed");
  });
  page.once("dialog", (dialog) => void dialog.accept());
  await restore.click();
  await expect(editor(page).getByText("v3 · Без изменений", { exact: true })).toBeVisible();
  expect(restores).toBe(1);
});
test("dirty navigation can be cancelled and conflicts leave an exportable draft", async ({
  page,
  request
}) => {
  const source = await seed(request);
  await open(page, source.draft.name);
  const text = editor(page).getByRole("textbox", { name: "Инструкция", exact: true });
  await text.fill("Локальные правки");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Новая", exact: true }).click();
  await expect(text).toHaveValue("Локальные правки");
  expect(
    (
      await request.put(`${base}/${source.id}`, {
        data: { ...source.draft, instructions: "Другой клиент", expected_version: 1 }
      })
    ).status()
  ).toBe(200);
  await editor(page).getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(editor(page).getByRole("status")).toContainText("Другая версия");
  await expect(text).toHaveValue("Локальные правки");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать черновик", exact: true }).click();
  const exported = JSON.parse(await readFile((await (await downloading).path())!, "utf8")) as {
    instructions: string;
  };
  expect(exported.instructions).toBe("Локальные правки");
});
test("lost creation response is resolved by its server receipt without another POST", async ({
  page,
  request
}) => {
  await page.goto("/skills");
  const value = draft();
  await editor(page).getByRole("textbox", { name: "Название", exact: true }).fill(value.name);
  await editor(page)
    .getByRole("textbox", { name: "Краткое описание", exact: true })
    .fill(value.summary);
  await editor(page)
    .getByRole("textbox", { name: "Инструкция", exact: true })
    .fill(value.instructions);
  let creates = 0;
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    creates++;
    expect((await route.fetch()).status()).toBe(201);
    await route.abort("failed");
  });
  await editor(page).getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(editor(page).getByRole("status")).toContainText("Инструкция сохранена");
  await expect(
    editor(page).getByRole("button", { name: "Сохранить версию", exact: true })
  ).toBeDisabled();
  expect(creates).toBe(1);
  const items = ((await (await request.get(base)).json()) as { items: { name: string }[] }).items;
  expect(items.filter((item) => item.name === value.name)).toHaveLength(1);
});

test("a lost creation and receipt read survive reload; retry reuses the same key", async ({
  page,
  request
}) => {
  await page.goto("/skills");
  const value = draft();
  await editor(page).getByRole("textbox", { name: "Название", exact: true }).fill(value.name);
  await editor(page)
    .getByRole("textbox", { name: "Краткое описание", exact: true })
    .fill(value.summary);
  await editor(page)
    .getByRole("textbox", { name: "Инструкция", exact: true })
    .fill(value.instructions);
  const keys: string[] = [];
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]!);
    expect((await route.fetch()).status()).toBe(201);
    await route.abort("failed");
  });
  await page.route(`**${base}/creations/*`, (route) => route.abort("failed"));
  await editor(page).getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(page.getByRole("region", { name: "Проверка создания" })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByRole("region", { name: "Проверка создания" })).toContainText(value.name);
  await expect(editor(page).getByRole("textbox", { name: "Название", exact: true })).toBeDisabled();
  await page.unroute(`**${base}`);
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(base))
      keys.push(request.headers()["idempotency-key"]!);
  });
  await page.getByRole("button", { name: "Повторить сохранённую попытку", exact: true }).click();
  await expect(editor(page).getByRole("status")).toContainText("Инструкция сохранена");
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const items = ((await (await request.get(base)).json()) as { items: { name: string }[] }).items;
  expect(items.filter((item) => item.name === value.name)).toHaveLength(1);
});
test("an unaccepted attempt retries explicitly and receipt checks do not create anything", async ({
  page,
  request
}) => {
  await page.goto("/skills");
  const value = draft();
  await editor(page).getByRole("textbox", { name: "Название", exact: true }).fill(value.name);
  await editor(page)
    .getByRole("textbox", { name: "Краткое описание", exact: true })
    .fill(value.summary);
  await editor(page)
    .getByRole("textbox", { name: "Инструкция", exact: true })
    .fill(value.instructions);
  let posts = 0;
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await route.abort("failed");
  });
  await editor(page).getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(page.getByRole("region", { name: "Проверка создания" })).toBeVisible();
  await page.getByRole("button", { name: "Проверить результат создания", exact: true }).click();
  await expect(editor(page).getByRole("status")).toContainText("больше не существует");
  expect(posts).toBe(1);
  const before = ((await (await request.get(base)).json()) as { items: { name: string }[] }).items;
  expect(before.filter((item) => item.name === value.name)).toHaveLength(0);
  await page.unroute(`**${base}`);
  await page.getByRole("button", { name: "Повторить сохранённую попытку", exact: true }).click();
  await expect(editor(page).getByRole("status")).toContainText("Инструкция сохранена");
  const after = ((await (await request.get(base)).json()) as { items: { name: string }[] }).items;
  expect(after.filter((item) => item.name === value.name)).toHaveLength(1);
});
test("an accepted but deleted attempt never recreates a Skill after reload", async ({
  page,
  request
}) => {
  await page.goto("/skills");
  const value = draft();
  await editor(page).getByRole("textbox", { name: "Название", exact: true }).fill(value.name);
  await editor(page)
    .getByRole("textbox", { name: "Краткое описание", exact: true })
    .fill(value.summary);
  await editor(page)
    .getByRole("textbox", { name: "Инструкция", exact: true })
    .fill(value.instructions);
  let createdId = "";
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const result = await route.fetch();
    createdId = ((await result.json()) as { id: string }).id;
    await route.abort("failed");
  });
  await page.route(`**${base}/creations/*`, (route) => route.abort("failed"));
  await editor(page).getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(page.getByRole("region", { name: "Проверка создания" })).toBeVisible();
  expect(
    (await request.delete(`${base}/${createdId}`, { data: { expected_version: 1 } })).status()
  ).toBe(204);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await page.unroute(`**${base}`);
  await page.getByRole("button", { name: "Повторить сохранённую попытку", exact: true }).click();
  await expect(editor(page).getByRole("status")).toContainText("уже удалена");
  const items = ((await (await request.get(base)).json()) as { items: { name: string }[] }).items;
  expect(items.filter((item) => item.name === value.name)).toHaveLength(0);
});

test("undo after save preserves the latest server version; redo and copy remain independent", async ({
  page,
  request
}) => {
  const source = await seed(request);
  await open(page, source.draft.name);
  const text = editor(page).getByRole("textbox", { name: "Инструкция", exact: true });
  await text.fill("Версия два");
  await editor(page).getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(editor(page).getByText("v2 · Без изменений", { exact: true })).toBeVisible();
  await editor(page).getByRole("button", { name: "Отменить правку", exact: true }).click();
  await expect(text).toHaveValue(source.draft.instructions.replace(/\r\n?/g, "\n"));
  await expect(editor(page).getByText("v2 · Не сохранено", { exact: true })).toBeVisible();
  await editor(page).getByRole("button", { name: "Повторить правку", exact: true }).click();
  await expect(text).toHaveValue("Версия два");
  await expect(editor(page).getByText("v2 · Без изменений", { exact: true })).toBeVisible();
  await text.press("Control+z");
  await editor(page).getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(editor(page).getByText("v3 · Без изменений", { exact: true })).toBeVisible();
  const canonical = (await (await request.get(`${base}/${source.id}`)).json()) as {
    versions: { instructions: string }[];
  };
  expect(canonical.versions[0]!.instructions).toBe(source.draft.instructions);
  await editor(page)
    .getByRole("button", { name: "Копировать в новый черновик", exact: true })
    .click();
  await expect(
    editor(page).getByRole("button", { name: "Отменить правку", exact: true })
  ).toBeDisabled();
});
test("literal replacement requires current review, changes only a draft and can be undone in one action", async ({
  page,
  request
}) => {
  const source = await seed(request);
  await open(page, source.draft.name);
  const text = editor(page).getByRole("textbox", { name: "Инструкция", exact: true });
  await text.fill("тест тест\n<literal>");
  await page.getByText("Поиск и замена в Skill", { exact: true }).click();
  await page.getByRole("textbox", { name: "Найти в Skill", exact: true }).fill("тест");
  await page.getByRole("textbox", { name: "Заменить на", exact: true }).fill("$& <literal>");
  await page.getByRole("button", { name: "Просмотреть замену всех", exact: true }).click();
  const apply = page.getByRole("button", { name: "Применить замену к черновику", exact: true });
  await expect(apply).toBeDisabled();
  await page.getByLabel("Проверил замену Skill", { exact: true }).check();
  await apply.click();
  await expect(text).toHaveValue("$& <literal> $& <literal>\n<literal>");
  const saved = (await (await request.get(`${base}/${source.id}`)).json()) as {
    skill: { current_version: number };
  };
  expect(saved.skill.current_version).toBe(1);
  await editor(page).getByRole("button", { name: "Отменить правку", exact: true }).click();
  await expect(text).toHaveValue("тест тест\n<literal>");
  await editor(page).getByRole("button", { name: "Повторить правку", exact: true }).click();
  await expect(text).toHaveValue("$& <literal> $& <literal>\n<literal>");
});
test("review is invalidated by edits and undo, and switching Skills clears local undo", async ({
  page,
  request
}) => {
  const source = await seed(request);
  const other = await seed(request);
  await open(page, source.draft.name);
  const text = editor(page).getByRole("textbox", { name: "Инструкция", exact: true });
  await text.fill("тест");
  await page.getByText("Поиск и замена в Skill", { exact: true }).click();
  await page.getByRole("textbox", { name: "Найти в Skill", exact: true }).fill("тест");
  await page.getByRole("textbox", { name: "Заменить на", exact: true }).fill("замена");
  await page.getByRole("button", { name: "Просмотреть замену всех", exact: true }).click();
  await page.getByLabel("Проверил замену Skill", { exact: true }).check();
  await text.fill("другой текст");
  await editor(page).getByRole("button", { name: "Отменить правку", exact: true }).click();
  await expect(text).toHaveValue("тест");
  await expect(page.getByRole("region", { name: "Предпросмотр замены Skill" })).toHaveCount(0);
  await page.getByRole("button", { name: "Просмотреть замену всех", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Применить замену к черновику", exact: true })
  ).toBeDisabled();
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("complementary", { name: "Мои Skills" })
    .getByRole("button", { name: `${other.draft.name} Версия 1`, exact: true })
    .click();
  await expect(editor(page).getByRole("textbox", { name: "Название", exact: true })).toHaveValue(
    other.draft.name
  );
  await expect(
    editor(page).getByRole("button", { name: "Отменить правку", exact: true })
  ).toBeDisabled();
});
