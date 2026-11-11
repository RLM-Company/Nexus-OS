import { expect, test } from "@playwright/test";
import { installOfflineImageCapabilities } from "./fixtures/media-capabilities";

const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const when = "2026-11-11T07:00:00.000Z";

test("uncertain image budget is visible on the result and in owned history without paid replay", async ({
  page
}) => {
  let paidPosts = 0;
  const uncertain = {
    id: firstId,
    kind: "image",
    status: "failed",
    error_code: "timeout",
    budget_state: "uncertain",
    created_at: when,
    asset: null
  };
  await installOfflineImageCapabilities(page);
  await page.route("**/api/v1/media/jobs", (route) =>
    route.fulfill({ json: { items: [uncertain] } })
  );
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/media/images") && request.method() === "POST") paidPosts++;
  });
  await page.goto("/?surface=images");
  await expect(
    page.getByText(/Итоговый расход не подтверждён провайдером/)
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Расход не подтверждён/ })
  ).toBeVisible();
  expect(paidPosts).toBe(0);
});

test("uncertain MP3 budget is shown in Sound and its owner-scoped history", async ({ page }) => {
  const uncertain = {
    id: firstId,
    kind: "speech",
    status: "done",
    budget_state: "uncertain",
    error_code: null,
    created_at: when,
    asset: { mime: "audio/mpeg", extension: "mp3", bytes: 3 }
  };
  await installOfflineImageCapabilities(page);
  await page.route("**/api/v1/media/jobs", (route) =>
    route.fulfill({ json: { items: [uncertain] } })
  );
  await page.goto("/?surface=sound");
  await expect(page.getByText(/Итоговый расход не подтверждён провайдером/)).toBeVisible();
  await expect(page.getByText(/Расход не подтверждён/).last()).toBeVisible();
  await expect(page.getByRole("link", { name: "Скачать MP3" }).first()).toBeVisible();
});

test("image history reveals all owned results in batches without any paid POST", async ({ page }) => {
  const history = Array.from({ length: 11 }, (_, index) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
    kind: "image",
    status: "done",
    created_at: when,
    error_code: null,
    budget_state: index === 10 ? "reserved" : "reconciled",
    asset: null
  }));
  let paidPosts = 0;
  await installOfflineImageCapabilities(page);
  await page.route("**/api/v1/media/jobs", (route) =>
    route.fulfill({ json: { items: history } })
  );
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/media/") && request.method() === "POST") paidPosts++;
  });
  await page.goto("/?surface=images");
  await expect(page.getByRole("button", { name: "Удалить", exact: true })).toHaveCount(8);
  await page.getByRole("button", { name: "Показать ещё изображения" }).click();
  await expect(page.getByRole("button", { name: "Удалить", exact: true })).toHaveCount(11);
  await expect(page.getByRole("button", { name: "Показать ещё изображения" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Бюджет зарезервирован/ })).toBeVisible();
  expect(paidPosts).toBe(0);
});

test("a failed image history GET is not presented as an empty gallery", async ({ page }) => {
  let available = false;
  await installOfflineImageCapabilities(page);
  await page.route("**/api/v1/media/jobs", (route) =>
    route.fulfill(available ? { json: { items: [] } } : { status: 503 })
  );
  await page.goto("/?surface=images");
  await expect(page.getByText(/Не удалось загрузить историю изображений/)).toBeVisible();
  await expect(page.getByText("Сохранённых изображений пока нет.")).toHaveCount(0);
  available = true;
  await page.getByRole("button", { name: "Повторить загрузку истории" }).click();
  await expect(page.getByText("Сохранённых изображений пока нет.")).toBeVisible();
});

test("a reference deep link cannot preload an image when editing is unavailable", async ({
  page
}) => {
  let assetReads = 0;
  let paidPosts = 0;
  await installOfflineImageCapabilities(page);
  await page.route("**/api/v1/media/jobs", (route) =>
    route.fulfill({ json: { items: [] } })
  );
  await page.route("**/api/v1/media/assets/**", (route) => {
    assetReads++;
    return route.fulfill({ status: 403 });
  });
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/media/images") && request.method() === "POST") paidPosts++;
  });
  await page.goto(`/?surface=images&reference=${firstId}`);
  await expect(
    page.getByText("Редактирование по референсам пока не объявлено сервером и отключено.")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Добавить референсы/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Убрать референс/ })).toHaveCount(0);
  expect(assetReads).toBe(0);
  expect(paidPosts).toBe(0);
});

test("WebP remains downloadable while unavailable as an editing reference", async ({ page }) => {
  const done = {
    id: firstId,
    kind: "image",
    status: "done",
    error_code: null,
    budget_state: "reconciled",
    created_at: when,
    asset: { mime: "image/webp", extension: "webp", bytes: 100 }
  };
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({
      json: {
        capabilities: {
          image_generation: {
            ready: true,
            model: "gpt-image-1",
            reason: null,
            constraints: {
              sizes: ["1024x1024", "1536x1024", "1024x1536"],
              aspectRatios: ["1:1", "3:2", "2:3"],
              qualities: ["low", "medium", "high", "auto"],
              formats: ["png", "jpeg", "webp"],
              maxCount: 1,
              maxPromptLength: 2000,
              supportsReferenceImage: true
            }
          },
          image_editing: { ready: true, model: "gpt-image-1", reason: null }
        }
      }
    })
  );
  await page.route("**/api/v1/media/jobs", (route) =>
    route.fulfill({ json: { items: [done] } })
  );
  await page.route("**/api/v1/media/assets/**", (route) => route.fulfill({ status: 404 }));
  await page.goto("/?surface=images");
  await expect(page.getByRole("link", { name: "Скачать WEBP" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Продолжить редактирование" })).toHaveCount(0);
  await expect(
    page.getByText("Для редактирования результата выберите PNG или JPEG при генерации.")
  ).toBeVisible();
});
