import { test, expect, type Page } from "@playwright/test";

const state = "s".repeat(43),
  proof = "p".repeat(43),
  key = "kosmora.drive.connection.v1";
const endpoint = "/api/v1/storage/drive";
const view = (connected = false, configured = true) => ({
  configured,
  state: configured ? (connected ? "connected" : "disconnected") : "unavailable",
  can_disconnect: connected,
  can_retry: false,
  archive_count: 0,
  pending_count: 0
});
async function fixture(page: Page, configured = true) {
  let connected = false,
    finishes = 0;
  const bodies: unknown[] = [];
  await page.route("**/api/v1/storage/drive**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let result: object = ["/backups", "/sources", "/restored-files"].some((s) => path.endsWith(s))
      ? { items: [] }
      : view(connected, configured);
    if (path.endsWith("/connect"))
      result = {
        state,
        proof,
        authorization_url: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
        expires_at: Date.now() + 600000
      };
    if (path.endsWith("/finish")) {
      finishes++;
      const body = request.postDataJSON() as { denied?: boolean };
      bodies.push(body);
      connected = !body.denied;
      result = { ...view(connected), result: body.denied ? "cancelled" : "connected" };
    }
    if (path.endsWith("/disconnect")) {
      connected = false;
      result = view();
    }
    await route.fulfill({ json: result });
  });
  return { finishes: () => finishes, bodies };
}

test("Drive consent returns to the same tab, completes once, and disconnects", async ({
  page
}, testInfo) => {
  const api = await fixture(page);
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Google consent fixture</h1>" })
  );
  await page.goto("/personal-settings#drive-storage");
  await page.getByRole("button", { name: "Подключить Google Drive", exact: true }).click();
  await page.waitForURL("https://accounts.google.com/**");
  await page.goto(`/personal-settings#drive_state=${state}&drive_code=fixture-code`);
  const panel = page.locator("#drive-storage");
  await expect(panel.getByText("Google Drive подключён.", { exact: true })).toBeVisible();
  expect(api.finishes()).toBe(1);
  expect(api.bodies).toEqual([{ state, proof, code: "fixture-code" }]);
  await expect(page).toHaveURL(/#drive-storage$/);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
  await panel.screenshot({ path: testInfo.outputPath("drive-settings.png") });
  await panel.getByRole("button", { name: "Отключить Google Drive" }).click();
  await expect(
    panel.getByText("Подключение отключено. Копии на вашем Drive сохранены.")
  ).toBeVisible();
});

