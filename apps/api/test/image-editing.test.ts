import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenAIMediaAdapter } from "@cosmora/model-gateway";
import type { ChatImageAttachment } from "@cosmora/contracts";
import { loadServerConfig } from "@cosmora/config";
import { MediaService } from "../src/media/media-service.js";
import { buildApp } from "../src/app.js";
import { imageCreationPrompt } from "../src/media/chat-images.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5d8AAAAASUVORK5CYII=",
  "base64"
);
const reference: ChatImageAttachment = {
  kind: "image",
  name: "circle.png",
  media_type: "image/png",
  data_base64: png.toString("base64")
};
const directories: string[] = [];
afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), "kosmora-edit-"));
  directories.push(path);
  return path;
};
const binary = () =>
  Promise.resolve({
    bytes: png,
    mime: "image/png" as const,
    extension: "png" as const,
    usage: { source: "provider" as const, input_tokens: 7, output_tokens: 12, total_tokens: 19 }
  });
const unused = () => Promise.reject(Error("unused"));
const budget = () => ({
  reserve: vi.fn().mockResolvedValue(undefined),
  reconcile: vi.fn().mockResolvedValue(undefined),
  uncertain: vi.fn().mockResolvedValue(undefined)
});

it("sends the actual reference as multipart to the pinned edits route and parses PNG usage", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [{ b64_json: png.toString("base64") }],
        usage: { input_tokens: 7, output_tokens: 12, total_tokens: 19 }
      })
    )
  );
  const adapter = new OpenAIMediaAdapter(
    "synthetic-test-credential",
    fetcher,
    "https://ru.cheapvibecode.ru/v1"
  );
  const result = await adapter.editImage(
    "Change background",
    [reference],
    "gpt-image-1",
    new AbortController().signal
  );
  expect(result.bytes).toEqual(png);
  expect(result.usage?.total_tokens).toBe(19);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe("https://ru.cheapvibecode.ru/v1/images/edits");
  expect(options?.redirect).toBe("error");
  const form = options?.body as FormData;
  expect(form.get("n")).toBe("1");
  expect(form.get("prompt")).toBe("Change background");
  expect(Buffer.from(await (form.get("image") as File).arrayBuffer())).toEqual(png);
});

it("keeps editing disabled until explicitly activated and never falls back to text generation", () => {
  const generateImage = vi.fn(binary),
    editImage = vi.fn(binary);
  const service = new MediaService({
    directory: directory(),
    paidEnabled: true,
    ownerBudget: budget(),
    adapter: { generateImage, editImage, speak: unused, transcribe: unused }
  });
  expect(service.capabilities().image_editing.ready).toBe(false);
  expect(() => service.enqueue("owner", "image", "Edit", true, [reference])).toThrow(
    "IMAGE_EDITING_UNAVAILABLE"
  );
  expect(editImage).not.toHaveBeenCalled();
  expect(generateImage).not.toHaveBeenCalled();
});

it("accepts one explicit HTTP edit, protects the output and keeps source bytes out of media metadata", async () => {
  const path = directory(),
    ledger = budget(),
    generateImage = vi.fn(binary),
    editImage = vi.fn(binary);
  const service = new MediaService({
    directory: path,
    paidEnabled: true,
    imageEditingEnabled: true,
    ownerBudget: ledger,
    adapter: { generateImage, editImage, speak: unused, transcribe: unused }
  });
  const app = buildApp({
    config: loadServerConfig({ NODE_ENV: "test" }),
    database: { ping: () => undefined },
    mediaService: service
  });
  try {
    const headers = { "x-kosmora-media-consent": "explicit" };
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/media/images",
      headers,
      payload: { prompt: "Edit", explicit_paid_consent: false, references: [reference] }
    });
    expect(denied.statusCode).toBe(403);
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/media/images",
      headers,
      payload: {
        prompt: "Edit",
        explicit_paid_consent: true,
        references: [{ ...reference, data_base64: "not image" }]
      }
    });
    expect(invalid.statusCode).toBe(400);
    expect(editImage).not.toHaveBeenCalled();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/media/images",
      headers,
      payload: { prompt: "Edit", explicit_paid_consent: true, references: [reference] }
    });
    expect(response.statusCode).toBe(202);
    const id = response.json<{ id: string }>().id;
    await vi.waitFor(() => expect(service.get(id, "local-owner")?.status).toBe("done"));
    expect(editImage).toHaveBeenCalledTimes(1);
    expect(generateImage).not.toHaveBeenCalled();
    expect(ledger.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: { source: "provider", input_tokens: 7, output_tokens: 12, total_tokens: 19 }
      })
    );
    expect(service.asset(id, "foreign")).toBeNull();
    expect(service.asset(id, "local-owner")?.bytes).toEqual(png);
    expect(readFileSync(join(path, id + ".json"), "utf8")).not.toContain(reference.data_base64);
  } finally {
    await app.close();
  }
});

it("does not repeat a failed edit or silently call the generation endpoint", async () => {
  const editImage = vi.fn().mockRejectedValue(Error("provider failure")),
    generateImage = vi.fn(binary),
    ledger = budget();
  const service = new MediaService({
    directory: directory(),
    paidEnabled: true,
    imageEditingEnabled: true,
    ownerBudget: ledger,
    adapter: { generateImage, editImage, speak: unused, transcribe: unused }
  });
  const job = service.enqueue("owner", "image", "Edit", true, [reference]);
  await vi.waitFor(() => expect(service.get(job.id, "owner")?.status).toBe("failed"));
  expect(editImage).toHaveBeenCalledTimes(1);
  expect(generateImage).not.toHaveBeenCalled();
  expect(ledger.uncertain).toHaveBeenCalled();
});

it("requires both a photo and an explicit image edit instruction", () => {
  expect(imageCreationPrompt("Измени изображение: сделай фон серым", true)).not.toBeNull();
  expect(imageCreationPrompt("Edit this image: make the background grey", true)).not.toBeNull();
  expect(imageCreationPrompt("Измени изображение: сделай фон серым", false)).toBeNull();
  expect(imageCreationPrompt("Измени код по скриншоту", true)).toBeNull();
  expect(imageCreationPrompt("Измени цвет кнопки на сайте", true)).toBeNull();
  expect(imageCreationPrompt("Что изображено на фото?", true)).toBeNull();
});
