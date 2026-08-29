import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentStudioIdempotencyConflictError,
  AgentStudioMutationStore,
  openDatabase,
  PatternLibraryStore,
  runMigrations,
  type DatabaseHandle
} from "../src/index.js";

const NOW = Date.parse("2026-08-29T12:00:00.000Z");
const identity = { owner_id: "owner-1", actor_id: "owner-actor-1" };
const PROJECT_ID = "project-agent-studio-idempotency";

const insertProject = (database: DatabaseHandle): void => {
  database.sqlite
    .prepare(
      `INSERT OR IGNORE INTO projects (id, owner_id, title, status, created_at, updated_at)
       VALUES (?, ?, 'Idempotency test', 'ACTIVE', '2026-08-29T11:00:00.000Z',
         '2026-08-29T11:00:00.000Z')`
    )
    .run(PROJECT_ID, identity.owner_id);
};

const request = {
  name: "Researcher",
  description: "Collects bounded evidence.",
  result_contract: "Return findings and sources."
};

describe("AgentStudioMutationStore", () => {
  it("replays the same result after a database restart without storing request content", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cosmora-agent-studio-idempotency-"));
    const databasePath = join(directory, "cosmora.db");
    try {
      const firstDatabase = openDatabase(databasePath);
      await runMigrations(firstDatabase);
      insertProject(firstDatabase);
      const firstPatterns = new PatternLibraryStore(firstDatabase.sqlite, { now: () => NOW });
      const firstMutations = new AgentStudioMutationStore(firstDatabase.sqlite, { now: () => NOW });
      const created = firstMutations.create(identity, {
        project_id: PROJECT_ID,
        idempotency_key: "create-function-1",
        operation: "function.create",
        request,
        execute: () =>
          firstPatterns.createFunction(identity, { project_id: PROJECT_ID, ...request }),
        reference_of: (value) => ({ id: value.function_id, version: value.version }),
        resolve: (reference) =>
          firstPatterns.getFunction(identity, reference.id, reference.version, PROJECT_ID)
      });
      expect(created.replayed).toBe(false);
      const functionId = created.value.function_id;
      const mutationRow = firstDatabase.sqlite
        .prepare("SELECT * FROM agent_studio_mutations")
        .get();
      expect(JSON.stringify(mutationRow)).not.toContain(request.result_contract);
      firstDatabase.close();

      const restartedDatabase = openDatabase(databasePath);
      await runMigrations(restartedDatabase);
      const restartedPatterns = new PatternLibraryStore(restartedDatabase.sqlite, {
        now: () => NOW
      });
      const restartedMutations = new AgentStudioMutationStore(restartedDatabase.sqlite, {
        now: () => NOW
      });
      const replayed = restartedMutations.create(identity, {
        project_id: PROJECT_ID,
        idempotency_key: "create-function-1",
        operation: "function.create",
        request: {
          result_contract: request.result_contract,
          description: request.description,
          name: request.name
        },
        execute: () => {
          throw new Error("Replay must not execute the mutation again");
        },
        reference_of: () => ({ id: "unreachable", version: 1 }),
        resolve: (reference) =>
          restartedPatterns.getFunction(identity, reference.id, reference.version, PROJECT_ID)
      });
      expect(replayed).toMatchObject({ replayed: true, value: { function_id: functionId } });
      expect(restartedPatterns.listFunctions(identity, PROJECT_ID)).toHaveLength(1);
      restartedDatabase.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects key reuse for another request and rolls domain writes back on failure", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      insertProject(database);
      const patterns = new PatternLibraryStore(database.sqlite, { now: () => NOW });
      const mutations = new AgentStudioMutationStore(database.sqlite, { now: () => NOW });
      const create = (key: string, body = request) =>
        mutations.create(identity, {
          project_id: PROJECT_ID,
          idempotency_key: key,
          operation: "function.create",
          request: body,
          execute: () => patterns.createFunction(identity, { project_id: PROJECT_ID, ...body }),
          reference_of: (value) => ({ id: value.function_id, version: value.version }),
          resolve: (reference) =>
            patterns.getFunction(identity, reference.id, reference.version, PROJECT_ID)
        });

      create("bound-key");
      expect(() => create("bound-key", { ...request, name: "Different request" })).toThrow(
        AgentStudioIdempotencyConflictError
      );
      expect(patterns.listFunctions(identity, PROJECT_ID)).toHaveLength(1);

      expect(() =>
        mutations.create(identity, {
          project_id: PROJECT_ID,
          idempotency_key: "failing-key",
          operation: "function.create",
          request,
          execute: () => {
            patterns.createFunction(identity, { project_id: PROJECT_ID, ...request });
            throw new Error("Injected failure after domain write");
          },
          reference_of: () => ({ id: "unreachable", version: 1 }),
          resolve: () => null
        })
      ).toThrow(/Injected failure/);
      expect(patterns.listFunctions(identity, PROJECT_ID)).toHaveLength(1);
      expect(
        database.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_studio_mutations").get()
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });
});
