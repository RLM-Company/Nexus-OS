import Fastify from "fastify";
import { createHash, randomUUID } from "node:crypto";
import {
  GeneralChatStore,
  ManagerWorkStore,
  openDatabase,
  ProjectStore,
  runMigrations
} from "@cosmora/db";
import { expect, it } from "vitest";
import { registerSupplierWorkHandoff } from "../src/supplier-work-handoff.js";

it("pins owner-scoped source files and materials, and preserves the receipt on retry", async () => {
  const app = Fastify();
  const db = openDatabase(":memory:");
  try {
    await runMigrations(db);
    const projects = new ProjectStore(db.sqlite);
    const chats = new GeneralChatStore(db.sqlite);
    const store = new ManagerWorkStore(db.sqlite);
    const now = new Date().toISOString();
    const owner = "local-owner";
    const other = "other-owner";
    registerSupplierWorkHandoff({
      app,
      store,
      projects,
      chats,
      identityFor: (request) => {
        const id = request.headers["x-test-owner"] === other ? other : owner;
        return {
          owner_id: id,
          actor_id: id,
          actor_kind: "owner",
          session_id: id,
          assurance: "local",
          authenticated_at: now,
          expires_at: now
        };
      }
    });
    const project = projects.createEmptyProject(randomUUID(), "Закупка", owner);
    const otherProject = projects.createEmptyProject(randomUUID(), "Чужой проект", other);
    const content = '{"requirements":[{"itemId":"00123"}],"offers":[{},{}]}';
    const source = chats.createChat("Сравни предложения", "supplier-brief", owner, [
      { name: "offers.json", content }
    ]);
    const unrelated = chats.createChat("Другое сообщение", "another-brief", owner);
    const selection = {
      client_request_id: "supplier-work-1",
      chat_id: source.chat.id,
      message_id: source.userMessage.id,
      attachment_indexes: [0],
      materials_version: 0
    };
    const path = (id: string) => "/api/v1/projects/" + id + "/work/supplier-handoff";
    const submit = (id: string, payload = selection, identity = owner) =>
      app.inject({
        method: "POST",
        url: path(id),
        payload,
        headers: { "x-test-owner": identity }
      });
    expect((await submit(otherProject.id, selection, other)).statusCode).toBe(404);
    expect(
      (await submit(project.id, { ...selection, message_id: unrelated.userMessage.id })).statusCode
    ).toBe(404);
    expect((await submit(project.id, { ...selection, attachment_indexes: [1] })).statusCode).toBe(
      400
    );
    expect((await submit(project.id, { ...selection, materials_version: 1 })).statusCode).toBe(409);
    expect(store.list(project.id, owner)).toHaveLength(0);

    const first = await submit(project.id);
    expect(first.statusCode).toBe(201);
    const work = first.json<{ id: string }>();
    expect(work).toMatchObject({
      request: { output_contract: { kind: "supplier_comparison" }, goal: content },
      supplier_handoff: {
        message: source.userMessage.content,
        message_id: source.userMessage.id,
        inputs: [
          { name: "offers.json", sha256: createHash("sha256").update(content).digest("hex") }
        ]
      }
    });
    expect((await submit(project.id)).json<{ id: string }>().id).toBe(work.id);
    expect(store.list(project.id, owner)).toHaveLength(1);
    expect(store.list(otherProject.id, other)).toHaveLength(0);
  } finally {
    await app.close();
    db.close();
  }
});
