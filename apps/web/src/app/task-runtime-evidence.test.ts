import type { WorkCheckpointRecord } from "@cosmora/contracts";
import { expect, it } from "vitest";
import {
  acceptsMediaProgress,
  acceptsStarsProgress,
  computeWorkEvidence,
  observedInterval
} from "./task-runtime-evidence";

const checkpoint = (
  version: number,
  status: WorkCheckpointRecord["status"],
  run: string | null = null
): WorkCheckpointRecord => ({
  work_id: "work-a",
  version,
  status,
  at: new Date(version * 1000).toISOString(),
  stage: "draft",
  inflight_run_id: run,
  model_requests: 0,
  reserved_input_tokens: 0,
  reserved_output_tokens: 0,
  error_code: null,
  restores_permissions: false
});

it("measures only adjacent work checkpoints belonging to the selected task", () => {
  const history = [
    checkpoint(6, "cancelled"),
    checkpoint(1, "queued"),
    checkpoint(2, "running", "run-1"),
    checkpoint(3, "paused"),
    checkpoint(5, "blocked")
  ];
  const evidence = computeWorkEvidence("work-a", history)!;
  expect([...evidence.samples]).toEqual([
    ["queue", 1000],
    ["model", 1000],
    ["wait", 1000]
  ]);
  expect(evidence.latest.status).toBe("cancelled");
  expect(evidence.current).toBeNull();
  expect(computeWorkEvidence("other", history)).toBeNull();
  expect(observedInterval("1970-01-01", undefined)).toBeNull();
  expect(observedInterval("1970-01-02", "1970-01-01")).toBeNull();
});

it("ignores another task and an old media response after an observed stop", () => {
  const cancelled = { id: "job-a", status: "cancelled", updated_at: "2026-11-27T12:00:06Z" };
  expect(acceptsMediaProgress(cancelled, { ...cancelled, status: "done" })).toBe(false);
  expect(acceptsMediaProgress(cancelled, { ...cancelled, id: "job-b" })).toBe(false);
  expect(
    acceptsMediaProgress({ ...cancelled, status: "running" }, { ...cancelled, status: "queued" })
  ).toBe(false);
  expect(acceptsMediaProgress({ ...cancelled, status: "running" }, cancelled)).toBe(true);
});

it("guards Stars against a late same-mission snapshot without comparing unrelated graph versions", () => {
  const current = {
    id: "mission-a",
    version: 8,
    execution: { graph_id: "graph-a" },
    runtime: { version: 12 }
  };
  expect(acceptsStarsProgress(current, { ...current, runtime: { version: 11 } })).toBe(false);
  expect(acceptsStarsProgress(current, { ...current, version: 7 })).toBe(false);
  expect(
    acceptsStarsProgress(current, {
      ...current,
      version: 9,
      execution: { graph_id: "graph-b" },
      runtime: { version: 1 }
    })
  ).toBe(true);
  expect(acceptsStarsProgress(current, { ...current, runtime: { version: 13 } })).toBe(true);
});
