import { expect, test } from "@playwright/test";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("Studio sends uploaded reference bytes once and can prepare the result for another edit", async ({
  page
}) => {
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({
      json: { capabilities: { image_generation: { ready: true }, image_editing: { ready: true } } }
    })
  );
  await page.route("**/api/v1/media/jobs", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/?surface=images");
  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "white";
      context.fillRect(0, 0, 16, 16);
      context.fillStyle = "black";
      context.fillRect(4, 4, 8, 8);
      return canvas.toDataURL("image/png").split(",")[1]!;
    }),
    "base64"
  );
  await page.route("**/api/v1/media/assets/**", (route) =>
    route.fulfill({ contentType: "image/png", body: png })
  );
  let calls = 0;
  await page.route("**/api/v1/media/images", async (route) => {
    calls++;
    expect(route.request().headers()["x-kosmora-media-consent"]).toBe("explicit");
    const body = route.request().postDataJSON();
    expect(body.explicit_paid_consent).toBe(true);
    expect(body.references).toHaveLength(1);
    expect(body.references[0]).toEqual({
      kind: "image",
      name: "reference.png",
      media_type: "image/png",
      data_base64: png.toString("base64")
    });
    await route.fulfill({
      status: 202,
      json: {
        id,
        kind: "image",
        status: "done",
        error_code: null,
        created_at: new Date().toISOString(),
        asset: { mime: "image/png", extension: "png", bytes: png.length }
      }
    });
  });
  await page
    .getByLabel("Файлы референсов", { exact: true })
    .setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByRole("button", { name: "Убрать референс reference.png", exact: true })
  ).toBeVisible();
  expect(calls).toBe(0);
  await page
    .getByRole("textbox", { name: "Описание изображения", exact: true })
    .fill("Измени изображение: фон серый");
  await page.getByRole("button", { name: "Изменить изображение", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Сгенерированное изображение", exact: true })
  ).toBeVisible();
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "Продолжить редактирование", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Убрать референс kosmora-${id}.png`, exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Убрать референс reference.png", exact: true })
  ).toHaveCount(0);
  expect(calls).toBe(1);
  await page.screenshot({ path: "../../qa/image-editing-20261025.png", fullPage: true });
});

test("editing a chat image opens Studio with an owned source without generating automatically", async ({
  page
}) => {
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({
      json: { capabilities: { image_generation: { ready: true }, image_editing: { ready: true } } }
    })
  );
  await page.route("**/api/v1/media/jobs", (route) => route.fulfill({ json: { items: [] } }));
  let posted = false;
  await page.route("**/api/v1/media/images", (route) => {
    posted = true;
    return route.fulfill({ status: 500 });
  });
  await page.goto("/");
  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "white";
      context.fillRect(0, 0, 16, 16);
      return canvas.toDataURL("image/png").split(",")[1]!;
    }),
    "base64"
  );
  await page.route("**/api/v1/media/assets/**", (route) =>
    route.fulfill({ contentType: "image/png", body: png })
  );
  await page.goto(`/?surface=images&reference=${id}`);
  await expect(
    page.getByRole("button", { name: `Убрать референс kosmora-${id}.png`, exact: true })
  ).toBeVisible();
  expect(posted).toBe(false);
});
