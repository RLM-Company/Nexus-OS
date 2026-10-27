import type {
  ManagerWork,
  ProjectMemoryEntry,
  WorkIntelligenceGraphAdapter
} from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { assertWorkTaskGraph, readWorkGraphContext, workRuntimeProgress } from "../src/index.js";
const work = (changes: Partial<ManagerWork> = {}): ManagerWork => ({
  id: "work-1",
  project_id: "p1",
  owner_id: "o1",
  actor_id: "o1",
  version: 1,
  request: {
    client_request_id: "r1",
    goal: "Create",
    worker_role: "analyst",
    max_model_requests: 3,
    max_input_tokens: 32000,
    max_output_tokens: 6000
  },
  status: "queued",
  stage: "plan",
  plan: null,
  draft: null,
  review: null,
  pause_requested: false,
  approved: false,
  inflight_run_id: null,
  model_requests: 0,
  reserved_input_tokens: 0,
  reserved_output_tokens: 0,
  confirmation_id: null,
  error_code: null,
  events: [],
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
  ...changes
});
const entry: ProjectMemoryEntry = {
  id: "m1",
  project_id: "p1",
  title: "Source",
  content: "Evidence",
  source: { kind: "reference", reference: "Graph source 1" },
  pinned: false,
  version: 1,
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z"
};

describe("Work graph and optional intelligence adapter", () => {
  it("offers only dependency-ready stages and retains waiting approval without authority", () => {
    const initial = workRuntimeProgress(work());
    expect(initial.tasks.map((t) => t.status)).toEqual(["ready", "pending", "pending", "pending"]);
    assertWorkTaskGraph(initial.tasks);
    const paused = workRuntimeProgress(
      work({
        status: "awaiting_approval",
        stage: "draft",
        plan: {
          summary: "Plan",
          instructions: "Draft",
          complexity: "complex",
          needs_critic: true,
          requires_external_actions: false
        }
      })
    );
    expect(paused.waiting_decision).toBe("plan");
    expect(paused.tasks.map((t) => t.status)).toEqual([
      "completed",
      "waiting",
      "pending",
      "pending"
    ]);
    expect(paused.restores_permissions).toBe(false);
  });
  it("shows Critic rejection and uncertainty as incomplete, never fabricated success", () => {
    const rejected = workRuntimeProgress(
      work({
        status: "failed",
        stage: "publish",
        plan: {
          summary: "Plan",
          instructions: "Draft",
          complexity: "complex",
          needs_critic: true,
          requires_external_actions: false
        },
        draft: { files: [{ name: "file.md", content: "Draft" }] },
        review: { verdict: "FAIL", reason: "Missing requirement" },
        error_code: "CRITIC_REJECTED"
      })
    );
    expect(rejected.completed).toBe(2);
    expect(rejected.tasks[2]?.status).toBe("failed");
    const uncertain = workRuntimeProgress(
      work({ status: "failed", error_code: "RECOVERY_REQUIRED" })
    );
    expect(uncertain.waiting_decision).toBe("recovery");
    expect(uncertain.completed).toBe(0);
  });
  it("rejects dangling dependencies, cycles and duplicate task ids", () => {
    const tasks = workRuntimeProgress(work()).tasks;
    expect(() => assertWorkTaskGraph([...tasks, tasks[0]!])).toThrow("INVALID_WORK_GRAPH");
    tasks[0]!.depends_on = [tasks[3]!.task_id];
    expect(() => assertWorkTaskGraph(tasks)).toThrow("INVALID_WORK_GRAPH");
    tasks[0]!.depends_on = ["other-project-task"];
    expect(() => assertWorkTaskGraph(tasks)).toThrow("INVALID_WORK_GRAPH");
  });
  it("uses no graph by default and fails closed on another project's context", async () => {
    const input = {
      project_id: "p1",
      owner_id: "o1",
      query: "Goal",
      signal: new AbortController().signal
    };
    expect(await readWorkGraphContext(undefined, input)).toEqual({ items: [], omitted: 0 });
    const adapter: WorkIntelligenceGraphAdapter = {
      contract_version: "kosmora-work-v1",
      read: () => Promise.resolve({ project_id: "p2", entries: [entry] })
    };
    await expect(readWorkGraphContext(adapter, input)).rejects.toThrow("GRAPH_SCOPE_MISMATCH");
    adapter.read = () =>
      Promise.resolve({ project_id: "p1", entries: [{ ...entry, project_id: "p2" }] });
    await expect(readWorkGraphContext(adapter, input)).rejects.toThrow("GRAPH_SCOPE_MISMATCH");
    adapter.read = () => Promise.resolve({ project_id: "p1", entries: [entry] });
    expect((await readWorkGraphContext(adapter, input)).items).toEqual([entry]);
  });
});
