import { expect, test } from "@playwright/test";

const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const imageConstraints = {
  sizes: ["1024x1024", "1536x1024", "1024x1536"],
  aspectRatios: ["1:1", "3:2", "2:3"],
  qualities: ["low", "medium", "high", "auto"],
  formats: ["png", "jpeg", "webp"],
  maxCount: 1,
  maxPromptLength: 2000,
  supportsReferenceImage: false
};
const capabilityResponse = {
  capabilities: {
    image_generation: {
      ready: true,
      model: "gpt-image-1",
      reason: null,
      constraints: imageConstraints
    },
    image_editing: { ready: false, reason: "EDITING_UNAVAILABLE" }
  }
};

test("lost image POST response restores owned job without another paid request", async ({
  page
}) => {
  let posts = 0;
  let accepted: Record<string, unknown> | null = null;
  page.on("dialog", (dialog) => void dialog.accept());
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({ json: capabilityResponse })
  );
  await page.route("**/api/v1/media/jobs", (route) =>
    route.fulfill({ json: { items: accepted ? [accepted] : [] } })
  );
  await page.route(`**/api/v1/media/jobs/${jobId}`, (route) => route.fulfill({ json: accepted }));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5d8AAAAASUVORK5CYII=",
    "base64"
  );
  await page.route("**/api/v1/media/assets/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      headers: { "Content-Disposition": `attachment; filename="kosmora-${jobId}.png"` },
      body: png
    })
  );
  await page.route("**/api/v1/media/images", async (route) => {
    posts++;
    const request = route.request();
    const body = request.postDataJSON();
    expect(body.prompt).toBe("Лунная станция");
    expect(body.aspect_ratio).toBe("3:2");
    expect(body.quality).toBe("high");
    expect(body.format).toBe("png");
    expect(body.client_request_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(request.headers()["idempotency-key"]).toBe(body.client_request_id);
    accepted = {
      id: jobId,
      kind: "image",
      status: "running",
      error_code: null,
      created_at: new Date().toISOString(),
      client_request_id: body.client_request_id,
      parameters: { aspect_ratio: "3:2", quality: "high", format: "png", size: "1536x1024" },
      asset: null
    };
    // The provider received the job but HTTP acknowledgement was lost.
    await route.abort("failed");
  });

  await page.goto("/?surface=images");
  await page.getByLabel("Описание изображения", { exact: true }).fill("Лунная станция");
  await page.getByRole("button", { name: "3:2 · 1536 × 1024" }).click();
  await page.getByLabel("Качество изображения").selectOption("high");
  await page.getByRole("button", { name: "Сгенерировать изображение" }).click();
  await expect(page.getByText("Генерация", { exact: true })).toBeVisible();
  expect(posts).toBe(1);

  await page.reload();
  await expect(page.getByText("Генерация", { exact: true })).toBeVisible();
  expect(posts).toBe(1);

  accepted = {
    ...accepted,
    status: "done",
    asset: { mime: "image/png", extension: "png", bytes: png.length }
  };
  await page.reload();
  await expect(page.getByRole("img", { name: "Сгенерированное изображение" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Скачать PNG" }).click();
  expect((await download).suggestedFilename()).toBe(`kosmora-${jobId}.png`);
  expect(posts).toBe(1);
});

test("an explicitly cancelled image is never silently restarted", async ({ page }) => {
  let posts = 0;
  let cancels = 0;
  const running = {
    id: jobId,
    kind: "image",
    status: "running",
    error_code: null,
    created_at: new Date().toISOString(),
    asset: null
  };
  page.on("dialog", (dialog) => void dialog.accept());
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({ json: capabilityResponse })
  );
  await page.route("**/api/v1/media/jobs", (route) => route.fulfill({ json: { items: [] } }));
  await page.route(`**/api/v1/media/jobs/${jobId}`, (route) => {
    if (route.request().method() === "DELETE") {
      cancels++;
      return route.fulfill({ json: { ...running, status: "cancelled" } });
    }
    return route.fulfill({ json: running });
  });
  await page.route("**/api/v1/media/images", (route) => {
    posts++;
    return route.fulfill({ status: 202, json: running });
  });
  await page.goto("/?surface=images");
  await page.getByLabel("Описание изображения", { exact: true }).fill("Лунная станция");
  await page.getByRole("button", { name: "Сгенерировать изображение" }).click();
  await expect(page.getByRole("button", { name: "Отменить" })).toBeVisible();
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByText("Отменено", { exact: true })).toBeVisible();
  expect(posts).toBe(1);
  expect(cancels).toBe(1);
});

test("recovery under a different owner shows no prior job or paid POST", async ({ page }) => {
  const previousId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let posts = 0;
  await page.addInitScript((id) => {
    sessionStorage.setItem("kosmora:media:pending:image", id);
  }, previousId);
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({ json: capabilityResponse })
  );
  // The owner-scoped API correctly returns no jobs for this owner.
  await page.route("**/api/v1/media/jobs", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/v1/media/images", (route) => {
    posts++;
    return route.fulfill({ status: 503 });
  });
  await page.goto("/?surface=images");
  await expect(page.getByText(/Предыдущий запуск мог дойти до провайдера/)).toBeVisible();
  await expect(page.getByRole("img", { name: "Сгенерированное изображение" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Проверить историю без запуска" })).toBeVisible();
  expect(posts).toBe(0);
});

test("a completed PNG remains downloadable but edit action requires a live editing capability", async ({
  page
}) => {
  let posts = 0;
  const done = {
    id: jobId,
    kind: "image",
    status: "done",
    error_code: null,
    created_at: new Date().toISOString(),
    asset: { mime: "image/png", extension: "png", bytes: 68 }
  };
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({ json: capabilityResponse })
  );
  await page.route("**/api/v1/media/jobs", (route) => route.fulfill({ json: { items: [done] } }));
  await page.route("**/api/v1/media/images", (route) => {
    posts++;
    return route.fulfill({ status: 503 });
  });
  await page.route("**/api/v1/media/assets/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5d8AAAAASUVORK5CYII=",
        "base64"
      )
    })
  );
  await page.goto("/?surface=images");
  await expect(page.getByRole("img", { name: "Сгенерированное изображение" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Скачать PNG" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Продолжить редактирование" })).toHaveCount(0);
  await expect(page.getByText("Редактирование результата пока не подключено.")).toBeVisible();
  expect(posts).toBe(0);
});

test("an unreadable history blocks fresh paid images until owner history is verified", async ({
  page
}) => {
  let historyAvailable = false;
  let posts = 0;
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({ json: capabilityResponse })
  );
  await page.route("**/api/v1/media/jobs", (route) =>
    route.fulfill(historyAvailable ? { json: { items: [] } } : { status: 503 })
  );
  await page.route("**/api/v1/media/images", (route) => {
    posts++;
    return route.fulfill({ status: 503 });
  });
  await page.goto("/?surface=images");
  await page.getByLabel("Описание изображения", { exact: true }).fill("Лунная станция");
  await expect(page.getByText(/Новый платный запуск заблокирован до подтверждения/)).toBeVisible();
  const generate = page.getByRole("button", { name: "Сгенерировать изображение" });
  await expect(generate).toBeDisabled();
  historyAvailable = true;
  await page.getByRole("button", { name: "Проверить историю без запуска" }).click();
  await expect(generate).toBeEnabled();
  expect(posts).toBe(0);
});