test("a copied callback in another tab cannot finish without that tab's proof", async ({
  context
}) => {
  const page = await context.newPage(),
    api = await fixture(page);
  await page.goto(`/personal-settings#drive_state=${state}&drive_code=fixture-code`);
  await expect(page.locator("#drive-storage").getByRole("alert")).toContainText(
    "Начните вход в Google заново в этой вкладке"
  );
  expect(api.finishes()).toBe(0);
  await expect(page).toHaveURL(/#drive-storage$/);
});

test("Google denial is shown without connecting and consumes the proof", async ({ page }) => {
  const api = await fixture(page);
  await page.addInitScript(
    ({ key, state, proof }) => sessionStorage.setItem(key, JSON.stringify({ state, proof })),
    { key, state, proof }
  );
  await page.goto(`/personal-settings#drive_state=${state}&drive_error=denied`);
  await expect(page.locator("#drive-storage").getByText("Подключение отменено.")).toBeVisible();
  expect(api.finishes()).toBe(1);
  expect(api.bodies).toEqual([{ state, proof, denied: true }]);
});

test("unconfigured Drive is shown honestly without an active connect action", async ({ page }) => {
  await fixture(page, false);
  await page.goto("/personal-settings#drive-storage");
  const panel = page.locator("#drive-storage");
  await expect(panel.getByText("Подключение пока недоступно", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Подключить Google Drive", exact: true })
  ).toHaveCount(0);
});

test("saves a complete copy, previews and restores into new chat/file links", async ({
  page
}, testInfo) => {
  const id = "11111111-1111-4111-8111-111111111111",
    chat = "22222222-2222-4222-8222-222222222222",
    file = "33333333-3333-4333-8333-333333333333";
  let saved = false,
    restored = false;
  const requests: { path: string; body: unknown }[] = [];
  const summary = {
    chats: 1,
    files: 1,
    messages: 10,
    exported_at: new Date().toISOString(),
    unfinished_messages: 1,
    extracted_documents: 0,
    titles: ["Исходный чат"],
    filenames: ["report.md"]
  };
  const item = {
    id,
    state: "verified",
    bytes: 2500000,
    parts: 2,
    saved_parts: 2,
    created_at: new Date().toISOString(),
    can_retry: false,
    preview: summary
  };
  await page.route("**/api/v1/storage/drive**", async (route) => {
    const r = route.request(),
      path = new URL(r.url()).pathname;
    let result: object = view(true);
    if (r.method() === "POST") requests.push({ path, body: r.postDataJSON() });
    if (path.endsWith("/sources"))
      result = { items: [{ id: chat, title: "Исходный чат", mode: "work" }] };
    if (path.endsWith("/backups")) {
      if (r.method() === "POST") {
        saved = true;
        result = item;
      } else result = { items: saved ? [item] : [] };
    }
    if (path.endsWith("/preview"))
      result = { ...summary, token: "t".repeat(43), expires_at: Date.now() + 600000 };
    if (path.endsWith("/restore")) {
      restored = true;
      result = {
        id,
        chats: [{ id: chat, title: "Исходный чат · копия" }],
        files: [{ id: file, name: "report.md" }]
      };
    }
    if (path.endsWith("/restored-files"))
      result = {
        items: restored
          ? [{ id: file, name: "report.md", source_project: "Проект", source_version: 2 }]
          : []
      };
    await route.fulfill({ json: result });
  });
  await page.goto("/personal-settings#drive-storage");
  const panel = page.locator("#drive-storage");
  await panel.getByRole("button", { name: "Сохранить копию на Drive" }).click();
  await expect(panel.getByText("Все части копии сохранены и проверены.")).toBeVisible();
  await panel.getByRole("button", { name: "Проверить и восстановить" }).click();
  const preview = panel.getByRole("region", { name: "Предпросмотр восстановления" });
  await expect(preview).toContainText("Существующие данные не перезаписываются");
  await expect(preview).toContainText("Прерванных сообщений: 1");
  await preview.screenshot({ path: testInfo.outputPath("restore-preview.png") });
  await preview.getByRole("button", { name: "Восстановить копии" }).click();
  await expect(panel.getByRole("link", { name: "Исходный чат · копия" })).toHaveAttribute(
    "href",
    `/?chat=${chat}`
  );
  await expect(panel.getByRole("link", { name: "report.md · Проект · v2" })).toHaveAttribute(
    "href",
    `/api/v1/storage/drive/restored-files/${file}`
  );
  expect(requests.filter((x) => x.path.endsWith("/restore"))).toHaveLength(1);
  expect(requests.find((x) => x.path.endsWith("/restore"))?.body).toMatchObject({
    token: "t".repeat(43)
  });
});

test("recovers a Drive restore after a lost response and reload", async ({ page }) => {
  const id = "11111111-1111-4111-8111-111111111111";
  const chat = "22222222-2222-4222-8222-222222222222";
  const summary = {
    chats: 1,
    files: 0,
    messages: 2,
    exported_at: new Date().toISOString(),
    unfinished_messages: 0,
    extracted_documents: 0,
    titles: ["Исходный чат"],
    filenames: []
  };
  const restored = {
    id,
    chats: [{ id: chat, title: "Исходный чат · копия" }],
    files: []
  };
  const requests: { token: string; operation_id: string }[] = [];
  const operations = new Set<string>();
  let previews = 0;
  await page.route("**/api/v1/storage/drive**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/restore")) {
      const body = request.postDataJSON() as { token: string; operation_id: string };
      requests.push(body);
      operations.add(body.operation_id);
      if (requests.length === 1) return route.abort("connectionclosed");
      return route.fulfill({ json: restored });
    }
    if (path.endsWith("/preview")) {
      const token = (++previews === 1 ? "a" : "b").repeat(43);
      return route.fulfill({ json: { ...summary, token, expires_at: Date.now() + 600000 } });
    }
    if (path.endsWith("/backups")) {
      return route.fulfill({
        json: {
          items: [
            {
              id,
              state: "verified",
              bytes: 200,
              parts: 1,
              saved_parts: 1,
              created_at: summary.exported_at,
              can_retry: false,
              preview: summary
            }
          ]
        }
      });
    }
    if (path.endsWith("/sources") || path.endsWith("/restored-files")) {
      return route.fulfill({ json: { items: [] } });
    }
    return route.fulfill({ json: view(true) });
  });

  await page.goto("/personal-settings#drive-storage");
  const panel = page.locator("#drive-storage");
  const open = panel.getByRole("button", { name: "Проверить и восстановить" });
  const preview = panel.getByRole("region", { name: "Предпросмотр восстановления" });
  const confirm = preview.getByRole("button", { name: "Восстановить копии" });
  await open.click();
  await confirm.click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await page.reload();
  await open.click();
  await expect(preview).toContainText("Предыдущая попытка не подтвердилась");
  expect(requests).toHaveLength(1);
  await confirm.click();
  await expect(panel.getByRole("link", { name: "Исходный чат · копия" })).toHaveAttribute(
    "href",
    `/?chat=${chat}`
  );
  expect(requests).toEqual([
    { token: "a".repeat(43), operation_id: expect.any(String) },
    { token: "b".repeat(43), operation_id: requests[0]?.operation_id }
  ]);
  expect(operations.size).toBe(1);
  await open.click();
  await expect(preview).not.toContainText("Предыдущая попытка не подтвердилась");
});

