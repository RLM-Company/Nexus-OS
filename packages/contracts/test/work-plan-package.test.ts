import { describe, expect, it } from "vitest";
import {
  createWorkPlanPackage,
  parseWorkPlanPackage,
  parseWorkPlanPackageText,
  WORK_PLAN_PACKAGE_MAX_BYTES,
  type WorkDag
} from "../src/index.js";

const pkg = () => ({
  format: "kosmora.work-plan.v1",
  title: "Reusable plan",
  nodes: [
    { id: "a", title: "Brief", goal: "Create a brief", requires_critic: true, depends_on: [] },
    { id: "b", title: "Report", goal: "Use the brief", depends_on: ["a"] }
  ]
});
describe("portable inert Work plans", () => {
  it("round-trips independent JSON values and preserves dependencies and Critic requirements", () => {
    const value = pkg(),
      parsed = parseWorkPlanPackageText(JSON.stringify(value));
    expect(parsed).toEqual(value);
    parsed.nodes[1]!.depends_on.length = 0;
    expect(value.nodes[1]!.depends_on).toEqual(["a"]);
  });
  it.each([
    { ...pkg(), owner_id: "foreign" },
    { ...pkg(), skills: [{ instructions: "inject" }] },
    { ...pkg(), format: "other" },
    { ...pkg(), execution: { status: "running" } },
    { ...pkg(), nodes: [{ ...pkg().nodes[0], status: "completed" }] },
    { ...pkg(), nodes: [{ ...pkg().nodes[0], permissions: ["all"] }] },
    { ...pkg(), nodes: [] },
    { ...pkg(), title: " " },
    { ...pkg(), nodes: [{ ...pkg().nodes[0], requires_critic: "true" }] }
  ])(
    "rejects unsupported authority, execution/history fields and malformed values (%#)",
    (value) => {
      expect(() => parseWorkPlanPackage(value)).toThrow("INVALID_WORK_PLAN_PACKAGE");
    }
  );
  it("rejects cyclic, duplicate and missing dependencies and oversized transport before parsing", () => {
    const cycle = pkg();
    cycle.nodes[0]!.depends_on = ["b"];
    expect(() => parseWorkPlanPackage(cycle)).toThrow("DAG_CYCLE");
    const missing = pkg();
    missing.nodes[1]!.depends_on = ["unknown"];
    expect(() => parseWorkPlanPackage(missing)).toThrow("DAG_DEPENDENCY_MISSING");
    const duplicate = pkg();
    duplicate.nodes[1]!.id = "a";
    expect(() => parseWorkPlanPackage(duplicate)).toThrow("INVALID_DAG");
    expect(() => parseWorkPlanPackageText(" ".repeat(WORK_PLAN_PACKAGE_MAX_BYTES + 1))).toThrow(
      "PLAN_PACKAGE_LIMIT"
    );
    expect(() => parseWorkPlanPackageText("{")).toThrow("INVALID_WORK_PLAN_PACKAGE");
  });
  it("exports only deliberate task inputs, with no owner identity, Skill text, attempts, files, usage or approvals", () => {
    const value = pkg();
    const graph = {
      ...value,
      id: "private-id",
      owner_id: "private-owner",
      request: "private-request",
      usage: { model_requests: 3 },
      nodes: value.nodes.map((n) => ({
        ...n,
        status: "completed",
        attempts: [{ work_id: "private-work" }],
        artifacts: [{ content: "private-artifact" }],
        result: { confirmation_id: "private-approval" }
      }))
    } as unknown as WorkDag;
    const exported = createWorkPlanPackage(graph);
    expect(exported).toEqual(value);
    expect(JSON.stringify(exported)).not.toContain("private-");
  });
});
