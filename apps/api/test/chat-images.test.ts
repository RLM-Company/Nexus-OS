import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, runMigrations } from "@cosmora/db";
import { AccountStore } from "../src/account-settings/account-store.js";
import { AccountMediaBudget } from "../src/media/account-media-budget.js";
import { MediaService } from "../src/media/media-service.js";
import { generateChatImage, imageCreationPrompt } from "../src/media/chat-images.js";
import { GeneralChatRuntimeStore } from "../src/general-chat-runtime-store.js";
const dirs: string[] = [],
  dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
it("recognizes explicit image creation without treating questions as paid instructions", () => {
  for (const prompt of [
    "Нарисуй кота",
    "Пожалуйста, сгенерируй картинку горы",
    "Создай изображение города",
    "Draw a cat",
    "Generate an image of a mountain"
  ])
    expect(imageCreationPrompt(prompt)).not.toBeNull();
  for (const prompt of [
    "Как нарисовать кота?",
    "Объясни генерацию картинок",
    "What is image generation?",
    "Сделай расчёт бюджета"
  ])
    expect(imageCreationPrompt(prompt)).toBeNull();
});
it("creates a real stored PNG, records canonical media usage and completes only its owned chat", async () => {
  const db = openDatabase(":memory:");
  dbs.push(db);
  await runMigrations(db);
  const account = new AccountStore(db.sqlite);
  account.migrate();
  const dir = mkdtempSync(join(tmpdir(), "kosmora-chat-image-"));
  dirs.push(dir);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5d8AAAAASUVORK5CYII=",
    "base64"
  );
  const service = new MediaService({
    directory: dir,
    paidEnabled: true,
    ownerBudget: new AccountMediaBudget(account, "fixture-media"),
    adapter: {
      generateImage: () =>
        Promise.resolve({
          bytes: png,
          mime: "image/png",
          extension: "png",
          usage: { source: "provider", input_tokens: 2, output_tokens: 272, total_tokens: 274 }
        }),
      speak: () => Promise.reject(Error("unused")),
      transcribe: () => Promise.reject(Error("unused"))
    }
  });
  const chats = new GeneralChatRuntimeStore(db.sqlite);
  const accepted = chats.createChat("Нарисуй гору", "image-request", "owner");
  expect(chats.claimQueuedGeneralChatRun(accepted.run.id)).toBe(true);
  chats.startAssistantMessage(accepted.run.id, "owner");
  const id = await generateChatImage(
    service,
    "owner",
    "Нарисуй гору",
    new AbortController().signal
  );
  expect(service.asset(id, "owner")).not.toBeNull();
  expect(service.asset(id, "other")).toBeNull();
  expect(chats.completeImageRun(accepted.run.id, "other", id)).toBe(false);
  expect(chats.completeImageRun(accepted.run.id, "owner", id)).toBe(true);
  expect(chats.getAssistantMessage(accepted.run.id, "owner")?.content).toContain(
    `/api/v1/media/assets/${id}`
  );
  expect(chats.getRun(accepted.run.id, "owner")?.status).toBe("succeeded");
  expect(chats.getModelUsageForRun(accepted.run.id, "owner")).toEqual([]);
  expect(account.summary("owner").total_counted_tokens).toBe(274);
  expect(account.usage("owner").rows).toEqual([
    expect.objectContaining({
      kind: "media-image",
      status: "committed",
      input_tokens: 2,
      output_tokens: 272
    })
  ]);
});
it("keeps uncertain media accounting and never reconciles another owner", async () => {
  const db = openDatabase(":memory:");
  dbs.push(db);
  await runMigrations(db);
  const store = new AccountStore(db.sqlite);
  store.migrate();
  const budget = new AccountMediaBudget(store, "fixture-media");
  await budget.reserve({
    ownerId: "owner",
    operationId: "one",
    kind: "image",
    model: "gpt-image-1"
  });
  await budget.reserve({
    ownerId: "owner",
    operationId: "one",
    kind: "image",
    model: "gpt-image-1"
  });
  expect(store.summary("owner").total_counted_tokens).toBe(200000);
  await budget.uncertain({ ownerId: "owner", operationId: "one", reason: "NO_CANONICAL_USAGE" });
  expect(() =>
    budget.reconcile({
      ownerId: "other",
      operationId: "one",
      usage: { source: "provider", input_tokens: 2, output_tokens: 3, total_tokens: 5 }
    })
  ).toThrow();
  expect(store.summary("owner").total_counted_tokens).toBe(200000);
});