test("retries an exact Drive selection after the source list changes", async ({
  page
}, testInfo) => {
  const first = "kosmora_" + "a".repeat(32),
    second = "user_" + "b".repeat(32);
  let connected = true;
  const saved: Record<string, unknown>[] = [];
  await page.route("**/api/v1/storage/drive**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let result: object = view(connected);
    if (path.endsWith("/sources"))
      result = {
        items: [],
        chats: [],
        file_selection: true,
        office_file_selection: true,
        files: [
          {
            id: first,
            name: "proposal.md",
            project: "Клиент",
            version: 3,
            bytes: 1000,
            sha256: "a".repeat(64),
            kind: "kosmora"
          },
          {
            id: second,
            name: "notes.txt",
            project: "Клиент",
            version: 2,
            bytes: 200,
            sha256: null,
            kind: "user"
          }
        ].filter((file) => saved.length === 0 || file.id !== first)
      };
    if (path.endsWith("/link"))
      result = { url: "https://drive.google.com/drive/folders/managed_folder" };
    if (
      path.endsWith("/restored-files") ||
      (path.endsWith("/backups") && request.method() === "GET")
    )
      result = { items: [] };
    if (path.endsWith("/backups") && request.method() === "POST") {
      saved.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill(
        saved.length === 1
          ? { status: 502, json: { error: { code: "DRIVE_REQUEST_FAILED" } } }
          : { json: { state: "verified" } }
      );
      return;
    }
    if (path.endsWith("/disconnect")) {
      connected = false;
      result = view(false);
    }
    await route.fulfill({ json: result });
  });
  await page.goto("/personal-settings#drive-storage");
  const panel = page.locator("#drive-storage");
  await expect(panel.getByRole("link", { name: "Открыть папку Kosmora" })).toHaveAttribute(
    "href",
    "https://drive.google.com/drive/folders/managed_folder"
  );
  await panel.getByText("Что сохранить", { exact: true }).click();
  await panel.getByRole("checkbox", { name: "Выбрать файлы по отдельности" }).check();
  await panel.getByRole("checkbox", { name: /proposal.md/ }).check();
  await expect(panel.getByRole("checkbox", { name: /notes.txt/ })).not.toBeChecked();
  const office = Buffer.from([80, 75, 3, 4, 0, 128, 255]);
  await panel.getByLabel(/Файл Office с устройства/).setInputFiles({
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: office
  });
  expect(saved).toHaveLength(0);
  const save = panel.getByRole("button", { name: "Сохранить копию на Drive" });
  await save.click();
  await expect(panel.getByRole("alert")).toContainText("Операция не завершена");
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    include_results: false,
    file_ids: [first],
    office_file: { name: "report.docx", bytes: office.toString("base64") }
  });
  expect(saved[0]).not.toHaveProperty("retry_upload");
  await expect(panel.getByText("Все части копии сохранены и проверены.")).toHaveCount(0);
  await expect(panel.getByRole("checkbox", { name: /proposal.md/ })).toHaveCount(0);
  await save.click();
  await expect(panel.getByText("Все части копии сохранены и проверены.")).toBeVisible();
  expect(saved).toHaveLength(2);
  expect(saved[1]).toEqual({ ...saved[0], retry_upload: true });
  await panel.screenshot({ path: testInfo.outputPath("drive-file-selection.png") });
  await panel.getByRole("checkbox", { name: /notes.txt/ }).check();
  await save.click();
  await expect(panel.getByText("Все части копии сохранены и проверены.")).toBeVisible();
  expect(saved).toHaveLength(3);
  expect(saved[2]).toMatchObject({ file_ids: [second] });
  expect(saved[2]?.operation_id).not.toBe(saved[0]?.operation_id);
  expect(saved[2]).not.toHaveProperty("retry_upload");
  expect(saved[2]).not.toHaveProperty("office_file");
  await panel.getByRole("button", { name: "Отключить Google Drive", exact: true }).click();
  await expect(panel.getByRole("link", { name: "Открыть папку Kosmora" })).toHaveCount(0);
});
