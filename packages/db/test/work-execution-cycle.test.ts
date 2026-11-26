import { expect, it } from "vitest";
import {
  openDatabase,
  runMigrations,
  WorkExecutionCycleConflict,
  WorkExecutionCycleStore
} from "../src/index.js";

it("stores supplier cycle state outside ManagerWork with strict CAS", async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const store = new WorkExecutionCycleStore(db.sqlite);
  const owner = "owner-A";
  const work = "work-1";
  const base = {
    work_id: work,
    owner_id: owner,
    stage: "awaiting_answer" as const,
    question: "Нужно второе предложение",
    gaps: [{ code: "missing_offers", path: "offers", question: "?" }],
    instructions: [],
    error_code: null,
    accepted_inputs: [{ name: "offers.json", sha256: "abc" }],
    result_ref: null,
    updated_at: ""
  };
  const first = store.save({ ...base, version: 1 }, 0);
  expect(first.version).toBe(1);
  expect(first.question).toBe("Нужно второе предложение");
  expect(store.get(work, owner)?.stage).toBe("awaiting_answer");

  const second = store.save({ ...first, version: 2, stage: "calculating", question: null }, 1);
  expect(second.version).toBe(2);
  expect(store.get(work, owner)?.accepted_inputs).toEqual(base.accepted_inputs);

  expect(() => store.save({ ...second, version: 3 }, 1)).toThrow(WorkExecutionCycleConflict);
  expect(() => store.save({ ...second, version: 2 }, 2)).toThrow(WorkExecutionCycleConflict);
  expect(store.get(work, "owner-B")).toBeNull();
});
