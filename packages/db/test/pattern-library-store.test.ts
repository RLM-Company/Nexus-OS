import type { DatabaseHandle } from "../src/index.js";
import { describe, expect, it } from "vitest";
import {
  openDatabase,
  PatternLibraryConflictError,
  PatternLibraryNotFoundError,
  PatternLibraryStore,
  PatternLibraryValidationError,
  runMigrations
} from "../src/index.js";

const identity = (ownerId: string, actorId = `${ownerId}-actor`) => ({
  owner_id: ownerId,
  actor_id: actorId
});

const insertProject = (database: DatabaseHandle, id: string, ownerId: string): void => {
  database.sqlite
    .prepare(
      `INSERT INTO projects (id, owner_id, title, status, created_at, updated_at)
       VALUES (?, ?, 'Pattern test', 'ACTIVE', '2026-08-28T00:00:00.000Z',
         '2026-08-28T00:00:00.000Z')`
    )
    .run(id, ownerId);
};

const functionDraft = (projectId: string | null = null) => ({
  project_id: projectId,
  name: projectId === null ? "Researcher" : "Project researcher",
  description: "Collects evidence for a bounded question.",
  result_contract: "Return findings, evidence references, and unresolved questions."
});

const patternDraft = (allowedFunctionIds: string[], projectId: string | null = null) => ({
  project_id: projectId,
  name: "Sceptical analyst",
  description: "Challenges weak evidence without changing the assigned function.",
  instructions: "Separate facts from inference and identify the strongest counterargument.",
  allowed_function_ids: allowedFunctionIds,
  known_limitations: ["May over-weight missing evidence."],
  test_status: "untested" as const
});

