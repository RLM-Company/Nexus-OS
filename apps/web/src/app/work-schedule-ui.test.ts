import { expect, it } from "vitest";
import type { WorkDagNode } from "@cosmora/contracts";
import { filterWorkSteps, workDeadlineLocal, workDeadlineUtc } from "./work-schedule-ui";
const now = Date.parse("2026-10-20T12:00:00Z");
const make = (
  id: string,
  deadline?: string,
  status: WorkDagNode["status"] = "pending"
): WorkDagNode => ({
  id,
  title: id,
  goal: id,
  depends_on: [],
  status,
  blocked_reason: null,
  attempts: [],
  artifacts: [],
  ...(deadline ? { deadline } : {})
});
it("filters real deadlines without labelling completed/cancelled steps overdue", () => {
  const nodes = [
    make("late", "2026-10-19T12:00:00Z"),
    make("soon", "2026-10-21T12:00:00Z"),
    make("later", "2026-11-20T12:00:00Z"),
    make("none"),
    make("done", "2026-10-19T12:00:00Z", "completed")
  ];
  expect(filterWorkSteps(nodes, "all", "overdue", now).map((n) => n.id)).toEqual(["late"]);
  expect(filterWorkSteps(nodes, "pending", "week", now).map((n) => n.id)).toEqual(["soon"]);
  expect(filterWorkSteps(nodes, "all", "none", now).map((n) => n.id)).toEqual(["none"]);
  expect(filterWorkSteps(nodes, "completed", "overdue", now)).toEqual([]);
});
it("uses local input and UTC storage, supports explicit clearing and rejects normalized invalid dates", () => {
  const local = "2026-10-20T12:34";
  expect(workDeadlineLocal(workDeadlineUtc(local))).toBe(local);
  expect(workDeadlineUtc("")).toBeNull();
  expect(() => workDeadlineUtc("2026-02-30T12:34")).toThrow();
});
