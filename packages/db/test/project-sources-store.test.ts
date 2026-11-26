import { expect, it } from "vitest";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  ProjectSourceStore,
  GeneralChatStore
} from "../src/index.js";

it("creates the project source tables via migrations", async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const names = db.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE 'project_run_sources' OR name LIKE 'project_source_exclusions'"
    )
    .all() as { name: string }[];
  expect(names.map((n) => n.name).sort()).toEqual([
    "project_run_sources",
    "project_source_exclusions"
  ]);
  const projects = new ProjectStore(db.sqlite);
  const id = projects.createProject("x", "x", "source-owner").project.id;
  const store = new ProjectSourceStore(db.sqlite);
  const view = store.exclusions(id, "source-owner");
  expect(view.version).toBe(1);
  db.close();
});

it("project exclusions reach the next run's context resolution", async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  const owner = "source-owner";
  const id = projects.createProject("x", "x", owner).project.id;
  const a = projects.createMessage(id, "Ключ 19 700 исключён", "a", owner)!;
  const b = projects.createMessage(id, "Ключ 18 000 остаётся", "b", owner)!;
  // Cancel any active runs so memory settings can be changed.
  db.sqlite
    .prepare(
      "UPDATE runs SET status='cancelled' WHERE project_id=? AND lower(status) IN ('queued','running')"
    )
    .run(id);
  const memory = new GeneralChatStore(db.sqlite).contextMemory;
  const settingsVersion = memory.settings({ kind: "project", id }, owner).version;
  memory.updateSettings(
    { kind: "project", id },
    {
      enabled: true,
      use_personal: false,
      source_chat_ids: [],
      project_ids: [id],
      expected_version: settingsVersion
    },
    owner
  );
  memory.create(
    {
      scope: "project",
      scope_id: id,
      kind: "constraint",
      title: "Исключаемый источник",
      content: "19 700",
      pinned: true,
      expires_at: null,
      source: { kind: "project_message", message_id: a.userMessage.id, quote: "19 700" }
    } as never,
    owner
  );
  memory.create(
    {
      scope: "project",
      scope_id: id,
      kind: "constraint",
      title: "Остающийся источник",
      content: "18 000",
      pinned: true,
      expires_at: null,
      source: { kind: "project_message", message_id: b.userMessage.id, quote: "18 000" }
    } as never,
    owner
  );
  const sources = new ProjectSourceStore(db.sqlite);
  sources.updateExclusions(id, owner, {
    expected_version: 1,
    exclusions: [
      {
        source_kind: "project_message",
        source_id: a.userMessage.id,
        excluded_at: "2026-11-25T00:00:00Z",
        reason: "test"
      }
    ]
  });
  const excluded = sources.excludedSourceIds(id, owner);
  expect(excluded).toEqual([a.userMessage.id]);
  const without = memory.resolve({ kind: "project", id }, owner, "19 700", []);
  const withExclusion = memory.resolve({ kind: "project", id }, owner, "19 700", excluded);
  expect(without.items.some((x) => x.text.includes("19 700"))).toBe(true);
  expect(withExclusion.items.some((x) => x.text.includes("19 700"))).toBe(false);
  expect(withExclusion.items.some((x) => x.text.includes("18 000"))).toBe(true);
  db.close();
});
