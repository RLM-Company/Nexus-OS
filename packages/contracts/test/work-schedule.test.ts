import { describe, expect, it } from "vitest";
import type { WorkDagNode } from "../src/work-dag.js";
import { validateWorkDag } from "../src/work-dag.js";
import { isWorkDeadline, scheduledReadyWorkNodes } from "../src/work-schedule.js";
import { createWorkPlanPackage, parseWorkPlanPackageText } from "../src/work-plan-package.js";
const node = (id: string, patch: Partial<WorkDagNode> = {}): WorkDagNode => ({
  id,
  title: id,
  goal: id,
  depends_on: [],
  status: "pending",
  attempts: [],
  artifacts: [],
  blocked_reason: null,
  ...patch
});
describe("Work scheduling without automatic date triggers", () => {
  it("orders only ready nodes by priority, deadline and original order without changing the plan", () => {
    const nodes = [
      node("normal"),
      node("urgent", { priority: "urgent" }),
      node("late", { priority: "high", deadline: "2026-12-20T12:00:00Z" }),
      node("early", { priority: "high", deadline: "2026-11-20T12:00:00.000Z" }),
      node("tie", { priority: "high", deadline: "2026-11-20T12:00:00Z" }),
      node("blocked", { priority: "urgent", depends_on: ["normal"] }),
      node("started", {
        priority: "urgent",
        attempts: [{ number: 1, work_id: "work", started_at: "now", source_artifact_ids: [] }]
      }),
      node("done", { status: "completed" })
    ];
    const before = structuredClone(nodes);
    expect(scheduledReadyWorkNodes({ nodes }).map((n) => n.id)).toEqual([
      "urgent",
      "early",
      "tie",
      "late",
      "normal"
    ]);
    expect(nodes).toEqual(before);
    expect(
      scheduledReadyWorkNodes({
        nodes: [node("parent", { status: "completed" }), node("child", { depends_on: ["parent"] })]
      }).map((n) => n.id)
    ).toEqual(["child"]);
  });
  it("accepts old plans without manufacturing priorities or dates", () => {
    const nodes = [node("a"), node("b")];
    expect(() => validateWorkDag(nodes)).not.toThrow();
    expect(scheduledReadyWorkNodes({ nodes })).toEqual(nodes);
    expect(Object.hasOwn(nodes[0]!, "deadline")).toBe(false);
  });
  it.each([
    "2026-02-30T12:00:00Z",
    "2026-13-01T12:00:00Z",
    "2026-10-20T25:00:00Z",
    "2026-10-20T12:00:00+03:00",
    "tomorrow",
    "2026-10-20",
    "2025-02-29T12:00:00Z"
  ])("rejects invalid or non-UTC dates: %s", (deadline) => {
    expect(isWorkDeadline(deadline)).toBe(false);
    expect(() => validateWorkDag([node("a", { deadline })])).toThrow("INVALID_DAG_DEADLINE");
  });
  it("round-trips scheduling metadata as inert content while excluding execution state", () => {
    const nodes = [
      node("a", { priority: "high", deadline: "2028-02-29T12:00:00Z" }),
      node("b", { deadline: null })
    ];
    const packet = createWorkPlanPackage({ title: "Portable", nodes });
    expect(parseWorkPlanPackageText(JSON.stringify(packet))).toEqual(packet);
    expect(packet.nodes[0]).toMatchObject({ priority: "high", deadline: "2028-02-29T12:00:00Z" });
    expect(packet.nodes[1]!.deadline).toBeNull();
    expect(JSON.stringify(packet)).not.toContain("attempts");
    expect(isWorkDeadline("2028-02-29T12:00:00Z")).toBe(true);
  });
});
