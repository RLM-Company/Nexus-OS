import { loadServerConfig } from "@cosmora/config";
import { AssistantProfileStore, openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("assistant profile API", () => {
  const config = loadServerConfig({ NODE_ENV: "test" });
  let database: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    app = buildApp({
      config,
      database,
      assistantProfileStore: new AssistantProfileStore(database.sqlite)
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("creates, lists, updates and deletes a versioned profile", async () => {
    const payload = {
      profile_id: "profile-api-1",
      name: "Репетитор",
      instructions: "Объясняй по шагам."
    };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/assistant-profiles",
      payload
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ id: payload.profile_id, version: 1 });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/assistant-profiles",
      payload
    });
    expect(duplicate.statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/assistant-profiles" })).json()
    ).toMatchObject({ items: [{ id: payload.profile_id, name: "Репетитор", version: 1 }] });

    const updated = await app.inject({
      method: "PUT",
      url: `/api/v1/assistant-profiles/${payload.profile_id}`,
      payload: { name: "Репетитор Pro", instructions: "Добавляй примеры.", expected_version: 1 }
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({ name: "Репетитор Pro", version: 2 });

    const stale = await app.inject({
      method: "PUT",
      url: `/api/v1/assistant-profiles/${payload.profile_id}`,
      payload: { name: "Старое имя", instructions: "Не применять.", expected_version: 1 }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: "ASSISTANT_PROFILE_CONFLICT" } });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/assistant-profiles/${payload.profile_id}`,
      payload: { expected_version: 2 }
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ profile_id: payload.profile_id, deleted: true });

    const whitespace = await app.inject({
      method: "POST",
      url: "/api/v1/assistant-profiles",
      payload: { profile_id: "profile-empty", name: "   ", instructions: "Правила" }
    });
    expect(whitespace.statusCode).toBe(400);
    expect(whitespace.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
