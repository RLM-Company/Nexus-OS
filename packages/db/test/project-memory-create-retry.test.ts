import { afterEach, beforeEach, expect, it } from "vitest";
import type { ProjectMemoryInput } from "@cosmora/contracts";
import { openDatabase, runMigrations, ProjectMemoryStore, ProjectStore } from "../src/index.js";

let db: ReturnType<typeof openDatabase>;
let memory: ProjectMemoryStore;
let project: string;
const input: ProjectMemoryInput = {
  title: "Owner requirement",
  content: "Keep the original numbers and constraints.",
  pinned: false,
  source: { kind: "owner", reference: "Owner" }
};
beforeEach(async () => {
  db = openDatabase(":memory:");
  await runMigrations(db);
  memory = new ProjectMemoryStore(db.sqlite);
  project = new ProjectStore(db.sqlite).createProject("Task", crypto.randomUUID(), "owner").project
    .id;
});
afterEach(() => db.close());

it("returns one durable memory entry for the same creation attempt", () => {
  const first = memory.create(project, "owner", input, "lost-response")!;
  const reopened = new ProjectMemoryStore(db.sqlite);
  const retry = reopened.create(
    project,
    "owner",
    {
      source: { reference: "Owner", kind: "owner" },
      pinned: input.pinned,
      content: input.content,
      title: input.title
    },
    "lost-response"
  );
  expect(retry).toEqual(first);
  expect(memory.list(project, "owner")).toHaveLength(1);
});

it.each([
  { title: "Changed" },
  { content: "Changed" },
  { pinned: true },
  { source: { kind: "reference" as const, reference: "Owner" } },
  { source: { kind: "owner" as const, reference: "Changed" } }
])("rejects reuse of a creation key with changed input: %j", (change) => {
  const first = memory.create(project, "owner", input, "attempt")!;
  expect(() => memory.create(project, "owner", { ...input, ...change }, "attempt")).toThrow(
    "MEMORY_CREATION_CONFLICT"
  );
  expect(memory.get(project, "owner", first.id)).toEqual(first);
  expect(memory.list(project, "owner")).toHaveLength(1);
});

it("does not undo edits or resurrect forgotten entries and scrubs the original digest", () => {
  const first = memory.create(project, "owner", input, "attempt")!;
  const edited = memory.update(project, "owner", first.id, first.version, {
    ...input,
    content: "Corrected"
  })!;
  expect(memory.create(project, "owner", input, "attempt")).toEqual(edited);
  memory.control(project, "owner", edited.id, edited.version, "forget");
  for (const retry of [input, { ...input, content: "Changed" }])
    expect(() => memory.create(project, "owner", retry, "attempt")).toThrow(
      "MEMORY_CREATION_FORGOTTEN"
    );
  expect(memory.list(project, "owner")).toEqual([]);
  expect(
    db.sqlite
      .prepare("SELECT title,content,source_json,creation_sha256 FROM project_memory WHERE id=?")
      .get(first.id)
  ).toMatchObject({ title: "", content: "", source_json: "{}", creation_sha256: null });
  expect(memory.create(project, "owner", input, "new-attempt")!.id).not.toBe(first.id);
});

it("scopes creation attempts to both project and owner", () => {
  const projects = new ProjectStore(db.sqlite);
  const second = projects.createProject("Another", crypto.randomUUID(), "owner").project.id;
  const foreign = projects.createProject("Other owner", crypto.randomUUID(), "other").project.id;
  const a = memory.create(project, "owner", input, "shared")!;
  const b = memory.create(second, "owner", input, "shared")!;
  const c = memory.create(foreign, "other", input, "shared")!;
  expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  expect(memory.create(project, "other", input, "shared")).toBeNull();
  expect(memory.create(foreign, "owner", input, "shared")).toBeNull();
});

it("keeps legacy creates distinct and replays an accepted attempt at capacity", () => {
  const first = memory.create(project, "owner", input, "attempt")!;
  for (let i = 0; i < 199; i++) memory.create(project, "owner", input);
  expect(memory.list(project, "owner")).toHaveLength(200);
  expect(memory.create(project, "owner", input, "attempt")).toEqual(first);
  expect(() => memory.create(project, "owner", input, "another")).toThrow("MEMORY_LIMIT");
  expect(() => memory.create(project, "owner", input, "")).toThrow("INVALID_MEMORY");
});

it("can run inside an existing transaction without committing its parent", () => {
  db.sqlite.exec("BEGIN IMMEDIATE");
  memory.create(project, "owner", input, "nested");
  db.sqlite.exec("ROLLBACK");
  expect(memory.list(project, "owner")).toHaveLength(0);
  expect(memory.create(project, "owner", input, "nested")).not.toBeNull();
});
