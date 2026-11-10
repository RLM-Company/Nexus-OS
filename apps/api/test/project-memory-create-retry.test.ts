import { afterEach, beforeEach, expect, it } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { ProjectMemoryEntry, ProjectMemoryInput } from "@cosmora/contracts";
import { openDatabase, runMigrations, ProjectStore, ProjectMemoryStore } from "@cosmora/db";
import { registerProjectMemoryRoutes } from "../src/project-memory-routes.js";
import { LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";

let db: ReturnType<typeof openDatabase>;
let app: FastifyInstance;
let base: string;
const input: ProjectMemoryInput = {
  title: "Requirement",
  content: "Keep the constraints",
  pinned: false,
  source: { kind: "owner", reference: "Owner" }
};
beforeEach(async () => {
  db = openDatabase(":memory:");
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  const project = projects.createProject("Task", crypto.randomUUID()).project;
  base = `/api/v1/projects/${project.id}/memory`;
  app = Fastify();
  registerProjectMemoryRoutes({
    app,
    projects,
    memory: new ProjectMemoryStore(db.sqlite),
    identityFor: () => LOCAL_DEVELOPMENT_IDENTITY
  });
});
afterEach(async () => {
  await app.close();
  db.close();
});

it("accepts an optional creation key and rejects changed bodies and invalid keys", async () => {
  const payload = { ...input, client_creation_id: "lost-response" };
  const first = await app.inject({ method: "POST", url: base, payload });
  expect(first.statusCode).toBe(201);
  const retry = await app.inject({ method: "POST", url: base, payload });
  expect(retry.statusCode).toBe(201);
  expect(retry.json<ProjectMemoryEntry>()).toEqual(first.json<ProjectMemoryEntry>());
  expect(first.json<ProjectMemoryEntry>()).not.toHaveProperty("creation_sha256");
  const conflict = await app.inject({
    method: "POST",
    url: base,
    payload: { ...payload, content: "Changed" }
  });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json<{ error: string }>()).toEqual({ error: "MEMORY_CREATION_CONFLICT" });
  for (const key of ["", " ", "x".repeat(129)]) {
    expect(
      (
        await app.inject({
          method: "POST",
          url: base,
          payload: { ...input, client_creation_id: key }
        })
      ).statusCode
    ).toBe(400);
  }
  expect(
    (await app.inject({ url: base })).json<{ items: ProjectMemoryEntry[] }>().items
  ).toHaveLength(1);
});

it("does not recreate forgotten entries and preserves old clients without creation keys", async () => {
  const payload = { ...input, client_creation_id: "attempt" };
  const first = (
    await app.inject({ method: "POST", url: base, payload })
  ).json<ProjectMemoryEntry>();
  expect(
    (
      await app.inject({
        method: "POST",
        url: `${base}/${first.id}/control`,
        payload: { version: first.version, action: "forget" }
      })
    ).statusCode
  ).toBe(200);
  const retry = await app.inject({ method: "POST", url: base, payload });
  expect(retry.statusCode).toBe(409);
  expect(retry.json<{ error: string }>()).toEqual({ error: "MEMORY_CREATION_FORGOTTEN" });
  for (let i = 0; i < 2; i++)
    expect((await app.inject({ method: "POST", url: base, payload: input })).statusCode).toBe(201);
  expect(
    (await app.inject({ url: base })).json<{ items: ProjectMemoryEntry[] }>().items
  ).toHaveLength(2);
});
