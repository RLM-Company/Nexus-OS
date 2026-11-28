import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GeneralChatStore, openDatabase, runMigrations } from "../src/index.js";

describe("ordinary chat terminal-state reliability", () => {
  let database: ReturnType<typeof openDatabase>;
  let store: GeneralChatStore;
  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    store = new GeneralChatStore(database.sqlite);
  });
  afterEach(() => database.close());

  it("restores a visible failure after a crash between claiming and creating the assistant", () => {
    const accepted = store.createChat("Keep this question", "crash-before-assistant", "owner-a");
    database.sqlite
      .prepare("UPDATE general_chat_runs SET status='running' WHERE id=?")
      .run(accepted.run.id);
    expect(store.recoverInterruptedRuns()).toBe(1);
    const reopened = new GeneralChatStore(database.sqlite);
    const messages = reopened.listMessages(accepted.chat.id, "owner-a");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "Keep this question" });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      status: "failed",
      error_code: "INTERRUPTED_BY_RESTART",
      run_id: accepted.run.id
    });
    expect(reopened.recoverInterruptedRuns()).toBe(0);
    expect(reopened.listMessages(accepted.chat.id, "owner-a")).toEqual(messages);
    expect(reopened.listMessages(accepted.chat.id, "owner-b")).toEqual([]);
    expect(
      reopened.createMessage(accepted.chat.id, "Next question", "after-crash", "owner-a")
    ).not.toBeNull();
  });

  it("repairs legacy failed runs without an assistant without resubmitting the question", () => {
    const accepted = store.createChat("Original", "legacy-failed");
    database.sqlite
      .prepare("UPDATE general_chat_runs SET status='failed' WHERE id=?")
      .run(accepted.run.id);
    store.recoverInterruptedRuns();
    expect(store.listMessages(accepted.chat.id)).toEqual([
      expect.objectContaining({ role: "user", content: "Original" }),
      expect.objectContaining({ role: "assistant", status: "failed", error_code: "INTERRUPTED" })
    ]);
    expect(store.createChat("Original", "legacy-failed").run.id).toBe(accepted.run.id);
  });

  it("makes a failure before execution visible in durable history", () => {
    const accepted = store.createChat("Do not lose the input", "preflight-failure");
    store.failRun(accepted.run.id, "PREFLIGHT_FAILED");
    expect(store.getAssistantMessage(accepted.run.id)).toMatchObject({
      status: "failed",
      error_code: "PREFLIGHT_FAILED"
    });
    store.failRun(accepted.run.id, "LATE_ERROR");
    expect(store.getAssistantMessage(accepted.run.id)?.error_code).toBe("PREFLIGHT_FAILED");
    expect(store.startAssistantMessage(accepted.run.id)).toBeNull();
  });

  it("does not append an old orphan failure after a newer conversation turn", () => {
    const old = store.createChat("Old question", "old-orphan");
    database.sqlite
      .prepare("UPDATE general_chat_runs SET status='failed' WHERE id=?")
      .run(old.run.id);
    const current = store.createMessage(old.chat.id, "Current question", "current-question")!;
    store.recoverInterruptedRuns();
    const history = store.listMessages(old.chat.id);
    expect(history.at(-1)?.run_id).toBe(current.run.id);
    expect(store.getRun(current.run.id)?.status).toBe("queued");
    expect(history).toHaveLength(2);
  });

  it("rolls back the whole restart repair if a failure marker cannot be saved", () => {
    const first = store.createChat("First owner", "rollback-a", "owner-a");
    const second = store.createChat("Second owner", "rollback-b", "owner-b");
    database.sqlite.prepare("UPDATE general_chat_runs SET status='running'").run();
    database.sqlite
      .exec(`CREATE TRIGGER reject_recovery_marker BEFORE INSERT ON general_chat_messages
      WHEN NEW.role='assistant' AND NEW.owner_id='owner-b'
      BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;`);
    expect(() => store.recoverInterruptedRuns()).toThrow("fixture write failure");
    expect(store.getRun(first.run.id, "owner-a")?.status).toBe("running");
    expect(store.getRun(second.run.id, "owner-b")?.status).toBe("running");
    expect(store.getAssistantMessage(first.run.id, "owner-a")).toBeNull();
    database.sqlite.exec("DROP TRIGGER reject_recovery_marker");
    expect(store.recoverInterruptedRuns()).toBe(2);
  });

  it("reconciles a persisted pending assistant on restart while preserving its saved text", () => {
    const accepted = store.createChat("Pending response", "pending-at-restart");
    const assistant = store.startAssistantMessage(accepted.run.id)!;
    store.appendAssistantDelta(assistant.id, "Saved text");
    database.sqlite
      .prepare("UPDATE general_chat_messages SET status='pending' WHERE id=?")
      .run(assistant.id);
    expect(store.recoverInterruptedRuns()).toBe(1);
    expect(store.getAssistantMessage(accepted.run.id)).toMatchObject({
      content: "Saved text",
      status: "failed",
      error_code: "INTERRUPTED_BY_RESTART"
    });
  });

  it.each(["cancelled", "failed", "completed"] as const)(
    "never appends late deltas to a %s answer",
    (terminal) => {
      const accepted = store.createChat("Question", "late-" + terminal);
      const assistant = store.startAssistantMessage(accepted.run.id)!;
      store.appendAssistantDelta(assistant.id, "Saved partial");
      if (terminal === "cancelled") store.cancelRun(accepted.run.id);
      else if (terminal === "failed") store.failRun(accepted.run.id, "DISCONNECTED");
      else {
        database.sqlite
          .prepare("UPDATE general_chat_runs SET status='succeeded' WHERE id=?")
          .run(accepted.run.id);
        database.sqlite
          .prepare("UPDATE general_chat_messages SET status='completed' WHERE id=?")
          .run(assistant.id);
      }
      const snapshot = store.getAssistantMessage(accepted.run.id);
      store.appendAssistantDelta(assistant.id, " LATE CONTENT");
      expect(store.getAssistantMessage(accepted.run.id)).toEqual(snapshot);
      expect(store.startAssistantMessage(accepted.run.id)).toBeNull();
    }
  );
});
