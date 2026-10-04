import { expect, it } from "vitest";
import { GeneralChatStore, openDatabase, runMigrations } from "../src/index.js";
it("isolates chat management, forbids archiving active work and retains history through restore", async () => {
  const db = openDatabase(":memory:");
  try {
    await runMigrations(db);
    const store = new GeneralChatStore(db.sqlite);
    const accepted = store.createChat("History", "archive-test", "owner-a");
    expect(store.updateChat(accepted.chat.id, "owner-b", { title: "Other" })).toBeNull();
    expect(() => store.updateChat(accepted.chat.id, "owner-a", { archived: true })).toThrow();
    store.cancelRun(accepted.run.id, "owner-a");
    store.updateChat(accepted.chat.id, "owner-a", { title: "Renamed", archived: true });
    expect(store.listChats("owner-a")).toHaveLength(0);
    expect(store.listChats("owner-a", true)[0]?.title).toBe("Renamed");
    expect(store.listMessages(accepted.chat.id, "owner-a")[0]?.content).toBe("History");
    store.updateChat(accepted.chat.id, "owner-a", { archived: false });
    expect(store.listChats("owner-a")).toHaveLength(1);
  } finally {
    db.close();
  }
});
