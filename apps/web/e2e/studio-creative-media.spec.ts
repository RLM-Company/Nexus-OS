import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const fixtureIds = {
  music: "79ed1063-ba45-4ea9-9df3-ed1f6ae2c11a",
  sfx: "81378a7b-4f0b-49a8-b7b6-150fc12f58fb",
  video: "3814b379-0a6c-4ffe-8d51-49314be90651"
};
const requests = [
  {
    kind: "sfx",
    surface: "sound",
    title: "Звуковые эффекты",
    label: "Описание звукового эффекта",
    action: "Сгенерировать звуковой эффект"
  },
  {
    kind: "music",
    surface: "music",
    title: "Генерация музыки",
    label: "Описание музыки",
    action: "Сгенерировать музыку"
  },
  {
    kind: "video",
    surface: "video",
    title: "Генерация видео",
    label: "Описание сцены",
    action: "Сгенерировать видео"
  }
] as const;

for (const { kind, surface, title, label, action } of requests) {
  test(`${title} requires consent and recovers a completed file after a lost response and reload`, async ({
    page
  }) => {
    const video = kind === "video";
    const asset = await readFile(
      join(__dirname, "../../api/test/fixtures", video ? "studio-clip.mp4" : "studio-effect.mp3")
    );
    const extension = video ? "mp4" : "mp3";
    const mime = video ? "video/mp4" : "audio/mpeg";
    const id = fixtureIds[kind];
    const row = {
      id,
      kind,
      status: "done",
      error_code: null,
      budget_state: "uncertain",
      created_at: "2026-11-27T12:00:00.000Z",
      client_request_id: "",
      asset: { mime, extension, bytes: asset.length }
    };
    const entry = {
      ready: true,
      model: "test-only",
      provider: "fixture",
      reason: null,
      constraints: { minSeconds: 1, maxSeconds: 60 }
    };
    let posts = 0;
    await page.route("**/api/v1/media/capabilities", (route) =>
      route.fulfill({
        json: {
          capabilities: { sound_effects: entry, music_generation: entry, video_generation: entry }
        }
      })
    );
    await page.route("**/api/v1/media/jobs", (route) =>
      route.fulfill({
        json: { items: posts ? [row] : [] }
      })
    );
    await page.route("**/api/v1/media/assets/**", (route) =>
      route.fulfill({
        headers: {
          "content-type": mime,
          ...(route.request().url().endsWith("?download=1")
            ? { "content-disposition": `attachment; filename="fixture.${extension}"` }
            : {})
        },
        body: asset
      })
    );
    await page.route(
      video ? "**/api/v1/media/video" : "**/api/v1/media/creative-audio",
      async (route) => {
        expect(route.request().method()).toBe("POST");
        row.client_request_id = route.request().headers()["idempotency-key"] ?? "";
        expect(row.client_request_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(route.request().postDataJSON()).toMatchObject({
          prompt: "Тестовое описание",
          explicit_paid_consent: true,
          client_request_id: row.client_request_id
        });
        posts++;
        // Provider/network are fixtures. The separate Fastify tests exercise real storage and byte ranges.
        await route.abort("failed");
      }
    );
    await page.goto(`/?surface=${surface}`);
    const panel = page.getByRole("region", { name: title, exact: true });
    const button = panel.getByRole("button", { name: action });
    await expect(button).toBeDisabled();
    await page.getByLabel(label, { exact: true }).fill("Тестовое описание");
    expect(posts).toBe(0);
    await expect(button).toBeDisabled();
    await panel.getByLabel("Разрешаю платный вызов провайдера").check();
    await button.click();
    await expect(panel.getByText("Готово", { exact: true })).toBeVisible();
    const media = panel.locator(video ? "video" : "audio");
    await expect(media).toHaveAttribute("src", `/api/v1/media/assets/${id}`);
    if (video) {
      await expect
        .poll(() => media.evaluate((element) => (element as HTMLVideoElement).videoWidth))
        .toBe(160);
    }
    await page.reload();
    await panel.getByRole("button", { name: new RegExp(extension, "i") }).click();
    await expect(media).toHaveAttribute("src", `/api/v1/media/assets/${id}`);
    const downloading = page.waitForEvent("download");
    await panel.getByRole("link", { name: `Скачать ${extension.toUpperCase()}` }).click();
    const downloaded = await downloading;
    expect(await readFile(await downloaded.path())).toEqual(asset);
    expect(posts).toBe(1);
  });
}