describe("PatternLibraryStore", () => {
  it("keeps product, owner, and project visibility isolated", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      insertProject(database, "project-1", "owner-1");
      insertProject(database, "project-2", "owner-2");
      database.sqlite
        .prepare(
          `INSERT INTO agent_function_definitions
            (function_id, version, scope, owner_id, project_id, name, description,
             result_contract, created_by_actor_id, created_at)
           VALUES ('product-function', 1, 'product', NULL, NULL, 'Product function',
             'Visible to every owner.', 'Return a bounded result.', 'system',
             '2026-08-28T00:00:00.000Z')`
        )
        .run();

      const store = new PatternLibraryStore(database.sqlite);
      const ownerFunction = store.createFunction(identity("owner-1"), functionDraft());
      const projectFunction = store.createFunction(identity("owner-1"), functionDraft("project-1"));

      expect(store.listFunctions(identity("owner-1")).map((item) => item.function_id)).toEqual([
        "product-function",
        ownerFunction.function_id
      ]);
      expect(
        store.listFunctions(identity("owner-1"), "project-1").map((item) => item.function_id)
      ).toEqual(["product-function", projectFunction.function_id, ownerFunction.function_id]);
      expect(store.listFunctions(identity("owner-2")).map((item) => item.function_id)).toEqual([
        "product-function"
      ]);
      expect(() => store.listFunctions(identity("owner-2"), "project-1")).toThrow(
        PatternLibraryNotFoundError
      );
      expect(store.getFunction(identity("owner-2"), ownerFunction.function_id, 1)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("creates immutable versions and archives by appending a terminal version", async () => {
    const database = openDatabase(":memory:");
    let nowMs = Date.parse("2026-08-28T10:00:00.000Z");
    try {
      await runMigrations(database);
      const store = new PatternLibraryStore(database.sqlite, { now: () => nowMs });
      const owner = identity("owner-1");
      const firstFunction = store.createFunction(owner, functionDraft());
      nowMs += 1_000;
      const secondFunction = store.createFunctionVersion(
        owner,
        firstFunction.function_id,
        {
          name: "Evidence researcher",
          description: firstFunction.description,
          result_contract: firstFunction.result_contract
        },
        1
      );

      expect(firstFunction.version).toBe(1);
      expect(secondFunction.version).toBe(2);
      expect(store.getFunction(owner, firstFunction.function_id, 1)?.name).toBe("Researcher");
      expect(() =>
        store.createFunctionVersion(
          owner,
          firstFunction.function_id,
          {
            name: "Stale revision",
            description: firstFunction.description,
            result_contract: firstFunction.result_contract
          },
          1
        )
      ).toThrow(PatternLibraryConflictError);

      const firstPattern = store.createPattern(owner, patternDraft([firstFunction.function_id]));
      nowMs += 1_000;
      const secondPattern = store.createPatternVersion(
        owner,
        firstPattern.pattern_id,
        {
          name: "Evidence-first sceptic",
          description: firstPattern.description,
          instructions: firstPattern.instructions,
          allowed_function_ids: [firstFunction.function_id],
          known_limitations: firstPattern.known_limitations,
          test_status: "untested"
        },
        1
      );
      expect(() =>
        store.createPatternVersion(
          owner,
          firstPattern.pattern_id,
          {
            name: "Stale pattern revision",
            description: firstPattern.description,
            instructions: firstPattern.instructions,
            allowed_function_ids: [firstFunction.function_id],
            known_limitations: firstPattern.known_limitations,
            test_status: "untested"
          },
          1
        )
      ).toThrow(PatternLibraryConflictError);
      nowMs += 1_000;
      const archived = store.archivePattern(owner, firstPattern.pattern_id);

      expect(secondPattern.version).toBe(2);
      expect(archived).toMatchObject({ version: 3, archived_at: archived.created_at });
      expect(store.archivePattern(owner, firstPattern.pattern_id).version).toBe(3);
      expect(store.getPattern(owner, firstPattern.pattern_id, 1)?.name).toBe("Sceptical analyst");
      expect(store.listPatterns(owner)).toEqual([]);
      expect(store.listPatterns(owner, null, true)).toHaveLength(1);
      const versions = database.sqlite
        .prepare("SELECT version FROM behavior_patterns WHERE pattern_id = ? ORDER BY version")
        .all(firstPattern.pattern_id);
      expect(versions).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    } finally {
      database.close();
    }
  });

  it("allows only visible functions and rejects authority-shaped pattern fields", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      insertProject(database, "project-1", "owner-1");
      const store = new PatternLibraryStore(database.sqlite);
      const owner = identity("owner-1");
      const ownerFunction = store.createFunction(owner, functionDraft());
      const projectFunction = store.createFunction(owner, functionDraft("project-1"));

      expect(() => store.createPattern(owner, patternDraft([projectFunction.function_id]))).toThrow(
        PatternLibraryValidationError
      );
      expect(
        store.createPattern(
          owner,
          patternDraft([ownerFunction.function_id, projectFunction.function_id], "project-1")
        ).scope
      ).toBe("project");
      expect(() =>
        store.createPattern(owner, {
          ...patternDraft([ownerFunction.function_id]),
          capability_ids: ["PROJECT_READ"]
        } as never)
      ).toThrow(/unsupported fields: capability_ids/);
      expect(() => store.createPattern(owner, patternDraft(["another-owner-function"]))).toThrow(
        PatternLibraryValidationError
      );
    } finally {
      database.close();
    }
  });

  it("enforces scope bindings at the database boundary", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      expect(() =>
        database.sqlite
          .prepare(
            `INSERT INTO behavior_patterns
              (pattern_id, version, scope, owner_id, project_id, name, description, instructions,
               allowed_function_ids_json, known_limitations_json, test_status,
               created_by_actor_id, created_at, archived_at)
             VALUES ('invalid', 1, 'product', 'owner-1', NULL, 'Invalid', 'Invalid binding',
               'No authority.', '["function"]', '[]', 'untested', 'actor-1',
               '2026-08-28T00:00:00.000Z', NULL)`
          )
          .run()
      ).toThrow(/CHECK constraint failed/);
    } finally {
      database.close();
    }
  });
});
