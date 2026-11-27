import { expect, it } from "vitest";
import { openDatabase, runMigrations, DeveloperApiStore, DeveloperApiError } from "../src/index.js";

const setup = async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  return { db, store: new DeveloperApiStore(db.sqlite) };
};

it("issues a hashed key, shows it once, enforces scopes and revocation", async () => {
  const { db, store } = await setup();
  try {
    const issued = store.issue("owner-a", ["chat.read", "chat.write"], 60_000);
    expect(issued.token).toMatch(/^cdev_[A-Za-z0-9_-]+$/);
    const resolved = store.resolve(issued.token);
    expect(resolved).toMatchObject({ owner_id: "owner-a", key_id: issued.key_id });
    expect(resolved.scopes).toEqual(["chat.read", "chat.write"]);
    expect(() => store.resolve("cdev_wrong")).toThrow(DeveloperApiError);
    expect(() => store.requireScope(issued.key_id, "tasks.write")).toThrow("SCOPE_DENIED");
    const view = store.list("owner-a")[0]!;
    expect(view).not.toHaveProperty("token");
    expect(view).not.toHaveProperty("token_hash");
    store.revoke("owner-a", issued.key_id);
    expect(() => store.resolve(issued.token)).toThrow("KEY_REVOKED");
  } finally {
    db.close();
  }
});

it("replays a task after a lost response without creating a second one", async () => {
  const { db, store } = await setup();
  try {
    const input = { goal: "Подготовить отчёт", client_request_id: "client-1" };
    const first = store.createTask("owner-a", "dk_1", input);
    const replay = store.createTask("owner-a", "dk_1", input);
    expect(replay.task_id).toBe(first.task_id);
    expect(store.listTasks("owner-a")).toHaveLength(1);
    expect(() => store.createTask("owner-a", "dk_1", { ...input, goal: "Другой отчёт" })).toThrow(
      "TASK_CONFLICT"
    );
    const completed = store.setTaskStatus("owner-a", first.task_id, "completed", "report.md");
    expect(completed.status).toBe("completed");
    expect(completed.result_file).toBe("report.md");
  } finally {
    db.close();
  }
});

it("stores webhook subscriptions and deduplicates signed deliveries", async () => {
  const { db, store } = await setup();
  try {
    const { subscription, secret } = store.subscribe(
      "owner-a",
      "https://client.example/hooks",
      ["task.completed"]
    );
    expect(secret).toMatch(/^whsec_/);
    expect(store.subscriptions("owner-a")).toHaveLength(1);
    expect(store.signingKey(subscription.webhook_id)?.length).toBe(32);
    expect(store.recordDelivery("owner-a", subscription.webhook_id, "task.completed", { task_id: "t1" }, 1)).toBe(true);
    expect(store.recordDelivery("owner-a", subscription.webhook_id, "task.completed", { task_id: "t1" }, 1)).toBe(false);
    store.revokeWebhook("owner-a", subscription.webhook_id);
    expect(store.subscriptions("owner-a")).toHaveLength(0);
    expect(store.signingKey(subscription.webhook_id)).toBeNull();
  } finally {
    db.close();
  }
});
