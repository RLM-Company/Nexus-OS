import { describe, expect, it } from "vitest";
import {
  ProjectStore,
  IdempotencyConflictError,
  openDatabase,
  runMigrations
} from "../src/index.js";
import type { ChatAttachment } from "@cosmora/contracts";

describe("project materials persistence", () => {
  it("keeps extracted documents and images in history and the executor snapshot, with owner isolation and exact replay", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const files: ChatAttachment[] = [
        { name: "brief.pdf", source_type: "pdf", content: "Project brief" },
        { kind: "image", name: "sample.png", media_type: "image/png", data_base64: "fixture-data" }
      ];
      const store = new ProjectStore(database.sqlite);
      const accepted = store.createProject("Build", "with-materials", "owner-a", files);
      const reloaded = new ProjectStore(database.sqlite);
      expect(reloaded.listMessages(accepted.project.id, "owner-a")[0]?.attachments).toEqual(files);
      expect(reloaded.getConversationForRun(accepted.run.id, "owner-a")[0]?.attachments).toEqual(
        files
      );
      expect(reloaded.getConversationForRun(accepted.run.id, "owner-b")).toEqual([]);
      expect(reloaded.listMessages(accepted.project.id, "owner-b")).toEqual([]);
      expect(reloaded.createProject("Build", "with-materials", "owner-a", files).duplicate).toBe(
        true
      );
      expect(() => reloaded.createProject("Build", "with-materials", "owner-a", [])).toThrow(
        IdempotencyConflictError
      );
      const next = store.createMessage(
        accepted.project.id,
        "Follow up",
        "next-materials",
        "owner-a",
        [{ name: "code.ts", content: "export const value = 1;" }]
      )!;
      expect(
        reloaded.findByClientMessageId("next-materials", "owner-a")?.userMessage.attachments
      ).toEqual(next.userMessage.attachments);
      expect(() =>
        reloaded.createMessage(accepted.project.id, "Follow up", "next-materials", "owner-a", [])
      ).toThrow(IdempotencyConflictError);
      const assistant = store.startAssistantMessage(next.run.id, "owner-a");
      expect(assistant?.attachments).toBeUndefined();
      expect(store.cancelRun(accepted.run.id, "owner-a")).toBe("cancelled");
    } finally {
      database.close();
    }
  });
});
